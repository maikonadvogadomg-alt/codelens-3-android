import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "../../lib/db/index.js";
import http from "http";
import {
  startDevServer,
  stopDevServer,
  getDevServer,
  detectStartCommand,
  needsInstall,
} from "../lib/devServerRegistry.js";
import { ensureProjectOnDisk } from "../lib/persistFiles.js";

const router: IRouter = Router();

async function resolveProject(projectId: string) {
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return null;
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));
  return project ?? null;
}

function serializeBody(req: Request): Buffer | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (req.body == null) return null;
  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (ct.includes("application/x-www-form-urlencoded")) {
      const encoded = new URLSearchParams(req.body as Record<string, string>).toString();
      return Buffer.from(encoded);
    }
    return Buffer.from(JSON.stringify(req.body));
  }
  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }
  return null;
}

function proxyRequest(
  req: Request,
  res: Response,
  port: number,
  targetPath: string,
  errorHtml?: string,
) {
  const bodyBuf = serializeBody(req);
  const proxyHeaders: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (typeof val === "string") proxyHeaders[key] = val;
  }
  proxyHeaders["host"] = `localhost:${port}`;
  if (bodyBuf) {
    proxyHeaders["content-length"] = String(bodyBuf.length);
  } else {
    delete proxyHeaders["content-length"];
  }

  const proxyReq = http.request(
    { hostname: "localhost", port, path: targetPath, method: req.method, headers: proxyHeaders, timeout: 30000 },
    (proxyRes) => {
      const headers: Record<string, string | string[]> = {};
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        if (val !== undefined) headers[key] = val as string | string[];
      }
      delete headers["x-frame-options"];
      delete headers["content-security-policy"];
      res.writeHead(proxyRes.statusCode ?? 200, headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).send(errorHtml ?? "Tempo limite de conexão excedido");
    }
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).send(errorHtml ?? "Erro ao conectar");
    }
  });

  if (bodyBuf) {
    proxyReq.write(bodyBuf);
    proxyReq.end();
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

function extractSearch(req: Request): string {
  return req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
}

const SERVER_NOT_STARTED_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Servidor não iniciado</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#8b949e;flex-direction:column;gap:12px}</style>
</head>
<body>
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <p style="font-size:14px;font-weight:600;color:#e6edf3;margin:0">Servidor não iniciado</p>
  <p style="font-size:12px;margin:0">Clique em <strong>Iniciar Servidor</strong> no painel de Preview</p>
</body>
</html>`;

function connectionErrorHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Erro de conexão</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#8b949e;flex-direction:column;gap:8px}</style>
</head>
<body>
  <p style="font-size:14px;font-weight:600;color:#f85149;margin:0">Erro ao conectar ao servidor</p>
  <p style="font-size:12px;margin:0">Porta: ${port} — verifique o terminal</p>
</body>
</html>`;
}

router.post("/projects/:projectId/dev-server/start", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  await ensureProjectOnDisk(project.id, project.storagePath);

  const { command } = (req.body ?? {}) as { command?: string };
  const id = project.id;
  const willInstall = needsInstall(project.storagePath);
  await startDevServer(id, project.storagePath, command);

  const server = getDevServer(id)!;
  const start = Date.now();
  const timeout = willInstall ? 60_000 : 15_000;
  while (!server.port && server.status === "starting" && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 500));
  }

  res.json({
    running: server.status === "running",
    status: server.status,
    port: server.port,
    command: server.command,
    autoInstall: willInstall,
    suggestedCommand: detectStartCommand(project.storagePath),
  });
});

router.delete("/projects/:projectId/dev-server/stop", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  const stopped = stopDevServer(project.id);
  res.json({ stopped });
});

router.get("/projects/:projectId/dev-server/status", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  const server = getDevServer(project.id);
  if (!server) {
    res.json({ running: false, port: null, status: "stopped", log: [] });
    return;
  }
  res.json({
    running: server.status === "running" || server.status === "starting",
    port: server.port,
    status: server.status,
    command: server.command,
    log: server.log.slice(-20).join(""),
  });
});

router.all("/projects/:projectId/dev-proxy", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  const server = getDevServer(project.id);
  if (!server || !server.port) { res.redirect(req.originalUrl + "/"); return; }
  proxyRequest(req, res, server.port, "/" + extractSearch(req));
});

router.all("/projects/:projectId/dev-proxy/", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  const server = getDevServer(project.id);
  if (!server || !server.port) { res.status(503).send(SERVER_NOT_STARTED_HTML); return; }
  proxyRequest(req, res, server.port, "/" + extractSearch(req));
});

router.all("/projects/:projectId/dev-proxy/*path", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  const server = getDevServer(project.id);
  if (!server || !server.port) {
    res.status(503).send(SERVER_NOT_STARTED_HTML);
    return;
  }

  const rawPathParam = (req.params as Record<string, string | string[]>).path ?? "";
  const rawPath = Array.isArray(rawPathParam) ? rawPathParam.join("/") : rawPathParam;
  const targetPath = rawPath ? `/${rawPath}` : "/";
  const fullPath = targetPath + extractSearch(req);

  proxyRequest(req, res, server.port, fullPath, connectionErrorHtml(server.port));
});

router.all("/projects/:projectId/port-proxy/:port/*path", async (req, res): Promise<void> => {
  const portNum = parseInt(req.params.port, 10);
  if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
    res.status(400).send("Invalid port");
    return;
  }

  const rawPathParam = (req.params as Record<string, string | string[]>).path ?? "";
  const rawPath = Array.isArray(rawPathParam) ? rawPathParam.join("/") : rawPathParam;
  const targetPath = rawPath ? `/${rawPath}` : "/";
  const fullPath = targetPath + extractSearch(req);

  proxyRequest(req, res, portNum, fullPath, connectionErrorHtml(portNum));
});

export default router;
