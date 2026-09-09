import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Monitor,
  RefreshCw,
  ExternalLink,
  Play,
  Square,
  Loader2,
  Smartphone,
  Tablet,
  FileCode,
  Eye,
  Package,
  Hammer,
  Zap,
  CheckCircle2,
  Server,
  Wifi,
  WifiOff,
  AlertTriangle,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PreviewStatus {
  ready: boolean;
  entry: string | null;
}

interface DevServerStatus {
  running: boolean;
  port: number | null;
  status: "starting" | "running" | "error" | "stopped";
  command?: string;
  log?: string;
}

type Viewport = "desktop" | "tablet" | "mobile";
type PreviewMode = "static" | "live";

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

interface PreviewPanelProps {
  projectId: string;
  onRunBuild?: (cmd: string) => void;
  previewPath?: string;
  /** Port detected from terminal output — automatically connects preview without clicking "Iniciar" */
  terminalPort?: number | null;
}

export function PreviewPanel({ projectId, onRunBuild, previewPath, terminalPort }: PreviewPanelProps) {
  const [staticStatus, setStaticStatus] = useState<PreviewStatus | null>(null);
  const [devStatus, setDevStatus] = useState<DevServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [mode, setMode] = useState<PreviewMode>("live");
  const [startingServer, setStartingServer] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

  // ── Fetch static preview status ──────────────────────────────────────────
  const fetchStaticStatus = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/projects/${projectId}/preview/status`);
      setStaticStatus(await res.json());
    } catch {
      setStaticStatus({ ready: false, entry: null });
    }
  }, [projectId, base]);

  // ── Fetch dev server status ───────────────────────────────────────────────
  const fetchDevStatus = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/projects/${projectId}/dev-server/status`);
      const data: DevServerStatus = await res.json();
      setDevStatus(data);
      return data;
    } catch {
      return null;
    }
  }, [projectId, base]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchStaticStatus(), fetchDevStatus()]);
      setLoading(false);
    };
    init();
  }, [fetchStaticStatus, fetchDevStatus]);

  const [autoInstalling, setAutoInstalling] = useState(false);

  useEffect(() => {
    if (!startingServer) return;
    const interval = setInterval(async () => {
      const s = await fetchDevStatus();
      if (!s) return;
      if (s.status === "running" || s.status === "error" || (s.status === "stopped" && !s.running)) {
        setStartingServer(false);
        setAutoInstalling(false);
        if (s.status === "running") setIframeKey((k) => k + 1);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [startingServer, fetchDevStatus]);

  useEffect(() => { setIframeKey((k) => k + 1); }, [previewPath]);

  useEffect(() => {
    if (terminalPort) {
      setMode("live");
      setIframeKey((k) => k + 1);
    }
  }, [terminalPort]);

  const startServer = async () => {
    setStartingServer(true);
    setAutoInstalling(false);
    try {
      const res = await fetch(`${base}/api/projects/${projectId}/dev-server/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data: DevServerStatus & { port?: number; autoInstall?: boolean } = await res.json();
      if (data.autoInstall) setAutoInstalling(true);
      setDevStatus({ running: data.running ?? false, port: data.port ?? null, status: data.status ?? "starting" });
      if (data.status === "running" && data.port) {
        setStartingServer(false);
        setAutoInstalling(false);
        setIframeKey((k) => k + 1);
      }
    } catch {
      setStartingServer(false);
      setAutoInstalling(false);
    }
  };

  const stopServer = async () => {
    await fetch(`${base}/api/projects/${projectId}/dev-server/stop`, { method: "DELETE" });
    setDevStatus({ running: false, port: null, status: "stopped" });
    setIframeKey((k) => k + 1);
  };

  const reload = () => {
    fetchStaticStatus();
    fetchDevStatus();
    setIframeKey((k) => k + 1);
  };

  // ── Compute iframe URL ───────────────────────────────────────────────────
  const isFilePreview = !!previewPath;

  // Active live port: prefer terminal-detected port, fall back to devServerRegistry port
  const activeLivePort = terminalPort ?? devStatus?.port ?? null;

  let iframeUrl = "";
  if (mode === "live" && activeLivePort) {
    const livePath = isFilePreview ? previewPath.replace(/^\//, "") : "";
    if (terminalPort) {
      // Use simple port proxy (no process management needed)
      iframeUrl = `${base}/api/projects/${projectId}/port-proxy/${terminalPort}/${livePath}`;
    } else {
      iframeUrl = `${base}/api/projects/${projectId}/dev-proxy/${livePath}`;
    }
  } else {
    const staticPath = isFilePreview ? previewPath.replace(/^\//, "") : "";
    iframeUrl = `${base}/api/projects/${projectId}/preview/${staticPath}`;
  }

  const isServerRunning = !!activeLivePort && (terminalPort ? true : devStatus?.status === "running");
  const isServerStarting = startingServer || devStatus?.status === "starting";
  const canShowIframe = mode === "live"
    ? isServerRunning
    : (isFilePreview || staticStatus?.ready);

  return (
    <div className="h-full w-full flex flex-col bg-[#0d1117]">
      {/* Toolbar */}
      <div className="h-10 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2">
        <Monitor className="w-4 h-4 text-[#8b949e] shrink-0" />

        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-[#0d1117] rounded p-0.5">
          <button
            onClick={() => setMode("live")}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
              mode === "live"
                ? "bg-[#30363d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            )}
            title="Servidor ao vivo (npm run dev / npm start)"
          >
            <Server className="w-3 h-3" />
            Ao Vivo
          </button>
          <button
            onClick={() => setMode("static")}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
              mode === "static"
                ? "bg-[#30363d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            )}
            title="Preview estático (HTML ou build)"
          >
            <FileCode className="w-3 h-3" />
            Build
          </button>
        </div>

        <div className="w-px h-4 bg-[#30363d]" />

        {/* Server start/stop */}
        {mode === "live" && (
          <>
            {isServerRunning ? (
              <button
                onClick={stopServer}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
                title="Parar servidor"
              >
                <Square className="w-3 h-3" />
                Parar
              </button>
            ) : (
              <button
                onClick={startServer}
                disabled={isServerStarting}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-colors disabled:opacity-60"
                title="Iniciar servidor de desenvolvimento"
              >
                {isServerStarting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {isServerStarting ? "Iniciando…" : "Iniciar"}
              </button>
            )}

            {/* Server status indicator */}
            <span className={cn(
              "text-[10px] flex items-center gap-1",
              isServerRunning ? "text-green-400" : isServerStarting ? "text-yellow-400" : "text-[#8b949e]"
            )}>
              {isServerRunning ? <Wifi className="w-3 h-3" /> : isServerStarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <WifiOff className="w-3 h-3" />}
              {isServerRunning
                ? `porta ${activeLivePort}${terminalPort ? " (terminal)" : ""}`
                : isServerStarting ? "aguardando…" : "parado"
              }
            </span>

            {devStatus?.log && (
              <button
                onClick={() => setShowLog((v) => !v)}
                className="text-[10px] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
                title="Ver log do servidor"
              >
                <Terminal className="w-3 h-3" />
              </button>
            )}
          </>
        )}

        {mode === "static" && onRunBuild && !staticStatus?.ready && !isFilePreview && (
          <button
            onClick={() => onRunBuild("npm install && npm run build")}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 transition-colors"
          >
            <Zap className="w-3 h-3" />
            Build
          </button>
        )}

        <span className="flex-1" />

        {/* Viewport switcher */}
        <div className="flex items-center gap-0.5 bg-[#0d1117] rounded px-0.5 py-0.5">
          {(["desktop", "tablet", "mobile"] as Viewport[]).map((v) => {
            const Icon = v === "desktop" ? Monitor : v === "tablet" ? Tablet : Smartphone;
            return (
              <button
                key={v}
                onClick={() => setViewport(v)}
                className={cn(
                  "p-1 rounded transition-colors",
                  viewport === v ? "bg-[#30363d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"
                )}
                title={v}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>

        <div className="w-px h-4 bg-[#30363d]" />

        <button
          onClick={reload}
          className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          title="Recarregar"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {canShowIframe && (
          <button
            onClick={() => window.open(iframeUrl, "_blank")}
            className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
            title="Abrir em nova aba"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Server log panel */}
      {showLog && devStatus?.log && (
        <div className="shrink-0 max-h-32 overflow-auto bg-[#0d1117] border-b border-[#30363d] p-2">
          <pre className="text-[10px] text-[#8b949e] whitespace-pre-wrap">{devStatus.log}</pre>
        </div>
      )}

      {/* File entry label */}
      {mode === "static" && (staticStatus?.entry || isFilePreview) && (
        <div className="shrink-0 px-3 py-1 bg-[#161b22] border-b border-[#30363d] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-[10px] text-[#8b949e] font-mono truncate">
            {isFilePreview ? previewPath : staticStatus!.entry}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto flex items-start justify-center bg-[#1a1f26]">
        {loading ? (
          <div className="flex-1 h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-[#8b949e]" />
          </div>
        ) : mode === "live" ? (
          isServerRunning ? (
            <IframeView
              url={iframeUrl}
              iframeKey={iframeKey}
              iframeRef={iframeRef}
              viewport={viewport}
            />
          ) : (
            <LiveEmptyState
              isStarting={isServerStarting}
              isInstalling={autoInstalling}
              status={devStatus}
              onStart={startServer}
            />
          )
        ) : (
          canShowIframe ? (
            <IframeView
              url={iframeUrl}
              iframeKey={iframeKey}
              iframeRef={iframeRef}
              viewport={viewport}
            />
          ) : (
            <StaticEmptyState onRunBuild={onRunBuild} onReload={reload} />
          )
        )}
      </div>
    </div>
  );
}

// ─── Iframe view ──────────────────────────────────────────────────────────────
function IframeView({
  url,
  iframeKey,
  iframeRef,
  viewport,
}: {
  url: string;
  iframeKey: number;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  viewport: Viewport;
}) {
  return (
    <div
      className={cn(
        "h-full bg-white transition-all duration-300",
        viewport === "desktop" ? "w-full" : "shadow-2xl"
      )}
      style={{
        width: VIEWPORT_WIDTHS[viewport],
        minWidth: viewport !== "desktop" ? VIEWPORT_WIDTHS[viewport] : undefined,
      }}
    >
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={url}
        className="w-full h-full border-0"
        title="Project Preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

// ─── Live empty state ─────────────────────────────────────────────────────────
function LiveEmptyState({
  isStarting,
  isInstalling,
  status,
  onStart,
}: {
  isStarting: boolean;
  isInstalling: boolean;
  status: DevServerStatus | null;
  onStart: () => void;
}) {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 text-[#8b949e] px-6 text-center max-w-sm mx-auto">
      <div className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center",
        isStarting ? "bg-yellow-500/10" : "bg-[#30363d]"
      )}>
        {isStarting ? (
          <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
        ) : (
          <Server className="w-6 h-6 opacity-40" />
        )}
      </div>

      {isStarting ? (
        <>
          <div>
            <p className="text-sm font-semibold text-yellow-400 mb-1">
              {isInstalling ? "Instalando dependências…" : "Iniciando servidor…"}
            </p>
            <p className="text-xs text-[#8b949e]">
              {isInstalling
                ? "npm install em andamento. Depois, o servidor será iniciado automaticamente."
                : "Aguardando o servidor responder. Pode levar alguns segundos."}
            </p>
          </div>
        </>
      ) : status?.status === "error" ? (
        <>
          <div>
            <p className="text-sm font-semibold text-red-400 mb-1">Erro ao iniciar servidor</p>
            <p className="text-xs text-[#8b949e]">
              Verifique o terminal para mais detalhes.
            </p>
          </div>
          <button
            onClick={onStart}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar novamente
          </button>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold text-[#c9d1d9] mb-1">Servidor parado</p>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              Clique em <strong className="text-green-400">Iniciar</strong> para rodar o servidor do projeto e ver o resultado ao vivo.
            </p>
          </div>
          <div className="w-full space-y-2 text-left text-[11px]">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2.5">
              <p className="text-[#8b949e] mb-1">Funciona para:</p>
              <ul className="text-[#c9d1d9] space-y-0.5">
                <li className="flex items-center gap-1.5"><span className="text-green-400">✓</span> Node.js / Express</li>
                <li className="flex items-center gap-1.5"><span className="text-green-400">✓</span> React + Vite (dev)</li>
                <li className="flex items-center gap-1.5"><span className="text-green-400">✓</span> Next.js, Vue, Angular</li>
                <li className="flex items-center gap-1.5"><span className="text-green-400">✓</span> Qualquer <code>npm start</code></li>
              </ul>
            </div>
          </div>
          <button
            onClick={onStart}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 text-sm font-semibold transition-colors"
          >
            <Play className="w-4 h-4" />
            Iniciar Servidor
          </button>
        </>
      )}
    </div>
  );
}

// ─── Static empty state ───────────────────────────────────────────────────────
function StaticEmptyState({
  onRunBuild,
  onReload,
}: {
  onRunBuild?: (cmd: string) => void;
  onReload: () => void;
}) {
  const [buildStep, setBuildStep] = useState<"idle" | "running" | "done">("idle");

  const runInstallAndBuild = () => {
    if (!onRunBuild) return;
    setBuildStep("running");
    onRunBuild("npm install && npm run build");
  };

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 text-[#8b949e] px-6 text-center max-w-sm mx-auto">
      <Monitor className="w-10 h-10 opacity-20" />

      <div>
        <p className="text-sm font-semibold text-[#c9d1d9] mb-1">Build não encontrado</p>
        <p className="text-xs text-[#8b949e]">
          Nenhum <code>index.html</code> ou pasta <code>dist/</code> encontrada.
        </p>
      </div>

      <div className="w-full space-y-2 text-left">
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-[#c9d1d9]">React / Vite / Vue</span>
          </div>
          {onRunBuild && (
            <div className="space-y-1.5">
              {buildStep === "idle" && (
                <button
                  onClick={runInstallAndBuild}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 text-xs font-medium transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  npm install + npm run build
                </button>
              )}
              {buildStep === "running" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-[11px] text-yellow-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Executando no terminal… acompanhe o progresso lá
                </div>
              )}
              <div className="flex gap-1.5">
                <button onClick={() => { onRunBuild("npm install"); setBuildStep("running"); }} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#30363d] hover:bg-[#3a4048] text-[10px] text-[#8b949e] hover:text-[#e6edf3] transition-colors border border-[#444c56]">
                  <Package className="w-3 h-3" /> npm install
                </button>
                <button onClick={() => { onRunBuild("npm run build"); setBuildStep("running"); }} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#30363d] hover:bg-[#3a4048] text-[10px] text-[#8b949e] hover:text-[#e6edf3] transition-colors border border-[#444c56]">
                  <Hammer className="w-3 h-3" /> npm run build
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2">
            <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="text-xs font-semibold text-[#c9d1d9]">HTML / CSS / JS puro</span>
          </div>
          <p className="text-[11px] text-[#8b949e]">
            Abra o arquivo <code className="text-orange-300">.html</code> — o botão <span className="text-blue-400 font-medium">👁 Visualizar</span> aparece na barra do editor.
          </p>
        </div>
      </div>

      <button onClick={onReload} className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3] text-xs transition-colors">
        <RefreshCw className="w-3.5 h-3.5" />
        Verificar novamente
      </button>
    </div>
  );
}
