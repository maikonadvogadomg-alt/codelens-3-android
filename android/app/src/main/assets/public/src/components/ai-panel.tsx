import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.min.css";
import {
  Sparkles,
  Loader2,
  Send,
  Bot,
  User,
  RefreshCw,
  File,
  FolderOpen,
  Minus,
  ChevronDown,
  Check,
  Trash2,
  FilePlus,
  FilePen,
  AlertCircle,
  Terminal,
  Play,
  Mic,
  MicOff,
  Lightbulb,
  Bug,
  BookOpen,
  Search,
  GitBranch,
  Shield,
  Copy,
  CheckCheck,
  Layers,
  VolumeX,
  AudioLines,
} from "lucide-react";
import {
  useAiChat,
  useWriteFile,
  useDeleteFile,
  getGetProjectQueryKey,
} from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ─── Voice hook (shared pattern) ─────────────────────────────────────────────
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
      onResult(e.results[0][0].transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }, [listening, onResult]);

  return { listening, toggle };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

type ContextMode = "none" | "file" | "project";

export interface TerminalLogEntry {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface AiPanelProps {
  projectId: string;
  fileContext?: { path: string; content: string; language: string } | null;
  externalMessage?: { text: string; id: number; contextMode?: ContextMode } | null;
  onRunCommand?: (cmd: string) => void;
  /** Recent terminal entries - sent automatically as context with every message */
  terminalLog?: TerminalLogEntry[];
}

// ─── File change parser ───────────────────────────────────────────────────────

type Segment =
  | { type: "text"; content: string }
  | { type: "write"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "exec"; command: string };

function parseAiMessage(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern =
    /<codelens-write\s+path="([^"]+)">([\s\S]*?)<\/codelens-write>|<codelens-delete\s+path="([^"]+)"\s*\/>|<codelens-exec>([\s\S]*?)<\/codelens-exec>/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      const textBefore = text.slice(last, match.index).trim();
      if (textBefore) segments.push({ type: "text", content: textBefore });
    }
    if (match[1] !== undefined) {
      segments.push({ type: "write", path: match[1], content: match[2].trim() });
    } else if (match[3] !== undefined) {
      segments.push({ type: "delete", path: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ type: "exec", command: match[4].trim() });
    }
    last = match.index + match[0].length;
  }

  const tail = text.slice(last).trim();
  if (tail) segments.push({ type: "text", content: tail });

  return segments;
}

// ─── File Change Card ─────────────────────────────────────────────────────────

interface FileChangeCardProps {
  segment: Segment & { type: "write" | "delete" };
  projectId: string;
  onApplied: (path: string) => void;
}

