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
  Trash2,
  Mic,
  MicOff,
  VolumeX,
  AudioLines,
  Copy,
  CheckCheck,
  RefreshCw,
} from "lucide-react";
import { useAiChat } from "@/lib-api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppLayout } from "@/components/layout";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ─── Voice hook ──────────────────────────────────────────────────────────────

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

// ─── TTS hook ─────────────────────────────────────────────────────────────────

function useTts() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const playBrowser = useCallback((text: string) => {
    if (!window.speechSynthesis) { setSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "pt-BR";
    utt.rate = 1.1;
    const voices = window.speechSynthesis.getVoices();
    const best = voices.find(v => v.name.includes("Google") && v.lang.startsWith("pt"))
      ?? voices.find(v => v.lang.startsWith("pt-BR"));
    if (best) utt.voice = best;
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utt);
  }, []);

  const speak = useCallback(async (text: string) => {
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    setSpeaking(true);
    try {
      const resp = await fetch("/api/ai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!resp.ok || !resp.headers.get("content-type")?.includes("audio")) {
        playBrowser(text);
        return;
      }
      const blob = await resp.blob();
      if (controller.signal.aborted || blob.size < 100) { playBrowser(text); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { audioRef.current = null; URL.revokeObjectURL(url); setSpeaking(false); };
      audio.onerror = () => { audioRef.current = null; setSpeaking(false); playBrowser(text); };
      await audio.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setSpeaking(false);
      playBrowser(text);
    }
  }, [stop, playBrowser]);

  return { speaking, speak, stop };
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={cn("p-1 rounded hover:bg-white/10 transition-colors", copied ? "text-green-400" : "text-muted-foreground hover:text-foreground")}
      title={copied ? "Copiado!" : "Copiar"}
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Markdown components ──────────────────────────────────────────────────────

const mdComponents: Components = {
  pre: ({ children, node: _, ...rest }) => {
    const extractText = (node: React.ReactNode): string => {
      if (typeof node === "string") return node;
      if (Array.isArray(node)) return node.map(extractText).join("");
      if (React.isValidElement(node) && node.props) return extractText((node.props as any).children ?? "");
      return "";
    };
    return (
      <div className="relative group my-2">
        <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <CopyButton text={extractText(children)} />
        </div>
        <pre className="rounded-md overflow-x-auto text-[11px] !bg-[#0d1117] p-3" {...rest}>{children}</pre>
      </div>
    );
  },
  code: ({ className, children, node: _, ...rest }) => {
    const hasLang = typeof className === "string" && className.startsWith("language-");
    if (!hasLang) return <code className="bg-primary/15 text-primary px-1 py-0.5 rounded text-[11px] font-mono" {...rest}>{children}</code>;
    return <code className={className} {...rest}>{children}</code>;
  },
  a: ({ href, children, node: _, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" {...rest}>{children}</a>
  ),
  table: ({ children, node: _, ...rest }) => (
    <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse text-[11px]" {...rest}>{children}</table></div>
  ),
  th: ({ children, node: _, ...rest }) => <th className="border border-border px-2 py-1 bg-muted font-semibold text-left" {...rest}>{children}</th>,
  td: ({ children, node: _, ...rest }) => <td className="border border-border px-2 py-1" {...rest}>{children}</td>,
};

// ─── Active model helper ──────────────────────────────────────────────────────

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

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Explique o que é uma API REST com exemplos simples",
  "Quais são as diferenças entre JavaScript e TypeScript?",
  "Como funciona um banco de dados relacional?",
  "O que é o padrão MVC e quando usar?",
  "Me ajude a escrever um e-mail profissional",
  "Crie um plano de estudos para aprender programação do zero",
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeModel = useActiveModel();

  const tts = useTts();
  const { listening, toggle: toggleVoice } = useVoice((text) => {
    setInput(prev => prev ? prev + " " + text : text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  });

  const chatMutation = useAiChat({
    mutation: {
      onSuccess: (data) => {
        const reply = data.reply;
        setMessages(prev => [...prev, { role: "assistant", content: reply }]);
        if (ttsEnabled) {
          const clean = reply
            .replace(/```[\s\S]*?```/g, "")
            .replace(/[#*_`~>\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 600);
          if (clean) tts.speak(clean);
        }
      },
      onError: (error) => {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Erro: ${error.message || "Falha ao conectar com a IA. Verifique as Configurações."}`,
        }]);
      },
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || chatMutation.isPending) return;
    tts.stop();
    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    chatMutation.mutate({
      data: {
        messages: updated.map(m => ({ role: m.role, content: m.content })),
        fileContext: null,
        filePath: null,
        projectId: null,
        projectContext: null,
        terminalContext: null,
      },
    });
  }, [messages, chatMutation, tts]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const clearChat = () => {
    tts.stop();
    setMessages([]);
  };

  const isEmpty = messages.length === 0 && !chatMutation.isPending;

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-12 shrink-0 border-b border-border bg-card flex items-center px-4 justify-between z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Chat Livre</span>
            {activeModel && (
              <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 truncate max-w-[140px]" title={activeModel}>
                {activeModel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { tts.stop(); setTtsEnabled(v => !v); }}
              className={cn("h-7 w-7 p-0", ttsEnabled ? "text-primary" : "text-muted-foreground")}
              title={ttsEnabled ? "Desativar voz" : "Ativar voz"}
            >
              {ttsEnabled ? <AudioLines className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </Button>
            {messages.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearChat} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 pb-16">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">Chat Livre com IA</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Pergunte qualquer coisa — código, conceitos, dúvidas, redações, ideias. Sem contexto de projeto.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left text-xs px-3 py-2.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-all text-muted-foreground hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div className={cn("max-w-[85%] group/msg relative", msg.role === "user" ? "items-end" : "items-start")}>
                    {msg.role === "assistant" && (
                      <div className="absolute -right-1 -top-1 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 flex gap-0.5">
                        <CopyButton text={msg.content} />
                        {ttsEnabled && (
                          <button
                            type="button"
                            onClick={() => tts.speak(msg.content.slice(0, 600))}
                            className="p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
                            title="Ouvir"
                          >
                            <AudioLines className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    <div
                      className={cn(
                        "px-3 py-2.5 rounded-xl text-xs leading-relaxed break-words",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm ai-markdown"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                          components={mdComponents}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      ) : (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      )}
                    </div>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="bg-muted rounded-xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              {tts.speaking && (
                <div className="flex justify-center">
                  <button
                    onClick={tts.stop}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted rounded-full px-3 py-1 hover:text-foreground transition-colors"
                  >
                    <AudioLines className="w-3 h-3 animate-pulse text-primary" />
                    Ouvindo... (clique para parar)
                  </button>
                </div>
              )}
              <div ref={endRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                className="resize-none text-sm min-h-[44px] max-h-32 pr-2 py-2.5"
                rows={1}
                disabled={chatMutation.isPending}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant={listening ? "default" : "outline"}
              className={cn("h-11 w-11 shrink-0", listening && "bg-red-500 hover:bg-red-600 border-red-500")}
              onClick={toggleVoice}
              title={listening ? "Parar gravação" : "Gravar voz (pt-BR)"}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0"
              disabled={!input.trim() || chatMutation.isPending}
            >
              {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Enter para enviar · Shift+Enter para quebrar linha · Microfone para voz
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
