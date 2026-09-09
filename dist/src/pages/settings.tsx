import React, { useState, useEffect } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Settings2,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Eye,
  EyeOff,
  Github,
  Zap,
  Star,
  FlaskConical,
  Cpu,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Provider detection ──────────────────────────────────────────────────────

interface Provider {
  name: string;
  color: string;
  baseUrl: string;
  model: string;
  hint: string;
}

const PROVIDERS: { match: (key: string) => boolean; provider: Provider }[] = [
  {
    match: (k) => k.startsWith("sk-ant-"),
    provider: {
      name: "Anthropic",
      color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      hint: "Claude 3.5 Haiku",
    },
  },
  {
    match: (k) => k.startsWith("AIzaSy"),
    provider: {
      name: "Google Gemini",
      color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-2.0-flash",
      hint: "Gemini 2.0 Flash",
    },
  },
  {
    match: (k) => k.startsWith("gsk_"),
    provider: {
      name: "Groq",
      color: "text-purple-400 bg-purple-400/10 border-purple-400/30",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      hint: "Llama 3.3 70B",
    },
  },
  {
    match: (k) => k.startsWith("xai-"),
    provider: {
      name: "xAI (Grok)",
      color: "text-gray-300 bg-gray-300/10 border-gray-300/30",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-2-latest",
      hint: "Grok 2",
    },
  },
  {
    match: (k) => k.startsWith("pplx-"),
    provider: {
      name: "Perplexity",
      color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
      baseUrl: "https://api.perplexity.ai",
      model: "sonar-pro",
      hint: "Sonar Pro (busca + IA)",
    },
  },
  {
    match: (k) => k.startsWith("sk-or-"),
    provider: {
      name: "OpenRouter",
      color: "text-green-400 bg-green-400/10 border-green-400/30",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-3.5-sonnet",
      hint: "Claude 3.5 via OpenRouter",
    },
  },
  {
    match: (k) => k.startsWith("sk-") && !k.startsWith("sk-ant-") && !k.startsWith("sk-or-"),
    provider: {
      name: "OpenAI",
      color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      hint: "GPT-4o",
    },
  },
  {
    match: (k) => k.length > 20 && (k.includes("mistral") || k.match(/^[a-zA-Z0-9]{32,}$/) !== null),
    provider: {
      name: "Mistral",
      color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-large-latest",
      hint: "Mistral Large",
    },
  },
];

function detectProvider(key: string): Provider | null {
  if (!key || key.length < 8) return null;
  for (const { match, provider } of PROVIDERS) {
    if (match(key)) return provider;
  }
  return null;
}

// ─── Provider selector config ────────────────────────────────────────────────

type ProviderOption = "gemini" | "anthropic" | "openai" | "other";

const PROVIDER_OPTIONS: { value: ProviderOption; label: string; color: string; defaultBaseUrl: string; defaultModel: string }[] = [
  { value: "gemini", label: "Google Gemini", color: "text-blue-400", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", defaultModel: "gemini-2.5-flash" },
  { value: "anthropic", label: "Anthropic Claude", color: "text-orange-400", defaultBaseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-20250514" },
  { value: "openai", label: "OpenAI", color: "text-emerald-400", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  { value: "other", label: "Outro", color: "text-gray-400", defaultBaseUrl: "", defaultModel: "" },
];

function detectProviderOption(key: string): ProviderOption {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("sk-") && !key.startsWith("sk-ant-") && !key.startsWith("sk-or-")) return "openai";
  if (key.length > 10) return "other";
  return "gemini";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AiProfile {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: ProviderOption;
}

const DEFAULT_PROFILE: AiProfile = { name: "", apiKey: "", baseUrl: "", model: "", provider: "gemini" };

const SLOT_ICONS = [
  <Star className="w-3.5 h-3.5" />,
  <Zap className="w-3.5 h-3.5" />,
  <Cpu className="w-3.5 h-3.5" />,
  <FlaskConical className="w-3.5 h-3.5" />,
];

const SLOT_DEFAULT_NAMES = ["Principal", "Rápido", "Especializado", "Teste"];

const LS_PROFILES_KEY = "codelens_ai_profiles";
const LS_ACTIVE_KEY = "codelens_ai_active_slot";

function loadProfiles(): AiProfile[] {
  try {
    const raw = localStorage.getItem(LS_PROFILES_KEY);
    if (!raw) return Array(4).fill(null).map(() => ({ ...DEFAULT_PROFILE }));
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 4) {
      return parsed.map((p: Partial<AiProfile>) => ({
        ...DEFAULT_PROFILE,
        ...p,
        provider: p.provider ?? (p.apiKey ? detectProviderOption(p.apiKey) : "gemini"),
      }));
    }
  } catch {}
  return Array(4).fill(null).map(() => ({ ...DEFAULT_PROFILE }));
}

function saveProfiles(profiles: AiProfile[]) {
  localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles));
}

