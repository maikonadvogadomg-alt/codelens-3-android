import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Package,
  Play,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Search,
  Download,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib-api-client";

// ─── Popular packages for quick install ──────────────────────────────────────

const POPULAR_PACKAGES: { category: string; pkgs: { name: string; desc: string }[] }[] = [
  {
    category: "Requisições HTTP",
    pkgs: [
      { name: "axios", desc: "Chamadas HTTP" },
      { name: "node-fetch", desc: "fetch para Node" },
    ],
  },
  {
    category: "React",
    pkgs: [
      { name: "react-router-dom", desc: "Rotas" },
      { name: "zustand", desc: "Estado global" },
      { name: "react-query", desc: "Dados async" },
      { name: "react-hook-form", desc: "Formulários" },
      { name: "framer-motion", desc: "Animações" },
    ],
  },
  {
    category: "Estilo / UI",
    pkgs: [
      { name: "tailwindcss", desc: "CSS utilitário" },
      { name: "styled-components", desc: "CSS-in-JS" },
      { name: "clsx", desc: "Classnames" },
      { name: "lucide-react", desc: "Ícones" },
    ],
  },
  {
    category: "Gráficos",
    pkgs: [
      { name: "recharts", desc: "Gráficos React" },
      { name: "chart.js", desc: "Chart.js" },
      { name: "d3", desc: "Visualização" },
    ],
  },
  {
    category: "Datas / Utils",
    pkgs: [
      { name: "dayjs", desc: "Datas" },
      { name: "date-fns", desc: "Utilitários de data" },
      { name: "lodash", desc: "Utilitários JS" },
      { name: "uuid", desc: "Gerar IDs únicos" },
      { name: "zod", desc: "Validação" },
    ],
  },
  {
    category: "Backend / Node",
    pkgs: [
      { name: "express", desc: "Servidor web" },
      { name: "cors", desc: "CORS middleware" },
      { name: "dotenv", desc: "Variáveis de ambiente" },
      { name: "jsonwebtoken", desc: "JWT" },
      { name: "bcrypt", desc: "Criptografia" },
    ],
  },
];

// ─── Project-type detection ──────────────────────────────────────────────────

interface PackageManager {
  label: string;
  color: string;
  installCmd: (pkg: string) => string;
  runCmds: { label: string; cmd: string }[];
  hint: string;
  markerFile: string;
  preInstalled?: boolean;
  supportsSearch?: boolean;
}

const MANAGERS: PackageManager[] = [
  {
    markerFile: "package.json",
    label: "npm (Node/React/Next)",
    color: "text-green-400",
    preInstalled: true,
    supportsSearch: true,
    installCmd: (p) => `npm install ${p}`,
    runCmds: [
      { label: "Instalar deps", cmd: "npm install" },
      { label: "Dev server", cmd: "npm run dev" },
      { label: "Build", cmd: "npm run build" },
      { label: "Testes", cmd: "npm test" },
      { label: "Iniciar", cmd: "npm start" },
    ],
    hint: "Buscar pacote npm…",
  },
  {
    markerFile: "pyproject.toml",
    label: "Poetry (Python)",
    color: "text-blue-400",
    installCmd: (p) => `poetry add ${p}`,
    runCmds: [
      { label: "Instalar deps", cmd: "poetry install" },
      { label: "Executar", cmd: "poetry run python3 main.py" },
      { label: "Testes", cmd: "poetry run pytest" },
    ],
    hint: "ex: requests, pandas, fastapi",
  },
  {
    markerFile: "Pipfile",
    label: "Pipenv (Python)",
    color: "text-blue-400",
    installCmd: (p) => `pipenv install ${p}`,
    runCmds: [
      { label: "Instalar deps", cmd: "pipenv install" },
      { label: "Executar", cmd: "pipenv run python3 main.py" },
    ],
    hint: "ex: requests, django, flask",
  },
  {
    markerFile: "requirements.txt",
    label: "pip / Python",
    color: "text-yellow-400",
    installCmd: (p) => `pip3 install ${p}`,
    runCmds: [
      { label: "Instalar requirements", cmd: "pip3 install -r requirements.txt" },
      { label: "Executar", cmd: "python3 main.py" },
      { label: "Testes", cmd: "python3 -m pytest" },
    ],
    hint: "ex: requests, pandas, flask, numpy",
  },
  {
    markerFile: "Cargo.toml",
    label: "Cargo (Rust)",
    color: "text-orange-400",
    installCmd: (p) => `cargo add ${p}`,
    runCmds: [
      { label: "Build", cmd: "cargo build" },
      { label: "Executar", cmd: "cargo run" },
      { label: "Testes", cmd: "cargo test" },
    ],
    hint: "ex: serde, tokio, reqwest",
  },
  {
    markerFile: "go.mod",
    label: "Go Modules",
    color: "text-cyan-400",
    installCmd: (p) => `go get ${p}`,
    runCmds: [
      { label: "Build", cmd: "go build ./..." },
      { label: "Executar", cmd: "go run ." },
      { label: "Testes", cmd: "go test ./..." },
    ],
    hint: "ex: github.com/gin-gonic/gin",
  },
  {
    markerFile: "composer.json",
    label: "Composer (PHP)",
    color: "text-purple-400",
    installCmd: (p) => `composer require ${p}`,
    runCmds: [
      { label: "Instalar deps", cmd: "composer install" },
    ],
    hint: "ex: guzzlehttp/guzzle",
  },
  {
    markerFile: "Gemfile",
    label: "Bundler (Ruby)",
    color: "text-red-400",
    installCmd: (p) => `bundle add ${p}`,
    runCmds: [
      { label: "Instalar gems", cmd: "bundle install" },
      { label: "Executar", cmd: "bundle exec ruby app.rb" },
    ],
    hint: "ex: rails, sinatra, nokogiri",
  },
];

