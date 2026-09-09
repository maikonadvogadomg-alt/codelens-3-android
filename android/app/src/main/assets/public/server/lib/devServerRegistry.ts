import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";

export type DevServerStatus = "starting" | "running" | "error" | "stopped";

export interface DevServer {
  process: ChildProcess | null;
  port: number | null;
  status: DevServerStatus;
  log: string[];
  command: string;
  startedAt: Date;
}

const registry = new Map<number, DevServer>();

// Port detection from stdout/stderr
const PORT_PATTERNS = [
  /localhost:(\d{4,5})/i,
  /127\.0\.0\.1:(\d{4,5})/i,
  /0\.0\.0\.0:(\d{4,5})/i,
  /port[:\s]+(\d{4,5})/i,
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

// Determine best start command from project files
export function detectStartCommand(cwd: string): string {
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const hasTsx = !!(pkg.devDependencies?.tsx || pkg.dependencies?.tsx);

      if (scripts.dev) {
        const devCmd = scripts.dev.trim();
        if (devCmd === "vite" || devCmd.startsWith("vite ")) {
          const serverEntry = ["server/index.ts", "server/index.js", "server.ts", "src/server.ts"].find(
            (f) => fs.existsSync(path.join(cwd, f))
          );
          if (serverEntry) {
            if (hasTsx) return `npx tsx ${serverEntry}`;
            if (serverEntry.endsWith(".js")) return `node ${serverEntry}`;
          }
        }
        return "npm run dev";
      }
      if (scripts.start) return "npm start";
      if (scripts.serve) return "npm run serve";
    }
  } catch { /* ignore */ }

  const tsEntries = ["server/index.ts", "server.ts", "src/server.ts"];
  for (const c of tsEntries) {
    if (fs.existsSync(path.join(cwd, c))) return `npx tsx ${c}`;
  }

  const candidates = ["index.js", "server.js", "app.js", "main.js", "server/index.js", "src/index.js", "src/server.js"];
  for (const c of candidates) {
    if (fs.existsSync(path.join(cwd, c))) return `node ${c}`;
  }

  return "npm start";
}

export function needsInstall(cwd: string): boolean {
  const pkgPath = path.join(cwd, "package.json");
  const nodeModulesPath = path.join(cwd, "node_modules");
  return fs.existsSync(pkgPath) && !fs.existsSync(nodeModulesPath);
}

const ALLOWED_START_COMMANDS = new Set([
  "npm run dev", "npm start", "npm run serve", "npm run build",
  "npm test", "npm install",
  "yarn dev", "yarn start", "yarn build",
  "pnpm dev", "pnpm start", "pnpm run dev", "pnpm run start",
  "python3 -m http.server", "python -m http.server",
]);

function isAllowedCommand(cmd: string): boolean {
  if (ALLOWED_START_COMMANDS.has(cmd)) return true;
  if (/^node\s+[\w./-]+\.m?js$/.test(cmd)) return true;
  if (/^npx\s+tsx\s+[\w./-]+\.ts$/.test(cmd)) return true;
  if (/^python3?\s+[\w./-]+\.py$/.test(cmd)) return true;
  return false;
}

function buildCleanEnv(): Record<string, string> {
  const cleanEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (typeof val !== "string") continue;
    if (key.toLowerCase().startsWith("npm_config_") && (
      key.toLowerCase().includes("jsr") ||
      key.toLowerCase().includes("catalog") ||
      key.toLowerCase().includes("release_age") ||
      key.toLowerCase().includes("globalconfig") ||
      key.toLowerCase().includes("verify_deps") ||
      key.toLowerCase().includes("recursive") ||
      key.toLowerCase().includes("overrides")
    )) continue;
    cleanEnv[key] = val;
  }
  return cleanEnv;
}

function spawnInProject(cmd: string, cwd: string, env: Record<string, string>): ChildProcess {
  const [bin, ...args] = cmd.split(/\s+/);
  const proc = spawn(bin, args, {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  proc.unref();
  return proc;
}

function killProcessGroup(proc: ChildProcess): void {
  const pid = proc.pid;
  if (!pid) return;
  try { process.kill(-pid, "SIGTERM"); } catch {}
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch {}
  }, 2000);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "0.0.0.0");
  });
}

