import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "../../lib/db/index.js";
import { ExecCommandBody } from "../../lib/api-zod/index.js";
import { spawn, execSync } from "child_process";
import path from "path";
import { registerTerminalProcess } from "../lib/devServerRegistry.js";
import { ensureProjectOnDisk } from "../lib/persistFiles.js";

const router: IRouter = Router();

function detectBinPaths(): string[] {
  const extra: string[] = [];
  const tryResolve = (cmd: string) => {
    try {
      const p = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim();
      if (p) extra.push(path.dirname(p));
    } catch {}
  };
  tryResolve("npm");
  tryResolve("node");
  tryResolve("npx");
  tryResolve("yarn");
  tryResolve("pnpm");
  return [...new Set(extra)];
}

const DETECTED_BIN_PATHS = detectBinPaths();

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=.*of=\/dev/,
  />\s*\/dev\/sd/,
  /shutdown|reboot|halt|poweroff/,
  /curl.*\|\s*(bash|sh|zsh)/,
  /wget.*\|\s*(bash|sh|zsh)/,
];

function isCommandBlocked(cmd: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(cmd));
}

function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/^pip\s+/, "pip3 ")
    .replace(/^pip\b/, "pip3")
    .replace(/^python\s+/, "python3 ")
    .replace(/^python\b/, "python3")
    .replace(/pipenv run python\b/, "pipenv run python3")
    .replace(/poetry run python\b/, "poetry run python3");
}

function buildEnv() {
  const extraPaths = [
    ...DETECTED_BIN_PATHS,
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/local/sbin",
    "/usr/sbin",
    "/sbin",
    "/home/runner/.local/bin",
    "/home/runner/.cargo/bin",
    "/home/runner/go/bin",
    "/usr/local/go/bin",
  ];
  const currentPath = process.env.PATH ?? "";
  const pathSet = new Set([...currentPath.split(":"), ...extraPaths]);

  // Filter out pnpm workspace config vars that bleed into user project processes
  // These cause "Unknown env config" warnings when npm runs in user projects
  const PNPM_CONFIG_KEYS = new Set([
    "npm_config_minimum_release_age",
    "npm_config_npm_globalconfig",
    "npm_config_verify_deps_before_run",
    "npm_config_jsr_registry",
    "npm_config__jsr_registry",
    "npm_config_catalog",
    "npm_config_recursive",
    "npm_config_overrides",
    "npm_config_auto_install_peers",
    "npm_config_strict_peer_dependencies",
    // Generic pnpm config pattern
  ]);

  const filteredEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (typeof val !== "string") continue;
    // Drop pnpm lifecycle vars and pnpm-specific npm_config_* that cause warnings
    if (PNPM_CONFIG_KEYS.has(key.toLowerCase())) continue;
    // Also drop pnpm-specific config keys not meant for regular npm
    if (key.toLowerCase().startsWith("npm_config_") && (
      key.toLowerCase().includes("jsr") ||
      key.toLowerCase().includes("catalog") ||
      key.toLowerCase().includes("release_age") ||
      key.toLowerCase().includes("globalconfig") ||
      key.toLowerCase().includes("verify_deps")
    )) continue;
    filteredEnv[key] = val;
  }

  return {
    ...filteredEnv,
    PATH: [...pathSet].filter(Boolean).join(":"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_PROGRESS: "true",
    PYTHONUNBUFFERED: "1",
    // Point npm config to /dev/null so it ignores the workspace .npmrc
    npm_config_userconfig: "/dev/null",
  };
}

// Port detection from server output — same patterns as devServerRegistry
const PORT_PATTERNS = [
  /localhost:(\d{4,5})/i,
  /127\.0\.0\.1:(\d{4,5})/i,
  /0\.0\.0\.0:(\d{4,5})/i,
  /\bport[:\s]+(\d{4,5})/i,
  /listening.*?:(\d{4,5})/i,
  /started.*?:(\d{4,5})/i,
  /running.*?:(\d{4,5})/i,
  /server.*?:(\d{4,5})/i,
  /:(\d{4,5})\b/,
];