function FileChangeCard({ segment, projectId, onApplied }: FileChangeCardProps) {
  const [status, setStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const queryClient = useQueryClient();

  const writeMutation = useWriteFile();
  const deleteMutation = useDeleteFile();

  const isWrite = segment.type === "write";
  const fileName = segment.path.split("/").pop() ?? segment.path;

  const handleApply = async () => {
    setStatus("applying");
    try {
      if (isWrite && segment.type === "write") {
        await writeMutation.mutateAsync({
          projectId,
          data: { path: segment.path, content: segment.content },
        });
      } else {
        await deleteMutation.mutateAsync({
          projectId,
          params: { path: segment.path },
        });
      }
      // Invalidate project tree and all file content so UI refreshes
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files`] });
      setStatus("done");
      onApplied(segment.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao aplicar";
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border text-xs overflow-hidden my-1",
        isWrite ? "border-blue-500/30 bg-blue-500/5" : "border-red-500/30 bg-red-500/5"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b",
          isWrite ? "border-blue-500/20 bg-blue-500/10" : "border-red-500/20 bg-red-500/10"
        )}
      >
        {isWrite ? (
          segment.path.includes(".") ? (
            <FilePen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <FilePlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )
        ) : (
          <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
        )}
        <span className="font-mono font-medium truncate flex-1" title={segment.path}>
          {segment.path}
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full shrink-0",
            isWrite ? "bg-blue-500/20 text-blue-300" : "bg-red-500/20 text-red-300"
          )}
        >
          {isWrite ? "editar" : "deletar"}
        </span>
      </div>

      {/* Preview (write only) */}
      {isWrite && segment.type === "write" && (
        <pre className="p-3 text-[10px] font-mono text-foreground/70 overflow-auto max-h-32 leading-relaxed whitespace-pre-wrap">
          {segment.content.slice(0, 400)}
          {segment.content.length > 400 && "\n… (truncado na prévia)"}
        </pre>
      )}

      {/* Footer */}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        {status === "error" && (
          <span className="flex items-center gap-1 text-red-400 text-[10px]">
            <AlertCircle className="w-3 h-3" /> {errorMsg}
          </span>
        )}
        {status === "done" && (
          <span className="flex items-center gap-1 text-green-400 text-[10px]">
            <Check className="w-3 h-3" /> Aplicado
          </span>
        )}
        {status === "applying" && (
          <span className="flex items-center gap-1 text-muted-foreground text-[10px] ml-auto">
            <Loader2 className="w-3 h-3 animate-spin" /> Aplicando...
          </span>
        )}
        {(status === "idle" || status === "error") && (
          <Button
            size="sm"
            variant={isWrite ? "default" : "destructive"}
            className="h-6 text-[10px] px-2 ml-auto"
            onClick={handleApply}
            disabled={writeMutation.isPending || deleteMutation.isPending}
          >
            {isWrite ? "Aplicar" : "Deletar"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Exec Command Card ────────────────────────────────────────────────────────

function ExecCommandCard({
  command,
  onRun,
}: {
  command: string;
  onRun?: (cmd: string) => void;
}) {
  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 overflow-hidden my-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-green-500/20 bg-green-500/10">
        <Terminal className="w-3.5 h-3.5 text-green-400 shrink-0" />
        <span className="font-mono text-[11px] text-green-300 truncate flex-1">{command}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 shrink-0">
          terminal
        </span>
      </div>
      <div className="px-3 py-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] px-2 text-green-400 hover:text-green-300 hover:bg-green-500/10"
          onClick={() => onRun?.(command)}
        >
          <Play className="w-3 h-3 mr-1" />
          Executar no terminal
        </Button>
      </div>
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-white/10 transition-colors",
        copied ? "text-green-400" : "text-muted-foreground hover:text-foreground",
        className
      )}
      title={copied ? "Copiado!" : "Copiar"}
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Markdown component overrides ─────────────────────────────────────────────

const mdComponents: Components = {
  img: ({ src, alt, node: _, ...rest }) => (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block my-2">
      <img
        src={src}
        alt={alt ?? ""}
        className="max-w-full rounded-md border border-border"
        loading="lazy"
        {...rest}
      />
    </a>
  ),
  pre: ({ children, node: _, ...rest }) => {
    const extractText = (node: React.ReactNode): string => {
      if (typeof node === "string") return node;
      if (Array.isArray(node)) return node.map(extractText).join("");
      if (React.isValidElement(node) && node.props) {
        return extractText((node.props as { children?: React.ReactNode }).children ?? "");
      }
      return "";
    };
    const codeText = extractText(children);
    return (
      <div className="relative group my-2">
        <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <CopyButton text={codeText} />
        </div>
        <pre className="rounded-md overflow-x-auto text-[11px] !bg-[#0d1117] p-3" {...rest}>
          {children}
        </pre>
      </div>
    );
  },
  code: ({ className, children, node: _, ...rest }) => {
    const hasLang = typeof className === "string" && className.startsWith("language-");
    if (!hasLang) {
      return (
        <code className="bg-primary/15 text-primary px-1 py-0.5 rounded text-[11px] font-mono" {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  table: ({ children, node: _, ...rest }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse text-[11px]" {...rest}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, node: _, ...rest }) => (
    <th className="border border-border px-2 py-1 bg-muted font-semibold text-left" {...rest}>
      {children}
    </th>
  ),
  td: ({ children, node: _, ...rest }) => (
    <td className="border border-border px-2 py-1" {...rest}>
      {children}
    </td>
  ),
  a: ({ href, children, node: _, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
      {...rest}
    >
      {children}
    </a>
  ),
};

// ─── Message Renderer ─────────────────────────────────────────────────────────

function AssistantMessage({
  content,
  projectId,
  onRunCommand,
}: {
  content: string;
  projectId: string;
  onRunCommand?: (cmd: string) => void;
}) {
  const segments = parseAiMessage(content);
  const plainText = segments.filter((s) => s.type === "text").map((s) => s.content).join("\n");

  return (
    <div className="flex gap-2 justify-start group/msg">
      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="max-w-[90%] flex flex-col gap-1 relative">
        <div className="absolute -right-1 -top-1 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10">
          <CopyButton text={plainText} />
        </div>
        {segments.map((seg, i) => {
          if (seg.type === "text") {
            return (
              <div
                key={i}
                className="bg-muted rounded-lg rounded-bl-sm px-3 py-2 text-xs leading-relaxed break-words text-foreground ai-markdown"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {seg.content}
                </ReactMarkdown>
              </div>
            );
          }
          if (seg.type === "write" || seg.type === "delete") {
            return (
              <FileChangeCard
                key={i}
                segment={seg}
                projectId={projectId}
                onApplied={() => {}}
              />
            );
          }
          if (seg.type === "exec") {
            return (
              <ExecCommandCard
                key={i}
                command={seg.command}
                onRun={onRunCommand}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// ─── Context selector config ──────────────────────────────────────────────────

const CONTEXT_LABELS: Record<ContextMode, string> = {
  none: "Sem contexto",
  file: "Arquivo aberto",
  project: "Projeto completo",
};

const CONTEXT_ICONS: Record<ContextMode, React.ReactNode> = {
  none: <Minus className="w-3 h-3" />,
  file: <File className="w-3 h-3" />,
  project: <FolderOpen className="w-3 h-3" />,
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

// Read active AI profile name from localStorage
function useActiveModel(): string {
  const [model, setModel] = useState<string>(() => {
    try {
      const profiles = JSON.parse(localStorage.getItem("codelens_ai_profiles") ?? "[]");
      const slot = parseInt(localStorage.getItem("codelens_ai_active_slot") ?? "0", 10);
      return profiles[slot]?.model ?? "";
    } catch { return ""; }
  });
  useEffect(() => {
    const update = () => {
      try {
        const profiles = JSON.parse(localStorage.getItem("codelens_ai_profiles") ?? "[]");
        const slot = parseInt(localStorage.getItem("codelens_ai_active_slot") ?? "0", 10);
        setModel(profiles[slot]?.model ?? "");
      } catch { setModel(""); }
    };
    window.addEventListener("storage", update);
    window.addEventListener("codelens-settings-saved", update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener("codelens-settings-saved", update); };
  }, []);
  return model;
}

const CONTEXT_STORAGE_KEY = "codelens_ai_context_mode";

export function AiPanel({ projectId, fileContext, externalMessage, onRunCommand, terminalLog }: AiPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>(() => {
    const saved = localStorage.getItem(CONTEXT_STORAGE_KEY) as ContextMode | null;
    return saved ?? "project";
  });
  const [lastExternalId, setLastExternalId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeModel = useActiveModel();

  const { listening, toggle: toggleVoice } = useVoice((text) => {
    setInput((prev) => (prev ? prev + " " + text : text));
    setTimeout(() => textareaRef.current?.focus(), 50);
  });

  const buildTerminalContext = (): string | null => {
    if (!terminalLog || terminalLog.length === 0) return null;
    const last5 = terminalLog.slice(-5);
    const hasContent = last5.some(e => e.stdout || e.stderr);
    if (!hasContent) return null;
    return last5.map(e => {
      const lines: string[] = [`$ ${e.command}`];
      if (e.stdout) lines.push(e.stdout.trim());
      if (e.stderr) lines.push(`[stderr] ${e.stderr.trim()}`);
      lines.push(`[exit: ${e.exitCode}]`);
      return lines.join("\n");
    }).join("\n\n---\n\n");
  };

  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [voiceChatMessages, setVoiceChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [voiceChatInput, setVoiceChatInput] = useState("");
  const [voiceChatListening, setVoiceChatListening] = useState(false);
  const [voiceChatProcessing, setVoiceChatProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceChatRecRef = useRef<any>(null);
  const voiceChatScrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const stopAudio = useCallback(() => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const autoRestartMicRef = useRef(false);

  const onTtsFinished = useCallback(() => {
    setIsSpeaking(false);
    if (autoRestartMicRef.current) {
      setTimeout(() => {
        autoRestartMicRef.current = false;
        voiceChatToggleMicRef.current?.();
      }, 400);
    }
  }, []);

  const playBrowserTts = useCallback((text: string) => {
    if (!window.speechSynthesis) { setIsSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1.15;
    utterance.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const googlePt = voices.find(v => v.name.includes("Google") && v.lang.startsWith("pt"));
    const anyPt = voices.find(v => v.lang.startsWith("pt-BR") || v.lang.startsWith("pt_BR"));
    if (googlePt) utterance.voice = googlePt;
    else if (anyPt) utterance.voice = anyPt;
    utterance.onend = () => onTtsFinished();
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [onTtsFinished]);

  const playTts = useCallback(async (text: string) => {
    stopAudio();

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setIsSpeaking(true);

    try {
      const resp = await fetch("/api/ai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!resp.ok) {
        playBrowserTts(text);
        return;
      }

      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("audio")) {
        playBrowserTts(text);
        return;
      }

      const blob = await resp.blob();
      if (controller.signal.aborted) return;

      if (!blob || blob.size < 100) {
        playBrowserTts(text);
        return;
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      let audioEnded = false;

      audio.onended = () => {
        if (audioEnded) return;
        audioEnded = true;
        audioRef.current = null;
        URL.revokeObjectURL(url);
        onTtsFinished();
      };
      audio.onerror = () => {
        if (audioEnded) return;
        audioEnded = true;
        audioRef.current = null;
        URL.revokeObjectURL(url);
        playBrowserTts(text);
      };

      await audio.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setIsSpeaking(false);
      playBrowserTts(text);
    }
  }, [stopAudio, playBrowserTts, onTtsFinished]);

  const voiceChatMutation = useAiChat({ mutation: {} });
  const voiceSendingRef = useRef(false);

  const voiceChatSend = useCallback(async (userText: string) => {
    if (!userText.trim() || voiceChatProcessing || voiceSendingRef.current) return;
    voiceSendingRef.current = true;
    const newMsgs = [...voiceChatMessages, { role: "user" as const, text: userText.trim() }];
    setVoiceChatMessages(newMsgs);
    setVoiceChatProcessing(true);
    try {
      const voiceSystemMsg = {
        role: "user" as const,
        content: `[MODO VOZ ATIVO] O usuario esta falando por voz. Responda de forma CONVERSACIONAL e CLARA — como se estivesse explicando para alguem que nao e programador. Use frases curtas e diretas. Voce pode sugerir ideias, melhorias e alternativas livremente. Quando precisar mostrar codigo, use os blocos de acao (codelens-write/delete/exec) normalmente — eles serao exibidos como botoes. Na parte falada, explique O QUE vai fazer e POR QUE, sem citar syntax. Se o usuario pedir para corrigir algo, corrija E explique o que mudou em linguagem simples.`,
      };
      const history = [voiceSystemMsg, ...newMsgs.map(m => ({ role: m.role, content: m.text }))];
      const tc = buildTerminalContext();
      const result = await voiceChatMutation.mutateAsync({
        data: {
          messages: history,
          projectContext: true,
          projectId,
          terminalContext: tc ?? undefined,
        },
      });
      const reply = result.reply || "Sem resposta.";
      setVoiceChatMessages(prev => [...prev, { role: "assistant", text: reply }]);
      const cleanReply = reply
        .replace(/<codelens-write[\s\S]*?<\/codelens-write>/g, " arquivo atualizado ")
        .replace(/<codelens-delete[^/]*\/>/g, " arquivo removido ")
        .replace(/<codelens-exec>[\s\S]*?<\/codelens-exec>/g, " comando sugerido ")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[#*_`~>\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleanReply) {
        autoRestartMicRef.current = true;
        playTts(cleanReply);
      }
    } catch {
      setVoiceChatMessages(prev => [...prev, { role: "assistant", text: "Erro de conexão. Tente novamente." }]);
    } finally {
      setVoiceChatProcessing(false);
      voiceSendingRef.current = false;
    }
  }, [voiceChatMessages, voiceChatProcessing, projectId, playTts, voiceChatMutation]);

  const voiceChatToggleMicRef = useRef<(() => void) | null>(null);

  const voiceChatToggleMic = useCallback(() => {
    if (voiceChatListening) {
      voiceChatRecRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const startMic = () => {
      const rec = new SR();
      rec.lang = "pt-BR";
      rec.continuous = false;
      rec.interimResults = false;
      let alreadySent = false;
      rec.onresult = (e: any) => {
        if (alreadySent) return;
        const transcript = e.results[0]?.[0]?.transcript?.trim();
        if (transcript) {
          alreadySent = true;
          rec.stop();
          setVoiceChatListening(false);
          voiceChatSend(transcript);
        }
      };
      rec.onerror = () => setVoiceChatListening(false);
      rec.onend = () => setVoiceChatListening(false);
      voiceChatRecRef.current = rec;
      try {
        rec.start();
        setVoiceChatListening(true);
      } catch {
        setVoiceChatListening(false);
      }
    };
    if (isSpeaking) {
      stopAudio();
      setTimeout(startMic, 600);
    } else {
      startMic();
    }
  }, [voiceChatListening, voiceChatSend, isSpeaking, stopAudio]);

  useEffect(() => {
    voiceChatToggleMicRef.current = voiceChatToggleMic;
  }, [voiceChatToggleMic]);

  useEffect(() => {
    if (voiceChatScrollRef.current) {
      voiceChatScrollRef.current.scrollTop = voiceChatScrollRef.current.scrollHeight;
    }
  }, [voiceChatMessages, voiceChatProcessing]);

  const chatMutation = useAiChat({
    mutation: {
      onSuccess: (data) => {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      },
      onError: (error) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Erro: ${error.message || "Falha ao conectar com a IA. Verifique as Configurações."}`,
          },
        ]);
      },
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  useEffect(() => {
    if (externalMessage && externalMessage.id !== lastExternalId) {
      setLastExternalId(externalMessage.id);
      const mode = externalMessage.contextMode ?? contextMode;
      sendMessage(externalMessage.text, mode);
    }
  }, [externalMessage]);

  // Persist context mode choice
  const changeContextMode = (mode: ContextMode) => {
    setContextMode(mode);
    localStorage.setItem(CONTEXT_STORAGE_KEY, mode);
  };

  useEffect(() => {
    if (contextMode === "file" && !fileContext) changeContextMode("project");
  }, [fileContext, contextMode]);


  const sendMessage = (text: string, mode: ContextMode = contextMode) => {
    if (!text.trim() || chatMutation.isPending) return;
    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    const tc = buildTerminalContext();
    chatMutation.mutate({
      data: {
        messages: updated.map((m) => ({ role: m.role, content: m.content })),
        fileContext: mode === "file" && fileContext ? fileContext.content.slice(0, 12000) : null,
        filePath: mode === "file" && fileContext ? fileContext.path : null,
        projectId: mode === "project" ? projectId : null,
        projectContext: mode === "project" ? true : null,
        terminalContext: tc ?? null,
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text, contextMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const availableModes: ContextMode[] = ["none", ...(fileContext ? (["file"] as ContextMode[]) : []), "project"];
  const isEmpty = messages.length === 0 && !chatMutation.isPending;
  const hasTerminalContext = (terminalLog?.length ?? 0) > 0 && terminalLog!.some(e => e.stdout || e.stderr);

  return (
    <div className="h-full w-full flex flex-col bg-card border-l border-border overflow-hidden">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-border bg-background/50 flex items-center px-3 gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Chat IA</span>
        {activeModel && (
          <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 truncate max-w-[120px]" title={activeModel}>
            {activeModel}
          </span>
        )}
        <span className="flex-1" />
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setMessages([])}
            title="Limpar conversa"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted-foreground overflow-auto">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Chat com sua IA</p>
            <p className="text-xs leading-relaxed max-w-[240px] mb-3">
              Use áudio ou texto. Botões de copiar em todas as respostas.
            </p>

            <button
              type="button"
              onClick={() => {
                changeContextMode("project");
                sendMessage(
                  "Analise a ESTRUTURA COMPLETA deste projeto. Primeiro: identifique o ponto de entrada, o fluxo de execução e a interconexão entre módulos. Segundo: detecte quebras, falhas ou vulnerabilidades na arquitetura. Terceiro: liste bugs estruturais explicando como afetam o funcionamento. Quarto: proponha correções com blocos <codelens-write> prontos para aplicar. Seja direto e objetivo.",
                  "project"
                );
              }}
              className="w-full max-w-[280px] mb-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-primary bg-primary/10 hover:bg-primary/20 transition-colors text-primary font-semibold text-sm"
            >
              <Layers className="w-5 h-5" />
              Analisar Estrutura do Projeto
            </button>

            <div className="grid grid-cols-2 gap-1.5 w-full max-w-[280px]">
              {[
                { icon: <Lightbulb className="w-3.5 h-3.5" />, label: "Sugestões", color: "text-yellow-400", prompt: "Analise o código e dê sugestões de melhorias, boas práticas e otimizações." },
                { icon: <Bug className="w-3.5 h-3.5" />, label: "Bugs", color: "text-red-400", prompt: "Procure bugs, erros potenciais e problemas no código. Liste cada um com explicação e solução." },
                { icon: <BookOpen className="w-3.5 h-3.5" />, label: "Explicação", color: "text-blue-400", prompt: "Explique o que este código faz de forma clara e detalhada, em português." },
                { icon: <Search className="w-3.5 h-3.5" />, label: "Análise", color: "text-green-400", prompt: "Faça uma análise completa do código: estrutura, qualidade, performance e segurança." },
                { icon: <Shield className="w-3.5 h-3.5" />, label: "Segurança", color: "text-orange-400", prompt: "Analise o código em busca de vulnerabilidades de segurança e sugira correções." },
                { icon: <GitBranch className="w-3.5 h-3.5" />, label: "Refatorar", color: "text-purple-400", prompt: "Sugira refatorações para melhorar a legibilidade, manutenção e organização do código." },
              ].map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    changeContextMode(fileContext ? "file" : "project");
                    sendMessage(action.prompt, fileContext ? "file" : "project");
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background/50 hover:bg-accent hover:border-primary/30 transition-colors text-left"
                >
                  <span className={action.color}>{action.icon}</span>
                  <span className="text-xs font-medium text-foreground">{action.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-1 w-full max-w-[240px] text-[10px] text-left text-muted-foreground">
              <div className="flex items-center gap-1.5"><FilePlus className="w-3 h-3 shrink-0 text-blue-400" /> Criar novos arquivos</div>
              <div className="flex items-center gap-1.5"><FilePen className="w-3 h-3 shrink-0 text-blue-400" /> Editar arquivos existentes</div>
              <div className="flex items-center gap-1.5"><Trash2 className="w-3 h-3 shrink-0 text-red-400" /> Deletar arquivos</div>
              <div className="flex items-center gap-1.5"><Copy className="w-3 h-3 shrink-0 text-green-400" /> Copiar código e respostas</div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex gap-2 justify-end">
                  <div className="max-w-[85%] bg-primary text-primary-foreground rounded-lg rounded-br-sm px-3 py-2 text-xs leading-relaxed break-words">
                    {msg.content}
                  </div>
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-secondary-foreground" />
                  </div>
                </div>
              ) : (
                <AssistantMessage key={i} content={msg.content} projectId={projectId} onRunCommand={onRunCommand} />
              )
            )}
            {chatMutation.isPending && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-muted rounded-lg rounded-bl-sm px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Context + Input */}
      <div className="shrink-0 border-t border-border bg-background/30 p-2 flex flex-col gap-1.5">
        {/* Terminal context indicator */}
        {hasTerminalContext && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-[10px] text-green-400">
            <Terminal className="w-3 h-3 shrink-0" />
            <span>Terminal incluído automaticamente no contexto</span>
            <span className="ml-auto text-green-400/60">{terminalLog!.length} cmd{terminalLog!.length !== 1 ? "s" : ""}</span>
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors w-full",
                contextMode === "none"
                  ? "bg-muted/50 border-border text-muted-foreground hover:border-primary/30"
                  : contextMode === "file"
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                  : "bg-primary/10 border-primary/30 text-primary"
              )}
            >
              {CONTEXT_ICONS[contextMode]}
              <span className="flex-1 text-left truncate">
                Contexto: {CONTEXT_LABELS[contextMode]}
                {contextMode === "file" && fileContext && ` — ${fileContext.path.split("/").pop()}`}
              </span>
              <ChevronDown className="w-3 h-3 ml-auto shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {availableModes.map((mode) => (
              <DropdownMenuItem
                key={mode}
                onClick={() => changeContextMode(mode)}
                className={cn("gap-2 text-xs", contextMode === mode && "bg-accent")}
              >
                {CONTEXT_ICONS[mode]}
                <div className="flex flex-col">
                  <span className="font-medium">{CONTEXT_LABELS[mode]}</span>
                  <span className="text-muted-foreground text-[10px]">
                    {mode === "none" && "Conversa livre, sem código"}
                    {mode === "file" && "Arquivo atual enviado como contexto"}
                    {mode === "project" && "Todos os arquivos do projeto enviados"}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <form onSubmit={handleSubmit} className="flex gap-1.5 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? "Ouvindo… fale agora" : 'Ex: "Adiciona tratamento de erro no fetch" (Enter envia)'}
            className="flex-1 min-h-[60px] max-h-[120px] text-xs resize-none bg-background border-border focus-visible:ring-1 focus-visible:ring-primary"
            disabled={chatMutation.isPending}
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "h-8 w-8",
                listening
                  ? "text-red-400 bg-red-400/10 hover:bg-red-400/20 animate-pulse"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={toggleVoice}
              title={listening ? "Parar gravação" : "Falar mensagem (pt-BR)"}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              onClick={() => setShowVoiceChat(true)}
              title="Chat por voz interativo"
            >
              <AudioLines className="w-4 h-4" />
            </Button>
            <Button
              type="submit"
              size="icon"
              className="h-8 w-8"
              disabled={!input.trim() || chatMutation.isPending}
            >
              {chatMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </form>
      </div>

      <Dialog open={showVoiceChat} onOpenChange={(v) => { setShowVoiceChat(v); if (!v) { stopAudio(); voiceChatRecRef.current?.stop(); setVoiceChatListening(false); } }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AudioLines className="w-5 h-5 text-blue-500" />
              Conversa por Voz
            </DialogTitle>
            <DialogDescription>Fale com a IA — ela ouve, entende e responde falando. Acesso total ao projeto.</DialogDescription>
          </DialogHeader>
          <div ref={voiceChatScrollRef} className="flex-1 overflow-y-auto space-y-3 min-h-[200px] max-h-[400px] p-2">
            {voiceChatMessages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                Clique no microfone e comece a falar.<br/>Ou digite abaixo. A IA vai ouvir e responder por voz.
              </div>
            )}
            {voiceChatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} group/vcmsg`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm relative ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "assistant" ? (() => {
                    const segments = parseAiMessage(m.text);
                    const hasActions = segments.some(s => s.type !== "text");
                    if (!hasActions) return <span className="whitespace-pre-wrap">{m.text}</span>;
                    return (
                      <div className="space-y-2">
                        {segments.map((seg, si) => {
                          if (seg.type === "text") return <span key={si} className="whitespace-pre-wrap">{seg.content}</span>;
                          if (seg.type === "write" || seg.type === "delete") return (
                            <FileChangeCard key={si} segment={seg} projectId={projectId} onApplied={() => {}} />
                          );
                          if (seg.type === "exec") return (
                            <ExecCommandCard key={si} command={seg.command} onRun={onRunCommand} />
                          );
                          return null;
                        })}
                      </div>
                    );
                  })() : <span className="whitespace-pre-wrap">{m.text}</span>}
                  <div className="absolute -right-1 -top-1 opacity-0 group-hover/vcmsg:opacity-100 transition-opacity">
                    <CopyButton text={m.text} />
                  </div>
                </div>
              </div>
            ))}
            {voiceChatProcessing && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Pensando...
                </div>
              </div>
            )}
          </div>
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Ou digite aqui..."
                value={voiceChatInput}
                onChange={(e) => setVoiceChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && voiceChatInput.trim() && !voiceChatProcessing) {
                    voiceChatSend(voiceChatInput.trim());
                    setVoiceChatInput("");
                  }
                }}
                disabled={voiceChatProcessing}
              />
              <Button
                size="icon"
                className="h-10 w-10"
                onClick={() => { if (voiceChatInput.trim()) { voiceChatSend(voiceChatInput.trim()); setVoiceChatInput(""); } }}
                disabled={voiceChatProcessing || !voiceChatInput.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={voiceChatListening ? "destructive" : "default"}
                className={`flex-1 gap-2 h-12 text-base ${voiceChatListening ? "animate-pulse" : ""}`}
                onClick={voiceChatToggleMic}
                disabled={voiceChatProcessing}
              >
                {voiceChatListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                {voiceChatListening ? "Ouvindo..." : voiceChatProcessing ? "Aguarde..." : "Falar"}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12"
                onClick={() => stopAudio()}
                title="Parar áudio"
              >
                <VolumeX className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-12 w-12"
                onClick={() => setVoiceChatMessages([])}
                title="Limpar conversa"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