async function waitForPortFree(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortFree(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  try { execSync(`fuser -k ${port}/tcp 2>/dev/null`, { timeout: 2000 }); } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

export async function startDevServer(projectId: number, cwd: string, command?: string): Promise<DevServer> {
  await stopDevServer(projectId);

  const startCmd = command && isAllowedCommand(command) ? command : detectStartCommand(cwd);
  const autoInstall = needsInstall(cwd);

  const cleanEnv = buildCleanEnv();
  const projectEnv: Record<string, string> = {
    ...cleanEnv,
    BROWSER: "none",
    CI: "false",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PORT: "3000",
    npm_config_userconfig: "/dev/null",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };

  const displayCmd = autoInstall ? `npm install && ${startCmd}` : startCmd;

  const server: DevServer = {
    process: null,
    port: null,
    status: "starting",
    log: autoInstall ? ["[auto] Instalando dependências antes de iniciar…\n"] : [],
    command: displayCmd,
    startedAt: new Date(),
  };

  registry.set(projectId, server);

  const PORT_QUESTION_PATTERNS = [
    /port.*(?:in use|already|busy|taken).*(?:use|try|switch|another)/i,
    /is in use.*would you like/i,
    /already in use.*use.*instead/i,
    /EADDRINUSE/i,
    /\?\s*(?:›|>)?\s*(?:y\/n|yes\/no|\(Y\/n\))/i,
  ];

  const attachListeners = (proc: ChildProcess, isServerProc: boolean) => {
    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      server.log = [...server.log.slice(-199), text];

      if (isServerProc) {
        const isPortQuestion = PORT_QUESTION_PATTERNS.some((p) => p.test(text));
        if (isPortQuestion) {
          server.log.push("[auto] Porta ocupada — aceitando automaticamente.\n");
          try { proc.stdin?.write("y\n"); } catch {}
        }

        const detected = detectPort(text);
        if (detected) {
          server.port = detected;
          server.status = "running";
        }
      }
    };
    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.on("error", (err) => {
      server.status = "error";
      server.log.push(`[erro] ${err.message}`);
    });
  };

  const targetPort = parseInt(projectEnv.PORT, 10) || 3000;

  const launchServer = async () => {
    await waitForPortFree(targetPort);
    const proc = spawnInProject(startCmd, cwd, projectEnv);
    server.process = proc;
    attachListeners(proc, true);

    proc.on("close", (code) => {
      server.status = code === 0 ? "stopped" : "error";
      server.process = null;
      setTimeout(() => {
        const current = registry.get(projectId);
        if (current === server && (current.status === "stopped" || current.status === "error")) {
          registry.delete(projectId);
        }
      }, 30_000);
    });

    const timer = setTimeout(() => {
      if (server.status === "starting" && !server.port) {
        server.port = 3000;
        server.status = "running";
      }
    }, 30_000);
    proc.on("close", () => clearTimeout(timer));
  };

  if (autoInstall) {
    const installProc = spawnInProject("npm install", cwd, projectEnv);
    server.process = installProc;
    attachListeners(installProc, false);

    installProc.on("close", (code) => {
      if (code === 0) {
        server.log.push("[auto] Dependências instaladas. Iniciando servidor…\n");
        launchServer();
      } else {
        server.status = "error";
        server.log.push(`[erro] npm install falhou (código ${code})\n`);
        registry.delete(projectId);
      }
    });
  } else {
    launchServer();
  }

  return server;
}

export async function stopDevServer(projectId: number): Promise<boolean> {
  const server = registry.get(projectId);
  if (!server) return false;
  const proc = server.process;
  registry.delete(projectId);
  if (!proc || proc.exitCode !== null) return true;
  killProcessGroup(proc);
  await new Promise((r) => setTimeout(r, 1000));
  return true;
}

export function getDevServer(projectId: number): DevServer | null {
  return registry.get(projectId) ?? null;
}

// Register a process that was started externally (e.g. from terminal exec-stream)
// This keeps the process alive even after the SSE connection closes.
export function registerTerminalProcess(
  projectId: number,
  proc: ChildProcess,
  port: number,
  command: string,
  existingLog: string[]
): DevServer {
  // Kill any existing server for this project first
  stopDevServer(projectId);

  const server: DevServer = {
    process: proc,
    port,
    status: "running",
    log: existingLog,
    command,
    startedAt: new Date(),
  };

  registry.set(projectId, server);

  // Continue collecting log
  const handleOutput = (data: Buffer) => {
    server.log = [...server.log.slice(-199), data.toString()];
  };
  proc.stdout?.on("data", handleOutput);
  proc.stderr?.on("data", handleOutput);

  proc.on("close", (code) => {
    server.status = code === 0 ? "stopped" : "error";
    registry.delete(projectId);
  });

  return server;
}

export function listDevServers(): Array<{ projectId: number; port: number | null; status: DevServerStatus; command: string }> {
  return Array.from(registry.entries()).map(([projectId, s]) => ({
    projectId,
    port: s.port,
    status: s.status,
    command: s.command,
  }));
}
