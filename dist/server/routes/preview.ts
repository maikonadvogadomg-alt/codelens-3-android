import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "../../lib/db/index.js";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import mime from "mime-types";

const router: IRouter = Router();

// Ordered list of directories/files to try as the entry point
const ENTRY_CANDIDATES = [
  "dist/index.html",
  "build/index.html",
  "out/index.html",
  ".next/server/pages/index.html",
  "public/index.html",
  "static/index.html",
  "www/index.html",
  "index.html",
  "src/index.html",
];

async function findEntryPoint(storagePath: string): Promise<string | null> {
  for (const candidate of ENTRY_CANDIDATES) {
    const fullPath = path.join(storagePath, candidate);
    try {
      await fs.stat(fullPath);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

async function resolveProject(projectId: string) {
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return null;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  return project ?? null;
}

// GET /projects/:projectId/preview/status — what entry we'd serve
router.get("/projects/:projectId/preview/status", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  const entry = await findEntryPoint(project.storagePath);
  if (entry) {
    res.json({ ready: true, entry, storagePath: project.storagePath });
  } else {
    res.json({ ready: false, entry: null });
  }
});

// GET /projects/:projectId/preview/*path — serve static files
router.get("/projects/:projectId/preview/*path", async (req, res): Promise<void> => {
  const project = await resolveProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  // Express 5 wildcard /*path gives params.path as string[] (array of segments)
  const rawPathParam = (req.params as any).path ?? "";
  const rawPath = Array.isArray(rawPathParam) ? rawPathParam.join("/") : (rawPathParam as string);

  // If no specific file requested, find and serve the index
  let relativePath = rawPath || "";

  if (!relativePath || relativePath === "/") {
    const entry = await findEntryPoint(project.storagePath);
    if (!entry) {
      res.status(404).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"><title>Sem preview</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#8b949e;flex-direction:column;gap:12px}</style>
        </head>
        <body>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <p style="font-size:14px;margin:0">Nenhum arquivo <code>index.html</code> encontrado</p>
          <p style="font-size:12px;margin:0">Para projetos React/Vite: rode <code>npm run build</code> primeiro</p>
        </body>
        </html>
      `);
      return;
    }
    relativePath = entry;
  }

  const fullPath = path.resolve(path.join(project.storagePath, relativePath));
  const base = path.resolve(project.storagePath);

  // Path traversal guard
  if (!fullPath.startsWith(base)) {
    res.status(400).send("Invalid path");
    return;
  }

  try {
    const stat = await fs.stat(fullPath);

    // If directory, try index.html inside it
    if (stat.isDirectory()) {
      const indexPath = path.join(fullPath, "index.html");
      try {
        await fs.stat(indexPath);
        const mimeType = "text/html";
        res.setHeader("Content-Type", mimeType);
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        createReadStream(indexPath).pipe(res);
      } catch {
        res.status(404).send("Not found");
      }
      return;
    }

    const mimeType = mime.lookup(fullPath) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "no-cache");
    // Allow embedding in iframe from same origin
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    createReadStream(fullPath).pipe(res);
  } catch {
    // If file not found and path looks like a route (no extension), try index.html (SPA fallback)
    const hasExtension = path.extname(relativePath).length > 0;
    if (!hasExtension) {
      const entry = await findEntryPoint(project.storagePath);
      if (entry) {
        const entryFull = path.join(project.storagePath, entry);
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(entryFull).pipe(res);
        return;
      }
    }
    res.status(404).send("Not found");
  }
});

export default router;
