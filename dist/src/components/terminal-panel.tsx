import React, { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, Loader2, X, ChevronRight, Trash2, Copy, Check, Mic, MicOff, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Voice hook ────────────────────────────────────────────────────────────────
function useVoice(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const toggle = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      onResult(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }, [listening, onResult]);

  return { listening, toggle };
}

// ─── Missing package detection ─────────────────────────────────────────────────
const CLI_TO_PACKAGE: Record<string, string> = {
  tsx: "tsx", "ts-node": "ts-node", vite: "vite", "react-scripts": "react-scripts",
  next: "next", tsc: "typescript", eslint: "eslint", prettier: "prettier",
  jest: "jest", vitest: "vitest", esbuild: "esbuild", rollup: "rollup",
  webpack: "webpack", nodemon: "nodemon", concurrently: "concurrently",
  "cross-env": "cross-env",
};

function detectMissingPackage(text: string): string | null {
  const shellNotFound = text.match(/(?:sh|bash|zsh):\s*\d*:?\s*([^\s:]+):\s*(?:not found|command not found)/);
  if (shellNotFound && CLI_TO_PACKAGE[shellNotFound[1]]) return "__install_deps__";

  const cannotFind = text.match(/Cannot find module ['"](@?[a-zA-Z0-9._/-]+)['"]/);
  if (cannotFind) {
    const mod = cannotFind[1];
    if (!mod.startsWith(".") && !mod.startsWith("/"))
      return mod.split("/").slice(0, mod.startsWith("@") ? 2 : 1).join("/");
  }

  const npmMissing = text.match(/npm ERR! missing: ([a-zA-Z0-9@._/-]+)@/);
  if (npmMissing) return npmMissing[1].split("/").slice(0, npmMissing[1].startsWith("@") ? 2 : 1).join("/");

  const cannotFindPkg = text.match(/Cannot find package ['"](@?[a-zA-Z0-9._/-]+)['"]/);
  if (cannotFindPkg) {
    const mod = cannotFindPkg[1];
    if (!mod.startsWith(".") && !mod.startsWith("/")) return mod;
  }

  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface OutputChunk {
  type: "stdout" | "stderr";
  text: string;
}

export interface TerminalEntry {
  id: number;
  command: string;
  chunks: OutputChunk[];        // live output chunks
  running: boolean;
  exitCode: number | null;      // null while running
  durationMs: number;
  missingPackage?: string | null;
}

interface TerminalPanelProps {
  projectId: string;
  onClose?: () => void;
  pendingCommand?: { cmd: string; id: number } | null;
  onEntriesChange?: (entries: TerminalEntry[]) => void;
  onServerDetected?: (port: number) => void;
  onCommandDone?: () => void;
}

// ─── Base URL helper ───────────────────────────────────────────────────────────
function getBase() {
  return (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
}

// ─── Render a single output chunk line with smart color ───────────────────────
function ChunkLine({ type, text, exitCode }: { type: "stdout" | "stderr"; text: string; exitCode: number | null }) {
  if (type === "stdout") {
    return <span className="text-[#c9d1d9]">{text}</span>;
  }
  // stderr coloring
  const isNpmWarn = /npm warn/i.test(text);
  const isNpmErr = /npm err!/i.test(text);
  const failed = exitCode !== null && exitCode !== 0;

  if (failed || isNpmErr) return <span className="text-[#f85149]">{text}</span>;
  if (isNpmWarn) return <span className="text-yellow-400/80">{text}</span>;
  return <span className="text-[#6e7681]">{text}</span>;
}

// ─── Single terminal entry display ────────────────────────────────────────────
function EntryView({ entry, onInstall, onCopy, copiedId }: {
  entry: TerminalEntry;
  onInstall: (cmd: string) => void;
  onCopy: (entry: TerminalEntry) => void;
  copiedId: number | null;
}) {
  const allText = entry.chunks.map(c => c.text).join("");
  const stderrText = entry.chunks.filter(c => c.type === "stderr").map(c => c.text).join("");

  return (
    <div className="space-y-1">
      {/* Command line */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-green-400 shrink-0">$</span>
        <span className="text-[#e6edf3] flex-1 break-all">{entry.command}</span>
        <button
          className="shrink-0 text-[#8b949e] hover:text-[#e6edf3] transition-colors"
          onClick={() => onCopy(entry)}
          title="Copiar saída"
        >
          {copiedId === entry.id ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>

        {/* Status badge */}
        {entry.running ? (
          <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            rodando
          </span>
        ) : (
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded-full",
            entry.exitCode === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
          )}>
            {entry.exitCode === 0 ? "OK" : `exit ${entry.exitCode}`}
          </span>
        )}
        {!entry.running && entry.durationMs > 0 && (
          <span className="text-[#8b949e] text-[9px] shrink-0">
            {entry.durationMs >= 60000
              ? `${Math.round(entry.durationMs / 1000)}s`
              : entry.durationMs >= 1000
              ? `${(entry.durationMs / 1000).toFixed(1)}s`
              : `${entry.durationMs}ms`}
          </span>
        )}
      </div>

      {/* Live output */}
      {entry.chunks.length > 0 && (
        <pre className="text-[11px] whitespace-pre-wrap break-words pl-4 leading-relaxed">
          {entry.chunks.map((chunk, i) => (
            <ChunkLine key={i} type={chunk.type} text={chunk.text} exitCode={entry.exitCode} />
          ))}
          {entry.running && (
            <span className="inline-block w-2 h-3 bg-green-400 animate-pulse ml-0.5 align-middle" />
          )}
        </pre>
      )}

      {/* Missing package suggestion */}
      {!entry.running && entry.missingPackage && (
        entry.missingPackage === "__install_deps__" ? (
          <div className="flex items-center gap-2 mt-1 ml-4 p-2 rounded bg-yellow-400/10 border border-yellow-400/30">
            <Download className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <span className="text-[11px] text-yellow-300 flex-1">
              Dependências não instaladas. Rode o <code className="font-bold">npm install</code> primeiro.
            </span>
            <button
              onClick={() => onInstall("npm install")}
              className="text-[10px] font-semibold px-2 py-1 rounded bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-300 border border-yellow-400/30 transition-colors shrink-0"
            >
              npm install
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1 ml-4 p-2 rounded bg-yellow-400/10 border border-yellow-400/30">
            <Download className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <span className="text-[11px] text-yellow-300 flex-1">
              Pacote <code className="font-bold">{entry.missingPackage}</code> não encontrado.
            </span>
            <button
              onClick={() => onInstall(`npm install ${entry.missingPackage}`)}
              className="text-[10px] font-semibold px-2 py-1 rounded bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-300 border border-yellow-400/30 transition-colors shrink-0"
            >
              instalar
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function TerminalPanel({ projectId, onClose, pendingCommand, onEntriesChange, onServerDetected, onCommandDone }: TerminalPanelProps) {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [lastPendingId, setLastPendingId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const entryCounter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const { listening, toggle: toggleVoice } = useVoice((text) => {
    setInput((prev) => (prev ? prev + " " + text : text));
    setTimeout(() => inputRef.current?.focus(), 50);
  });

  // Auto-scroll to bottom on output changes
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  useEffect(() => {
    onEntriesChange?.(entries);
  }, [entries, onEntriesChange]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const commandHistory = entries.map((e) => e.command);

  // ── Streaming command runner ──────────────────────────────────────────────
  const runCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || isRunning) return;

    setInput("");
    setHistoryIndex(-1);
    setIsRunning(true);

    const id = ++entryCounter.current;

    const newEntry: TerminalEntry = {
      id,
      command: trimmed,
      chunks: [],
      running: true,
      exitCode: null,
      durationMs: 0,
      missingPackage: null,
    };

    setEntries((prev) => [...prev, newEntry]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(
        `${getBase()}/api/projects/${projectId}/exec-stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: trimmed }),
          signal: abort.signal,
        }
      );

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Erro desconhecido");
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, running: false, exitCode: 1, chunks: [{ type: "stderr", text: `Erro: ${errText}` }], durationMs: 0 }
              : e
          )
        );
        setIsRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "stdout") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, chunks: [...e.chunks, { type: "stdout", text: event.data }] }
                    : e
                )
              );
            } else if (event.type === "stderr") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, chunks: [...e.chunks, { type: "stderr", text: event.data }] }
                    : e
                )
              );
            } else if (event.type === "server_detected") {
              const port: number = event.port;
              // Add a notice in the terminal output
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, chunks: [...e.chunks, { type: "stdout", text: `\n🌐 Servidor detectado na porta ${port} — preview conectado!\n` }] }
                    : e
                )
              );
              onServerDetected?.(port);
            } else if (event.type === "server_stopped") {
              const exitCode: number = event.exitCode ?? 0;
              const durationMs: number = event.durationMs ?? 0;
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, running: false, exitCode, durationMs, chunks: [...e.chunks, { type: "stderr", text: "\n[servidor encerrado]\n" }] }
                    : e
                )
              );
            } else if (event.type === "exit") {
              const exitCode: number = event.exitCode ?? 1;
              const durationMs: number = event.durationMs ?? 0;
              setEntries((prev) =>
                prev.map((e) => {
                  if (e.id !== id) return e;
                  const allText = e.chunks.map(c => c.text).join("");
                  const missingPackage = exitCode !== 0 ? detectMissingPackage(allText) : null;
                  return { ...e, running: false, exitCode, durationMs, missingPackage };
                })
              );
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, running: false, exitCode: 1, chunks: [...e.chunks, { type: "stderr", text: `\nErro de conexão: ${err.message}` }], durationMs: 0 }
            : e
        )
      );
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
      onCommandDone?.();
    }
  }, [projectId, isRunning, onCommandDone]);

  // Auto-run command sent from outside (AI panel / packages panel)
  useEffect(() => {
    if (pendingCommand && pendingCommand.id !== lastPendingId) {
      setLastPendingId(pendingCommand.id);
      runCommand(pendingCommand.cmd);
    }
  }, [pendingCommand, runCommand, lastPendingId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[commandHistory.length - 1 - newIndex] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      setInput(newIndex === -1 ? "" : (commandHistory[commandHistory.length - 1 - newIndex] ?? ""));
    } else if (e.key === "c" && e.ctrlKey) {
      // Ctrl+C to kill running process
      if (isRunning && abortRef.current) {
        abortRef.current.abort();
        setEntries((prev) =>
          prev.map((e) => e.running ? { ...e, running: false, exitCode: 130, chunks: [...e.chunks, { type: "stderr", text: "\n^C interrompido" }] } : e)
        );
        setIsRunning(false);
      }
    }
  };

  const copyOutput = (entry: TerminalEntry) => {
    const text = entry.chunks.map(c => c.text).join("");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#e6edf3] font-mono text-xs">
      {/* Header */}
      <div className="h-9 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2">
        <Terminal className="w-3.5 h-3.5 text-green-400" />
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider flex-1">Terminal</span>
        {isRunning && (
          <span className="text-[10px] text-yellow-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            rodando…
          </span>
        )}
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d]"
          onClick={() => setEntries([])}
          title="Limpar terminal"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
        {onClose && (
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d]"
            onClick={onClose}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-auto p-3 space-y-4">
        {entries.length === 0 && (
          <div className="text-[#8b949e] text-[11px] space-y-1">
            <p>Terminal pronto. Digite ou fale um comando abaixo.</p>
            <p className="text-[10px] opacity-60">↑ ↓ para histórico · Ctrl+C para cancelar</p>
          </div>
        )}

        {entries.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            onInstall={runCommand}
            onCopy={copyOutput}
            copiedId={copiedId}
          />
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#30363d] bg-[#0d1117] flex items-center px-3 py-3 gap-2">
        <ChevronRight className="w-3.5 h-3.5 text-green-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? "aguarde… (Ctrl+C para cancelar)" : "npm install, git status, node server.js…"}
          className="flex-1 bg-transparent outline-none text-sm text-[#e6edf3] placeholder:text-[#8b949e] font-mono"
          disabled={isRunning}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={toggleVoice}
          disabled={isRunning}
          className={cn(
            "shrink-0 p-1.5 rounded transition-colors",
            listening ? "text-red-400 bg-red-400/20 animate-pulse" : "text-[#8b949e] hover:text-[#e6edf3]",
            isRunning && "opacity-30"
          )}
          title={listening ? "Parar gravação" : "Falar comando"}
        >
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