interface DetectedManager {
  manager: PackageManager;
  depsInstalled: boolean;
}

function detectManager(node: FileNode): DetectedManager | null {
  const names = collectFileNames(node);
  for (const m of MANAGERS) {
    if (names.has(m.markerFile)) {
      const depsInstalled = m.markerFile === "package.json" ? names.has("node_modules") : true;
      return { manager: m, depsInstalled };
    }
  }
  return null;
}

function collectFileNames(node: FileNode, out = new Set<string>()): Set<string> {
  out.add(node.name);
  node.children?.forEach((c) => collectFileNames(c, out));
  return out;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

// ─── npm search ───────────────────────────────────────────────────────────────

interface NpmPackage {
  name: string;
  description: string;
  version: string;
  weeklyDownloads?: number;
}

async function searchNpm(query: string): Promise<NpmPackage[]> {
  if (!query.trim()) return [];
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha ao buscar pacotes");
  const data = await res.json() as {
    objects: Array<{
      package: { name: string; description: string; version: string };
      downloads?: { weekly: number };
    }>;
  };
  return data.objects.map((o) => ({
    name: o.package.name,
    description: o.package.description ?? "",
    version: o.package.version,
    weeklyDownloads: o.downloads?.weekly,
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

interface PackagesPanelProps {
  projectId: string;
  fileTree: FileNode;
  onRunCommand: (cmd: string) => void;
}

export function PackagesPanel({ projectId, fileTree, onRunCommand }: PackagesPanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"popular" | "search" | "commands">("popular");
  const [pkg, setPkg] = useState("");
  const [searchResults, setSearchResults] = useState<NpmPackage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>("Requisições HTTP");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => detectManager(fileTree), [fileTree]);
  const manager = detected?.manager ?? null;
  const depsInstalled = detected?.depsInstalled ?? false;
  const isNpm = manager?.supportsSearch || !manager;

  const installCmd = (name: string) =>
    manager ? manager.installCmd(name) : `npm install ${name}`;

  const handleInstall = (name: string) => {
    onRunCommand(installCmd(name));
    setPkg("");
    setSearchResults([]);
  };

  // Debounced npm search
  useEffect(() => {
    if (!isNpm) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!pkg.trim() || pkg.trim().length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        setSearchResults(await searchNpm(pkg.trim()));
      } catch {
        setSearchError("Não foi possível buscar. Verifique a conexão.");
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [pkg, isNpm]);

  return (
    <div className="border-t border-border/40">
      {/* Toggle header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <Package className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">Pacotes</span>
        {manager && (
          <span className={cn("text-[10px] normal-case font-normal mr-1", manager.color)}>
            {manager.label.split(" ")[0]}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col">
          {/* Manager badge */}
          {manager ? (
            <div className="px-3 pb-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={cn("text-[11px] font-medium", manager.color)}>{manager.label}</span>
                {depsInstalled ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
                    <CheckCircle2 className="w-2.5 h-2.5" /> instalado
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                    <AlertTriangle className="w-2.5 h-2.5" /> não instalado
                  </span>
                )}
              </div>
              {!depsInstalled && manager.markerFile === "package.json" && (
                <button
                  onClick={() => onRunCommand("npm install")}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border border-yellow-500/30 text-xs font-medium transition-colors active:scale-[0.98] touch-manipulation"
                >
                  <Download className="w-3.5 h-3.5" />
                  Instalar dependências (npm install)
                </button>
              )}
            </div>
          ) : (
            <div className="px-3 pb-1">
              <div className="text-[11px] text-muted-foreground bg-accent/20 border border-border/40 rounded px-2.5 py-2 leading-relaxed">
                Sem <code className="text-primary">package.json</code>.{" "}
                <button
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                  onClick={() => onRunCommand("npm init -y")}
                >
                  Inicializar npm
                </button>
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex border-b border-border/40 px-3 gap-0">
            {isNpm && (
              <button
                onClick={() => setTab("popular")}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-1.5 border-b-2 transition-colors",
                  tab === "popular"
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className="w-3 h-3" /> Popular
              </button>
            )}
            {isNpm && (
              <button
                onClick={() => { setTab("search"); setTimeout(() => inputRef.current?.focus(), 50); }}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-1.5 border-b-2 transition-colors",
                  tab === "search"
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Search className="w-3 h-3" /> Buscar
              </button>
            )}
            {manager && (
              <button
                onClick={() => setTab("commands")}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-1.5 border-b-2 transition-colors",
                  tab === "commands"
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Play className="w-3 h-3" /> Comandos
              </button>
            )}
          </div>

          {/* Popular tab */}
          {tab === "popular" && isNpm && (
            <div className="px-3 py-2 space-y-2">
              {POPULAR_PACKAGES.map((cat) => (
                <div key={cat.category}>
                  <button
                    className="w-full flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1 hover:text-foreground transition-colors"
                    onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                  >
                    {expandedCategory === cat.category
                      ? <ChevronDown className="w-3 h-3 shrink-0" />
                      : <ChevronRight className="w-3 h-3 shrink-0" />
                    }
                    {cat.category}
                  </button>
                  {expandedCategory === cat.category && (
                    <div className="flex flex-col gap-1 ml-1">
                      {cat.pkgs.map((p) => (
                        <button
                          key={p.name}
                          onClick={() => handleInstall(p.name)}
                          className="flex items-center gap-2 px-2 py-2 rounded border border-border/40 bg-background/40 hover:bg-accent/40 hover:border-primary/30 transition-colors text-left active:scale-[0.98] touch-manipulation"
                        >
                          <Plus className="w-3.5 h-3.5 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-mono font-semibold text-foreground">{p.name}</div>
                            <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Search tab */}
          {tab === "search" && isNpm && (
            <div className="px-3 py-2 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={pkg}
                  onChange={(e) => setPkg(e.target.value)}
                  placeholder="ex: axios, chart, form…"
                  className="w-full h-10 pl-8 pr-8 text-sm bg-background/60 border border-border/60 rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-colors touch-manipulation"
                  style={{ fontSize: "16px" }}
                />
                {pkg && (
                  <button
                    onClick={() => { setPkg(""); setSearchResults([]); inputRef.current?.focus(); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {searching && (
                <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando no npm…
                </div>
              )}
              {searchError && <p className="text-[11px] text-red-400 py-1">{searchError}</p>}
              {!searching && pkg.trim().length >= 2 && searchResults.length === 0 && !searchError && (
                <p className="text-[11px] text-muted-foreground py-1">Nenhum resultado para "{pkg}".</p>
              )}
              {searchResults.length > 0 && (
                <div className="space-y-1.5">
                  {searchResults.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => handleInstall(p.name)}
                      className="w-full flex items-start gap-2 p-2.5 rounded border border-border/40 bg-background/40 hover:bg-accent/40 hover:border-primary/30 transition-colors text-left active:scale-[0.98] touch-manipulation"
                    >
                      <Plus className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-mono font-semibold text-foreground">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground">v{p.version}</span>
                          {p.weeklyDownloads && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Download className="w-2.5 h-2.5" />{formatDownloads(p.weeklyDownloads)}/sem
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 text-left">{p.description}</p>
                        )}
                        <span className="text-[10px] text-primary/70 mt-0.5 block">Toque para instalar</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!pkg.trim() && (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Digite o nome do pacote acima para buscar no npm
                </p>
              )}
            </div>
          )}

          {/* Commands tab */}
          {tab === "commands" && manager && (
            <div className="px-3 py-2 space-y-1">
              {manager.runCmds.map(({ label, cmd }) => (
                <button
                  key={cmd}
                  onClick={() => onRunCommand(cmd)}
                  className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded text-left border border-border/40 bg-background/40 hover:bg-accent/40 hover:border-primary/30 transition-colors active:scale-[0.98] touch-manipulation"
                >
                  <Play className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  <span className="flex-1 text-[12px] text-foreground/80 font-medium">{label}</span>
                  <code className="text-muted-foreground text-[10px] truncate max-w-[100px]">{cmd}</code>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