function detectPort(text: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

function enrichStderr(stderr: string, exitCode: number, normalized: string): string {
  let enriched = stderr;
  const notFoundMatch = enriched.match(
    /(?:sh|bash|zsh):\s*\d*:?\s*([^\s:]+):\s*(?:not found|command not found|No such file)/
  );
  const missingTool = notFoundMatch ? notFoundMatch[1] : null;
  if (exitCode === 127 || missingTool) {
    const tool = missingTool ?? normalized.split(" ")[0];
    let hint = `\n⚠️  "${tool}" não encontrado.\n`;
    const npmLocalTools = ["tsx", "ts-node", "vite", "react-scripts", "next", "tsc", "eslint", "prettier", "jest", "vitest", "esbuild", "rollup", "webpack"];
    if (npmLocalTools.includes(tool)) {
      hint += `   Este comando faz parte das dependências do projeto.\n   💡 Rode primeiro: npm install`;
    } else if (["npm", "node", "npx"].includes(tool)) {
      hint += `   O Node.js/npm não está disponível neste servidor.`;
    } else if (["python", "python3", "pip3"].includes(tool)) {
      hint += `   Python não está disponível neste ambiente.\n   Este servidor suporta apenas Node.js/npm.`;
    } else {
      hint += `   Verifique se está instalada ou tente: npm install -g ${tool}`;
    }
    enriched = (enriched ? enriched + "\n" : "") + hint;
  }
  return enriched;
}

// ── Streaming exec via SSE ─────────────────────────────────────────────────────
// Streams output line by line. Also detects if the command starts a server:
// when a port number appears in output, we hand off the process to devServerRegistry
// so it stays alive even after the browser disconnects from the SSE stream.
router.post("/projects/:projectId/exec-stream", async (req, res): Promise<void> => {
  const id = parseInt(req.params.projectId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const parsed = ExecCommandBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { command } = parsed.data;
  if (isCommandBlocked(command)) { res.status(400).json({ error: "Comando bloqueado por segurança." }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  await ensureProjectOnDisk(project.id, project.storagePath);

  const normalized = normalizeCommand(command);
  const isInstallCmd = /^(npm\s+install|npm\s+i\b|yarn\s+install|yarn\b|pnpm\s+install|pip3?\s+install|poetry\s+install|composer\s+install|bundle\s+install|cargo\s+build|go\s+get)/.test(normalized.trim());
  const isBuildCmd = /^(npm\s+run\s+build|vite\s+build|next\s+build|tsc\b)/.test(normalized.trim());
  const maxTimeout = isInstallCmd ? 600_000 : isBuildCmd ? 300_000 : 120_000;

  const cwd = path.resolve(project.storagePath);
  const start = Date.now();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type: string, payload: object) => {
    try { res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); } catch { /* client disconnected */ }
  };

  const proc = spawn("sh", ["-c", normalized], {
    cwd,
    env: buildEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrBuffer = "";
  let detectedPort: number | null = null;
  let logBuffer: string[] = [];
  let clientDisconnected = false;

  const PORT_QUESTION_RE = [
    /port.*(?:in use|already|busy|taken).*(?:use|try|switch|another)/i,
    /is in use.*would you like/i,
    /already in use.*use.*instead/i,
    /EADDRINUSE/i,
    /\?\s*(?:›|>)?\s*(?:y\/n|yes\/no|\(Y\/n\))/i,
  ];

  const INTERACTIVE_QUESTION_RE = [
    /\?\s*(?:›|>)\s*(?:Use|Router|TypeScript|CSS|Tailwind|ESLint|App Router|Pages)/i,
    /Would you like to use/i,
    /Do you want to/i,
    /\?\s*»\s/,
    /\(Y\/n\)/i,
    /\[y\/N\]/i,
    /\[Y\/n\]/i,
    /Yes\s*\/\s*No/i,
    /Press\s+(?:Enter|Return)/i,
  ];

  const handleChunk = (chunk: Buffer, streamType: "stdout" | "stderr") => {
    const text = chunk.toString();
    logBuffer.push(text);
    send(streamType, { data: text });

    if (PORT_QUESTION_RE.some((p) => p.test(text))) {
      try { proc.stdin?.write("y\n"); } catch {}
      send("stdout", { data: "\n[auto] Porta ocupada — aceitando automaticamente.\n" });
    }

    if (INTERACTIVE_QUESTION_RE.some((p) => p.test(text))) {
      try { proc.stdin?.write("\n"); } catch {}
      send("stdout", { data: "\n[auto] Pergunta interativa — aceitando padrão.\n" });
    }

    const port = detectPort(text);
    if (port !== null) {
      if (detectedPort === null) {
        detectedPort = port;
        registerTerminalProcess(id, proc, port, normalized, [...logBuffer]);
        send("server_detected", { port });
      } else if (port !== detectedPort) {
        detectedPort = port;
        registerTerminalProcess(id, proc, port, normalized, [...logBuffer]);
        send("server_detected", { port });
      }
    }

    if (streamType === "stderr") stderrBuffer += text;
  };

  proc.stdout.on("data", (chunk: Buffer) => handleChunk(chunk, "stdout"));
  proc.stderr.on("data", (chunk: Buffer) => handleChunk(chunk, "stderr"));

  proc.on("error", (err) => {
    send("stderr", { data: `\nErro ao iniciar processo: ${err.message}\n` });
  });

  proc.on("close", (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0);
    const durationMs = Date.now() - start;

    // Only send enriched stderr / exit if not handed off (server processes run forever)
    if (detectedPort === null) {
      const enriched = enrichStderr(stderrBuffer, exitCode, normalized);
      const extraHint = enriched.slice(stderrBuffer.length);
      if (extraHint) send("stderr", { data: extraHint });
      if (signal === "SIGTERM" && durationMs >= maxTimeout - 1000) {
        send("stderr", { data: `\n\n⏱️  Comando interrompido após ${Math.round(durationMs / 1000)}s (limite atingido).` });
      }
      send("exit", { exitCode, durationMs });
    } else {
      // Server was killed externally (Ctrl+C or stopDevServer)
      send("server_stopped", { exitCode, durationMs });
    }
    if (!clientDisconnected) res.end();
  });

  const timer = setTimeout(() => {
    if (detectedPort === null) {
      try { proc.kill("SIGTERM"); } catch {}
    }
  }, maxTimeout);

  proc.on("close", () => clearTimeout(timer));

  // When client disconnects from SSE:
  // - If server was detected (process handed off to registry) → DON'T kill the process
  // - Otherwise → kill the process
  req.on("close", () => {
    clientDisconnected = true;
    if (detectedPort === null) {
      try { proc.kill("SIGTERM"); } catch {}
      clearTimeout(timer);
    }
    // If detectedPort is set, process lives on in devServerRegistry
  });
});

// ── Legacy batch exec ──────────────────────────────────────────────────────────
router.post("/projects/:projectId/exec", async (req, res): Promise<void> => {
  const id = parseInt(req.params.projectId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const parsed = ExecCommandBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { command } = parsed.data;
  if (isCommandBlocked(command)) { res.status(400).json({ error: "Comando bloqueado por segurança." }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Projeto não encontrado" }); return; }

  await ensureProjectOnDisk(project.id, project.storagePath);

  const normalized = normalizeCommand(command);
  const isInstallCmd = /^(npm\s+install|npm\s+i\b|yarn|pnpm\s+install|pip3?\s+install)/.test(normalized.trim());
  const timeout = isInstallCmd ? 600_000 : 120_000;
  const cwd = path.resolve(project.storagePath);
  const start = Date.now();

  const proc = spawn("sh", ["-c", normalized], { cwd, env: buildEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
  proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

  const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeout);

  proc.on("close", (code) => {
    clearTimeout(timer);
    const exitCode = code ?? 1;
    const enriched = enrichStderr(stderr, exitCode, normalized);
    res.json({ stdout, stderr: enriched, exitCode, durationMs: Date.now() - start });
  });

  proc.on("error", () => {
    clearTimeout(timer);
    res.json({ stdout, stderr: "Erro ao iniciar o processo.", exitCode: 1, durationMs: Date.now() - start });
  });
});

export default router;