function loadActiveSlot(): number {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_KEY);
    const n = parseInt(raw ?? "0", 10);
    return isNaN(n) || n < 0 || n > 3 ? 0 : n;
  } catch {
    return 0;
  }
}

// ─── PasswordInput ────────────────────────────────────────────────────────────

function PasswordInput({ value, onChange, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="bg-background pr-10 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // AI profiles state
  const [profiles, setProfiles] = useState<AiProfile[]>(loadProfiles);
  const [activeSlot, setActiveSlot] = useState<number>(loadActiveSlot);
  const [editSlot, setEditSlot] = useState<number>(loadActiveSlot);
  const [detectedProvider, setDetectedProvider] = useState<Provider | null>(null);

  // GitHub token state (separate, goes to backend)
  const [githubToken, setGithubToken] = useState("");
  const [showGhToken, setShowGhToken] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);

  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Configurações salvas com sucesso" });
      },
      onError: (error) => {
        toast({
          title: "Erro ao salvar",
          description: (error as any).error || "Erro desconhecido",
          variant: "destructive",
        });
      },
    },
  });

  // Initialize detect on load
  useEffect(() => {
    const p = profiles[editSlot];
    if (p.apiKey) setDetectedProvider(detectProvider(p.apiKey));
  }, [editSlot]);

  const currentProfile = profiles[editSlot];

  const updateCurrentProfile = (patch: Partial<AiProfile>) => {
    setProfiles((prev) => {
      const next = [...prev];
      next[editSlot] = { ...next[editSlot], ...patch };
      saveProfiles(next);
      return next;
    });
  };

  const handleKeyChange = (value: string) => {
    updateCurrentProfile({ apiKey: value });
    const provider = detectProvider(value.trim());
    setDetectedProvider(provider);
    if (provider) {
      const provOpt = detectProviderOption(value.trim());
      updateCurrentProfile({ apiKey: value, baseUrl: provider.baseUrl, model: "", provider: provOpt });
    }
  };

  const handleProviderChange = (prov: ProviderOption) => {
    const opt = PROVIDER_OPTIONS.find(o => o.value === prov)!;
    updateCurrentProfile({ provider: prov, baseUrl: opt.defaultBaseUrl, model: "" });
    setDetectedProvider(null);
  };

  const handleClearProfile = () => {
    updateCurrentProfile({ apiKey: "", baseUrl: "", model: "", provider: "gemini" });
    setDetectedProvider(null);

    if (activeSlot === editSlot) {
      updateMutation.mutate(
        { data: { aiApiKey: "", aiBaseUrl: "", aiModel: "" } },
        { onSuccess: () => {
          toast({ title: "Perfil resetado", description: "Usando Gemini gratuita agora" });
        }}
      );
    } else {
      toast({ title: "Perfil limpo", description: "Ative este perfil ou outro para aplicar" });
    }
  };

  const handleActivate = () => {
    const profile = profiles[editSlot];
    if (!profile.apiKey.trim() && !profile.baseUrl.trim() && !profile.model.trim()) {
      toast({ title: "Perfil vazio", description: "Adicione pelo menos a chave de API.", variant: "destructive" });
      return;
    }
    localStorage.setItem(LS_ACTIVE_KEY, String(editSlot));
    setActiveSlot(editSlot);
    updateMutation.mutate({
      data: {
        aiApiKey: profile.apiKey || undefined,
        aiBaseUrl: profile.baseUrl || undefined,
        aiModel: profile.model || undefined,
      },
    });
    window.dispatchEvent(new Event("codelens-settings-saved"));
  };

  const handleSaveGithub = () => {
    if (!githubToken.trim()) return;
    setSavingGithub(true);
    updateMutation.mutate(
      { data: { githubToken: githubToken.trim() } },
      { onSettled: () => setSavingGithub(false) }
    );
    setGithubToken("");
  };

  const slotName = (i: number) =>
    profiles[i].name.trim() || SLOT_DEFAULT_NAMES[i];

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-background p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Configurações
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure seus perfis de IA e integrações
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-6 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-card rounded-lg border border-border" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* ─── AI Profiles Section ─────────────────────────────────── */}
              <div className="p-5 sm:p-6 rounded-xl border border-border bg-card/50 space-y-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h2 className="text-base font-medium text-foreground">
                    Perfis de IA
                  </h2>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Ativo: <strong className="text-primary">{slotName(activeSlot)}</strong>
                  </span>
                </div>

                {/* Profile tabs */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[0, 1, 2, 3].map((i) => {
                    const hasKey = !!profiles[i].apiKey.trim();
                    const isActive = activeSlot === i;
                    const isEditing = editSlot === i;
                    return (
                      <button
                        key={i}
                        onClick={() => { setEditSlot(i); setDetectedProvider(detectProvider(profiles[i].apiKey)); }}
                        className={cn(
                          "flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border text-center transition-all",
                          isEditing
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-border/80 hover:bg-accent/30 text-muted-foreground"
                        )}
                      >
                        <div className="relative">
                          {SLOT_ICONS[i]}
                          {isActive && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400" />
                          )}
                        </div>
                        <span className="text-[10px] font-medium leading-tight truncate w-full">
                          {slotName(i)}
                        </span>
                        {hasKey && (
                          <span className="text-[9px] text-green-400 leading-none">●</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Edit selected profile */}
                <div className="space-y-4 pt-1">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[11px] text-muted-foreground font-medium px-2">
                      Editando: {slotName(editSlot)}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  {/* Profile name */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome do perfil</Label>
                    <Input
                      value={currentProfile.name}
                      onChange={(e) => updateCurrentProfile({ name: e.target.value })}
                      placeholder={SLOT_DEFAULT_NAMES[editSlot]}
                      className="bg-background text-sm h-8"
                    />
                  </div>

                  {/* Provider selector */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Provedor de IA</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {PROVIDER_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleProviderChange(opt.value)}
                          className={cn(
                            "py-2 px-3 rounded-lg border text-xs font-medium transition-all text-center",
                            currentProfile.provider === opt.value
                              ? `border-primary bg-primary/10 ${opt.color}`
                              : "border-border hover:border-border/80 hover:bg-accent/30 text-muted-foreground"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reset button - always visible */}
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleClearProfile}
                    className="w-full gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Resetar / Limpar este perfil
                  </Button>

                  {/* API Key */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Chave de API</Label>
                    {detectedProvider && (
                      <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium",
                        detectedProvider.color
                      )}>
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          <strong>{detectedProvider.name}</strong> detectado automaticamente
                        </span>
                      </div>
                    )}
                    <PasswordInput
                      value={currentProfile.apiKey}
                      onChange={handleKeyChange}
                      placeholder={
                        currentProfile.provider === "anthropic" ? "sk-ant-..." :
                        currentProfile.provider === "gemini" ? "AIzaSy..." :
                        currentProfile.provider === "openai" ? "sk-..." :
                        "Cole sua chave de API"
                      }
                    />
                  </div>

                  {/* Model */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Modelo <span className="text-muted-foreground font-normal">(digite qualquer modelo)</span></Label>
                    </div>
                    <Input
                      value={currentProfile.model}
                      onChange={(e) => updateCurrentProfile({ model: e.target.value })}
                      placeholder="Automático (deixe vazio)"
                      className="bg-background font-mono text-xs"
                    />
                  </div>

                  {/* URL Base - only for "Outro" or always editable */}
                  {(currentProfile.provider === "other" || currentProfile.baseUrl) && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">URL Base {currentProfile.provider !== "other" && <span className="text-muted-foreground">(preenchido automaticamente)</span>}</Label>
                      <Input
                        value={currentProfile.baseUrl}
                        onChange={(e) => updateCurrentProfile({ baseUrl: e.target.value })}
                        placeholder="https://api.exemplo.com/v1"
                        className="bg-background font-mono text-xs"
                        readOnly={currentProfile.provider !== "other"}
                      />
                    </div>
                  )}

                  {/* Activate button */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleActivate}
                      disabled={updateMutation.isPending}
                      className="gap-2 flex-1"
                      variant={activeSlot === editSlot ? "outline" : "default"}
                    >
                      {updateMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : activeSlot === editSlot ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <Zap className="w-4 h-4" />
                      )}
                      {activeSlot === editSlot ? "Perfil ativo — salvar alterações" : "Ativar este perfil"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                      disabled={updateMutation.isPending}
                      onClick={() => {
                        updateMutation.mutate(
                          { data: { aiApiKey: "", aiBaseUrl: "", aiModel: "" } },
                          { onSuccess: () => {
                            toast({ title: "Usando Gemini gratuita", description: "IA padrão ativada" });
                          }}
                        );
                      }}
                      title="Voltar para a Gemini 2.5 Flash gratuita"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Usar Gemini
                    </Button>
                  </div>
                </div>

                {/* Providers quick guide */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  {[
                    { name: "Perplexity", prefix: "pplx-…", color: "text-cyan-400" },
                    { name: "OpenAI", prefix: "sk-…", color: "text-emerald-400" },
                    { name: "Anthropic", prefix: "sk-ant-…", color: "text-orange-400" },
                    { name: "Gemini", prefix: "AIzaSy…", color: "text-blue-400" },
                    { name: "Groq", prefix: "gsk_…", color: "text-purple-400" },
                    { name: "OpenRouter", prefix: "sk-or-…", color: "text-green-400" },
                    { name: "xAI (Grok)", prefix: "xai-…", color: "text-gray-300" },
                  ].map(({ name, prefix, color }) => (
                    <div
                      key={name}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-background/60 border border-border/40 text-[11px]"
                    >
                      <span className={cn("font-semibold shrink-0", color)}>{name}</span>
                      <code className="text-muted-foreground truncate">{prefix}</code>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="text-blue-300">
                    <strong>Gemini 2.5 Flash</strong> disponível gratuitamente como padrão — funciona mesmo sem nenhum perfil configurado
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  A Gemini gratuita nunca some — ela é sua IA base. Os perfis são opcionais: use para
                  adicionar outra IA para revisão de código (ex: Claude, GPT-4o), análise rápida (Groq),
                  ou teste. Você pode trocar entre perfis sem perder a Gemini.
                </p>
              </div>

              {/* ─── GitHub Section ───────────────────────────────────────── */}
              <div className="p-5 sm:p-6 rounded-xl border border-border bg-card/50 space-y-4">
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4 text-foreground" />
                  <h2 className="text-base font-medium text-foreground">GitHub</h2>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Token de Acesso Pessoal</Label>
                    {settings?.githubTokenSet ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-primary flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Configurado
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> Não configurado
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showGhToken ? "text" : "password"}
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder={settings?.githubTokenSet ? "••••••••  (cole para substituir)" : "ghp_..."}
                      className="bg-background pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGhToken((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showGhToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Necessário para exportar ao GitHub. Permissão <code>repo</code> necessária.
                  </p>
                </div>

                <Button
                  onClick={handleSaveGithub}
                  disabled={!githubToken.trim() || savingGithub}
                  className="gap-2"
                  size="sm"
                >
                  {savingGithub ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
                  Salvar token do GitHub
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
