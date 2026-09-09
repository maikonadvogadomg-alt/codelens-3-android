import React, { useState, useEffect } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  useCreateGithubRepo,
  getGetSettingsQueryKey,
} from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Github,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Globe,
  ArrowRight,
  Key,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "setup-token" | "form" | "sending" | "success" | "error";

interface GithubDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultName?: string;
}

// ─── Token setup guide ───────────────────────────────────────────────────────

const TOKEN_STEPS = [
  {
    n: 1,
    text: (
      <>
        Abra{" "}
        <a
          href="https://github.com/settings/tokens/new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-0.5"
        >
          github.com/settings/tokens/new <ExternalLink className="w-3 h-3" />
        </a>{" "}
        (ou acesse GitHub → sua foto → Settings → Developer settings → Personal access tokens → Tokens classic)
      </>
    ),
  },
  {
    n: 2,
    text: 'No campo "Note" escreva qualquer nome, por exemplo: CodeLens',
  },
  {
    n: 3,
    text: 'Em "Select scopes", marque a caixa "repo" (isso dá permissão de criar e enviar repositórios)',
  },
  {
    n: 4,
    text: 'Clique em "Generate token" no final da página',
  },
  {
    n: 5,
    text: "Copie o token gerado (começa com ghp_...) e cole no campo abaixo:",
  },
];

// ─── Sending steps ───────────────────────────────────────────────────────────

const SENDING_STEPS = [
  "Conectando ao GitHub...",
  "Criando repositório...",
  "Enviando arquivos...",
  "Configurando branch principal...",
  "Concluído!",
];

// ─── Component ───────────────────────────────────────────────────────────────

export function GithubDeployModal({
  open,
  onOpenChange,
  projectId,
  defaultName = "meu-projeto",
}: GithubDeployModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [screen, setScreen] = useState<Screen>("form");

  // Token setup state
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);

  // Form state
  const [repoName, setRepoName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [nameError, setNameError] = useState("");

  // Sending animation
  const [sendingStep, setSendingStep] = useState(0);
  const [sendingInterval, setSendingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Success/error
  const [repoUrl, setRepoUrl] = useState("");
  const [repoFullName, setRepoFullName] = useState("");
  const [filesCount, setFilesCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [duplicateHint, setDuplicateHint] = useState(false);

  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });

  const updateSettings = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
    },
  });

  const deployMutation = useCreateGithubRepo({
    mutation: {
      onSuccess: (data) => {
        stopSendingAnimation();
        setSendingStep(SENDING_STEPS.length - 1);
        setTimeout(() => {
          setRepoUrl(data.repoUrl);
          setRepoFullName(data.repoName);
          setFilesCount(data.filesCommitted);
          setScreen("success");
        }, 600);
      },
      onError: (error) => {
        stopSendingAnimation();
        const msg = error.message || "Erro desconhecido";
        const isDuplicate =
          msg.toLowerCase().includes("already exist") ||
          msg.toLowerCase().includes("422") ||
          msg.toLowerCase().includes("name already");
        setDuplicateHint(isDuplicate);
        setErrorMsg(msg);
        setScreen("error");
      },
    },
  });

  // Init form when modal opens
  useEffect(() => {
    if (!open) return;
    const safeName = (defaultName || "meu-projeto")
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      || "meu-projeto";
    setRepoName(safeName);
    setDescription("Exportado do CodeLens");
    setIsPrivate(true);
    setNameError("");
    setTokenInput("");
    setShowToken(false);
    setSendingStep(0);
    setErrorMsg("");
    setDuplicateHint(false);

    // Decide starting screen
    if (settings?.githubTokenSet) {
      setScreen("form");
    } else {
      setScreen("setup-token");
    }
  }, [open, defaultName, settings?.githubTokenSet]);

  // Sending animation
  const startSendingAnimation = () => {
    setSendingStep(0);
    const id = setInterval(() => {
      setSendingStep((prev) => {
        if (prev >= SENDING_STEPS.length - 2) {
          clearInterval(id);
          return prev;
        }
        return prev + 1;
      });
    }, 900);
    setSendingInterval(id);
  };

  const stopSendingAnimation = () => {
    if (sendingInterval) {
      clearInterval(sendingInterval);
      setSendingInterval(null);
    }
  };

  useEffect(() => {
    return () => stopSendingAnimation();
  }, []);

  // Save token and proceed
  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    updateSettings.mutate(
      { data: { githubToken: tokenInput.trim() } },
      {
        onSuccess: () => {
          setSavingToken(false);
          setTokenInput("");
          setScreen("form");
        },
        onError: () => {
          setSavingToken(false);
          toast({ title: "Erro ao salvar token", variant: "destructive" });
        },
      }
    );
  };

  // Validate and start sending
  const handleSend = () => {
    const name = repoName.trim();
    if (!name) { setNameError("Digite um nome para o repositório"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      setNameError("Use apenas letras, números, hífen, ponto ou underline");
      return;
    }
    setNameError("");
    setScreen("sending");
    startSendingAnimation();

    deployMutation.mutate({
      data: {
        projectId,
        repoName: name,
        description: description.trim() || undefined,
        isPrivate,
      },
    });
  };

  // Try with a different name
  const handleTryDifferentName = () => {
    const suffix = Math.floor(Math.random() * 900) + 100;
    setRepoName((prev) => `${prev.replace(/-\d+$/, "")}-${suffix}`);
    setScreen("form");
  };

  const canClose = screen !== "sending";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (canClose) onOpenChange(v); }}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => { if (!canClose) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!canClose) e.preventDefault(); }}
      >
        {/* ── Screen: Token Setup ─────────────────────────────────────── */}
        {screen === "setup-token" && (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                Conectar ao GitHub
              </DialogTitle>
            </DialogHeader>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-foreground">
              Para enviar projetos ao GitHub, você precisa de um <strong>token de acesso</strong>.
              É como uma senha especial que permite ao CodeLens publicar em seu nome.
              Siga os passos abaixo (leva menos de 2 minutos):
            </div>

            <ol className="space-y-3">
              {TOKEN_STEPS.map((step) => (
                <li key={step.n} className="flex gap-3 text-sm">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold mt-0.5">
                    {step.n}
                  </span>
                  <span className="text-foreground/90 leading-relaxed">{step.text}</span>
                </li>
              ))}
            </ol>

            <div className="space-y-2">
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="bg-background pr-10 font-mono text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveToken()}
                  disabled={savingToken}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                O token é salvo de forma segura e nunca é exibido depois.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleSaveToken}
                disabled={!tokenInput.trim() || savingToken}
              >
                {savingToken ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                Salvar e continuar
              </Button>
            </div>

            {settings?.githubTokenSet && (
              <button
                className="w-full text-xs text-muted-foreground hover:text-primary underline text-center"
                onClick={() => setScreen("form")}
              >
                Já tenho token configurado — continuar
              </button>
            )}
          </div>
        )}

        {/* ── Screen: Form ────────────────────────────────────────────── */}
        {screen === "form" && (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                Enviar para o GitHub
              </DialogTitle>
            </DialogHeader>

            {settings?.githubTokenSet && (
              <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Conta GitHub conectada
                <button
                  className="ml-auto text-muted-foreground hover:text-foreground underline"
                  onClick={() => setScreen("setup-token")}
                >
                  trocar token
                </button>
              </div>
            )}

            <div className="space-y-4">
              {/* Repo name */}
              <div className="space-y-1.5">
                <Label className="text-sm">Nome do repositório</Label>
                <Input
                  value={repoName}
                  onChange={(e) => {
                    setRepoName(e.target.value);
                    setNameError("");
                  }}
                  placeholder="meu-projeto"
                  className={cn("bg-background font-mono", nameError && "border-destructive")}
                  autoFocus
                />
                {nameError ? (
                  <p className="text-xs text-destructive">{nameError}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Será criado em: <code className="text-primary">github.com/seu-usuario/{repoName || "…"}</code>
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Descrição{" "}
                  <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Uma breve descrição do projeto"
                  className="bg-background"
                />
              </div>

              {/* Visibility */}
              <div className="flex items-center justify-between rounded-lg border border-border p-3.5 bg-card/50">
                <div className="flex items-center gap-2.5">
                  {isPrivate ? (
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Globe className="w-4 h-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {isPrivate ? "Repositório privado" : "Repositório público"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isPrivate
                        ? "Só você tem acesso"
                        : "Qualquer pessoa pode ver o código"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={!isPrivate}
                  onCheckedChange={(v) => setIsPrivate(!v)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-2" onClick={handleSend}>
                <Github className="w-4 h-4" />
                Enviar para o GitHub
              </Button>
            </div>
          </div>
        )}

        {/* ── Screen: Sending ─────────────────────────────────────────── */}
        {screen === "sending" && (
          <div className="py-4 space-y-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                Enviando para o GitHub...
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              {SENDING_STEPS.map((label, i) => {
                const done = i < sendingStep;
                const active = i === sendingStep;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                      done && "opacity-50",
                      active && "bg-primary/10 border border-primary/20"
                    )}
                  >
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : active ? (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-sm",
                        active ? "text-foreground font-medium" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Aguarde enquanto seus arquivos são enviados...
            </p>
          </div>
        )}

        {/* ── Screen: Success ──────────────────────────────────────────── */}
        {screen === "success" && (
          <div className="py-2 space-y-5 text-center">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9 text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Enviado com sucesso!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {filesCount} {filesCount === 1 ? "arquivo enviado" : "arquivos enviados"} para o GitHub
                </p>
              </div>
            </div>

            {/* Repo link */}
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-accent/30 transition-all group"
            >
              <Github className="w-8 h-8 text-muted-foreground group-hover:text-foreground shrink-0" />
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{repoFullName}</p>
                <p className="text-xs text-primary truncate">{repoUrl}</p>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
            </a>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={() => window.open(repoUrl, "_blank")}
              >
                <ExternalLink className="w-4 h-4" />
                Abrir no GitHub
              </Button>
            </div>
          </div>
        )}

        {/* ── Screen: Error ────────────────────────────────────────────── */}
        {screen === "error" && (
          <div className="py-2 space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                Falha ao enviar
              </DialogTitle>
            </DialogHeader>

            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-foreground">
              {duplicateHint ? (
                <>
                  <strong>Repositório já existe.</strong> Já existe um repositório com o nome{" "}
                  <code className="text-primary font-bold">{repoName}</code> na sua conta. Use um
                  nome diferente.
                </>
              ) : (
                <>
                  <strong>Erro:</strong> {errorMsg}
                  {errorMsg.toLowerCase().includes("token") ||
                    errorMsg.toLowerCase().includes("401") ||
                    errorMsg.toLowerCase().includes("credential") ? (
                    <p className="mt-2 text-muted-foreground">
                      Verifique se o token GitHub está correto e tem a permissão <code>repo</code>.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {duplicateHint && (
                <Button className="gap-2" onClick={handleTryDifferentName}>
                  <RefreshCw className="w-4 h-4" />
                  Tentar com outro nome
                </Button>
              )}
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setScreen("form")}
              >
                Voltar e editar
              </Button>
              {(errorMsg.toLowerCase().includes("token") ||
                errorMsg.toLowerCase().includes("401") ||
                errorMsg.toLowerCase().includes("credential")) && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setScreen("setup-token")}
                >
                  <Key className="w-4 h-4" />
                  Atualizar token GitHub
                </Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
