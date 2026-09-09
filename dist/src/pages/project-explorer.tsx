import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetProject,
  useGetFileContent,
  getGetProjectQueryKey,
  getGetFileContentQueryKey,
  type FileContent,
} from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { FileTree } from "@/components/file-tree";
import { useFileOps } from "@/hooks/use-file-ops";
import { CodeViewer } from "@/components/code-viewer";
import { AiPanel, type TerminalLogEntry } from "@/components/ai-panel";
import { TerminalPanel, type TerminalEntry } from "@/components/terminal-panel";
import { PackagesPanel } from "@/components/packages-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { GithubDeployModal } from "@/components/github-deploy-modal";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  Github,
  Loader2,
  ArrowLeft,
  TerminalSquare,
  Terminal,
  Files,
  Code2,
  Sparkles,
  FilePlus,
  FolderPlus,
  Monitor,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { ImperativePanelHandle } from "react-resizable-panels";

type ContextMode = "none" | "file" | "project";
type MobileTab = "files" | "code" | "preview" | "ai" | "terminal";

export default function ProjectExplorer() {
  const params = useParams();
  const projectId = params.id!;
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // File navigation history
  const [fileHistory, setFileHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const selectedFile = historyIndex >= 0 ? fileHistory[historyIndex] : undefined;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < fileHistory.length - 1;

  const openFile = useCallback((path: string) => {
    if (fileHistory[historyIndex] === path) return;
    const newHistory = [...fileHistory.slice(0, historyIndex + 1), path];
    setFileHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [fileHistory, historyIndex]);

  const navigateBack = useCallback(() => {
    setHistoryIndex((i) => Math.max(0, i - 1));
  }, []);

  const navigateForward = useCallback(() => {
    setHistoryIndex((i) => Math.min(fileHistory.length - 1, i + 1));
  }, [fileHistory.length]);

  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("files");
  const [mobilePreviewPath, setMobilePreviewPath] = useState<string | undefined>(undefined);
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<{ cmd: string; id: number } | null>(null);
  const [externalMessage, setExternalMessage] = useState<{ text: string; id: number; contextMode?: ContextMode } | null>(null);
  const [terminalLog, setTerminalLog] = useState<TerminalEntry[]>([]);
  const [terminalPort, setTerminalPort] = useState<number | null>(null);

  const handleServerDetected = useCallback((port: number) => {
    setTerminalPort(port);
    // Auto-switch to preview tab on mobile so user can see the result immediately
    setMobileTab("preview");
  }, []);

  // Convert new TerminalEntry (chunks) → old TerminalLogEntry (stdout/stderr) for AiPanel
  const aiTerminalLog = useMemo<TerminalLogEntry[]>(() =>
    terminalLog.filter(e => !e.running).map(e => ({
      command: e.command,
      stdout: e.chunks.filter(c => c.type === "stdout").map(c => c.text).join(""),
      stderr: e.chunks.filter(c => c.type === "stderr").map(c => c.text).join(""),
      exitCode: e.exitCode ?? 0,
    })),
    [terminalLog]
  );
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const queryClient = useQueryClient();

  const refreshProjectTree = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
  }, [queryClient, projectId]);

  const { data: project, isLoading: isProjectLoading } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });

  const { data: fileContent, isLoading: isFileLoading } = useGetFileContent(
    projectId,
    { path: selectedFile! },
    {
      query: {
        enabled: !!selectedFile,
        queryKey: getGetFileContentQueryKey(projectId, { path: selectedFile! }),
      },
    }
  );

  const fileOps = useFileOps(projectId);

  useEffect(() => {
    if (fileOps.error) {
      toast({ title: "Erro na operação", description: fileOps.error, variant: "destructive" });
      fileOps.clearError();
    }
  }, [fileOps.error]);

  const [pendingAnalysisPath, setPendingAnalysisPath] = useState<string | null>(null);

  const triggerFileAnalysis = (path: string) => {
    const fileName = path.split("/").pop() ?? path;
    setExternalMessage({
      text: `Analise o arquivo "${fileName}". Explique o que ele faz, suas responsabilidades e aponte possíveis melhorias.`,
      id: Date.now(),
      contextMode: "file",
    });
    if (isMobile) setMobileTab("ai");
  };

  const handleAnalyzeFileClick = (path: string) => {
    if (selectedFile === path && fileContent) {
      triggerFileAnalysis(path);
    } else {
      openFile(path);
      setPendingAnalysisPath(path);
    }
  };

  React.useEffect(() => {
    if (pendingAnalysisPath && selectedFile === pendingAnalysisPath && fileContent) {
      triggerFileAnalysis(pendingAnalysisPath);
      setPendingAnalysisPath(null);
    }
  }, [pendingAnalysisPath, selectedFile, fileContent]);

  const handleAnalyzeFolderClick = (folderPath: string) => {
    const folderName = (folderPath.split("/").pop() ?? folderPath) || "raiz";
    setExternalMessage({
      text: `Analise a pasta "${folderName}" do projeto. Explique seu papel na arquitetura geral.`,
      id: Date.now(),
    });
    if (isMobile) setMobileTab("ai");
  };

  const handleSelectFile = (path: string) => {
    openFile(path);
    if (isMobile) setMobileTab("code");
  };

  const handleRunCommand = useCallback((cmd: string) => {
    setPendingTerminalCommand({ cmd, id: Date.now() });
    if (isMobile) {
      setMobileTab("terminal");
    } else {
      setTerminalOpen(true);
    }
  }, [isMobile]);

  const fileContextForAi = fileContent
    ? { path: fileContent.path, content: fileContent.content, language: fileContent.language }
    : null;

  // ─── Loading ─────────────────────────────────────────────────────────────────
  if (isProjectLoading) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center text-muted-foreground">
          Projeto não encontrado.
        </div>
      </AppLayout>
    );
  }

  // ─── Mobile Layout ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <AppLayout hideBottomNav>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Mobile header */}
          <header className="h-12 shrink-0 border-b border-border bg-card flex items-center px-3 gap-2 z-10">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <TerminalSquare className="w-4 h-4 text-primary shrink-0" />
              <span className="font-medium text-sm text-foreground truncate">{project.name}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
                window.open(`${base}/api/projects/${projectId}/export`, "_blank");
              }}
              className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
              title="Baixar ZIP"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setGithubModalOpen(true)}
              className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
            >
              <Github className="w-4 h-4" />
            </Button>
          </header>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">

            {/* Files tab */}
            <div className={cn("h-full overflow-hidden flex flex-col", mobileTab !== "files" && "hidden")}>
              <div className="h-9 shrink-0 flex items-center px-3 border-b border-border/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-background/30 gap-2">
                <span className="flex-1 tracking-wider">Explorer</span>
                <button title="Novo arquivo" onClick={() => fileOps.createFile("novo-arquivo.txt", "")} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
                <button title="Nova pasta" onClick={() => fileOps.createFolder("nova-pasta")} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <FileTree
                  node={project.tree}
                  onSelectFile={handleSelectFile}
                  onAnalyzeFile={handleAnalyzeFileClick}
                  onAnalyzeFolder={handleAnalyzeFolderClick}
                  selectedPath={selectedFile}
                  ops={fileOps}
                />
              </div>
              <div className="shrink-0 overflow-auto max-h-[50%]">
                <PackagesPanel
                  projectId={projectId}
                  fileTree={project.tree}
                  onRunCommand={(cmd) => { handleRunCommand(cmd); setMobileTab("terminal"); }}
                />
              </div>
            </div>

            {/* Code tab */}
            <div className={cn("h-full flex flex-col", mobileTab !== "code" && "hidden")}>
              {!selectedFile ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
                  <Files className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">Selecione um arquivo na aba Arquivos</p>
                </div>
              ) : (
                <CodeViewer
                  file={fileContent}
                  isLoading={isFileLoading && !!selectedFile}
                  canGoBack={canGoBack}
                  canGoForward={canGoForward}
                  onBack={navigateBack}
                  onForward={navigateForward}
                  onPreview={(path) => { setMobilePreviewPath(path); setMobileTab("preview"); }}
                  projectId={projectId}
                />
              )}
            </div>

            {/* AI tab */}
            <div className={cn("h-full", mobileTab !== "ai" && "hidden")}>
              <AiPanel
                projectId={projectId}
                fileContext={fileContextForAi}
                externalMessage={externalMessage}
                onRunCommand={handleRunCommand}
                terminalLog={aiTerminalLog}
              />
            </div>

            {/* Preview tab */}
            <div className={cn("h-full", mobileTab !== "preview" && "hidden")}>
              <PreviewPanel
                projectId={projectId}
                onRunBuild={(cmd) => { handleRunCommand(cmd); setMobileTab("terminal"); }}
                previewPath={mobilePreviewPath}
                terminalPort={terminalPort}
              />
            </div>

            {/* Terminal tab */}
            <div className={cn("h-full", mobileTab !== "terminal" && "hidden")}>
              <TerminalPanel
                projectId={projectId}
                pendingCommand={pendingTerminalCommand}
                onEntriesChange={setTerminalLog}
                onServerDetected={handleServerDetected}
                onCommandDone={refreshProjectTree}
              />
            </div>
          </div>

          {/* Mobile bottom tab bar */}
          <nav className="shrink-0 h-14 border-t border-border bg-card flex items-stretch">
            <MobileTabButton
              label="Arquivos"
              icon={<Files className="w-5 h-5" />}
              active={mobileTab === "files"}
              onClick={() => setMobileTab("files")}
            />
            <MobileTabButton
              label="Código"
              icon={<Code2 className="w-5 h-5" />}
              active={mobileTab === "code"}
              onClick={() => setMobileTab("code")}
              badge={selectedFile ? selectedFile.split("/").pop() : undefined}
            />
            <MobileTabButton
              label="Preview"
              icon={<Monitor className="w-5 h-5" />}
              active={mobileTab === "preview"}
              onClick={() => setMobileTab("preview")}
            />
            <MobileTabButton
              label="IA"
              icon={<Sparkles className="w-5 h-5" />}
              active={mobileTab === "ai"}
              onClick={() => setMobileTab("ai")}
            />
            <MobileTabButton
              label="Terminal"
              icon={<Terminal className="w-5 h-5" />}
              active={mobileTab === "terminal"}
              onClick={() => setMobileTab("terminal")}
            />
          </nav>
        </div>

        <GithubDeployModal
          open={githubModalOpen}
          onOpenChange={setGithubModalOpen}
          projectId={project.id}
          defaultName={project.name}
        />
      </AppLayout>
    );
  }

  // ─── Desktop Layout ───────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <header className="h-12 shrink-0 border-b border-border bg-card flex items-center px-4 justify-between z-10">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <TerminalSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-foreground">{project.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTerminalOpen((v) => !v)}
              className="h-7 gap-1.5 text-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              Terminal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
                window.open(`${base}/api/projects/${projectId}/export`, "_blank");
              }}
              className="h-7 gap-1.5 text-xs"
              title="Baixar projeto como ZIP"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar ZIP
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGithubModalOpen(true)}
              className="h-7 gap-1.5 text-xs"
            >
              <Github className="w-3.5 h-3.5" />
              GitHub
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="vertical" className="h-full">
            {/* Main row */}
            <ResizablePanel defaultSize={terminalOpen ? 65 : 100} minSize={30}>
              <ResizablePanelGroup direction="horizontal" className="h-full">

                {/* File tree */}
                <ResizablePanel defaultSize={18} minSize={12} maxSize={35}>
                  <div className="h-full flex flex-col border-r border-border overflow-hidden">
                    <div className="h-9 shrink-0 flex items-center px-3 border-b border-border/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-background/30 gap-2">
                      <span className="flex-1 tracking-wider">Explorer</span>
                      <button title="Novo arquivo" onClick={() => fileOps.createFile("novo-arquivo.txt", "")} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                        <FilePlus className="w-3.5 h-3.5" />
                      </button>
                      <button title="Nova pasta" onClick={() => fileOps.createFolder("nova-pasta")} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                        <FolderPlus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                      <FileTree
                        node={project.tree}
                        onSelectFile={handleSelectFile}
                        onAnalyzeFile={handleAnalyzeFileClick}
                        onAnalyzeFolder={handleAnalyzeFolderClick}
                        selectedPath={selectedFile}
                        ops={fileOps}
                      />
                    </div>
                    <div className="shrink-0 overflow-auto max-h-[50%]">
                      <PackagesPanel
                        projectId={projectId}
                        fileTree={project.tree}
                        onRunCommand={(cmd) => {
                          handleRunCommand(cmd);
                          setTerminalOpen(true);
                        }}
                      />
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle className="bg-border w-[1px] hover:w-1 hover:bg-primary/50 transition-all" />

                {/* Code / Preview panel */}
                <ResizablePanel defaultSize={52} minSize={30}>
                  <DesktopCodePreview
                    projectId={projectId}
                    fileContent={fileContent}
                    isFileLoading={isFileLoading && !!selectedFile}
                    canGoBack={canGoBack}
                    canGoForward={canGoForward}
                    onBack={navigateBack}
                    onForward={navigateForward}
                    onRunBuild={(cmd) => { handleRunCommand(cmd); setTerminalOpen(true); }}
                    terminalPort={terminalPort}
                  />
                </ResizablePanel>

                <ResizableHandle className="bg-border w-[1px] hover:w-1 hover:bg-primary/50 transition-all" />

                {/* AI Panel */}
                <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
                  <AiPanel
                    projectId={projectId}
                    fileContext={fileContextForAi}
                    externalMessage={externalMessage}
                    onRunCommand={handleRunCommand}
                    terminalLog={aiTerminalLog}
                  />
                </ResizablePanel>

              </ResizablePanelGroup>
            </ResizablePanel>

            {/* Terminal panel */}
            {terminalOpen && (
              <>
                <ResizableHandle className="bg-border h-[1px] hover:h-1 hover:bg-green-500/50 transition-all" />
                <ResizablePanel
                  ref={terminalPanelRef}
                  defaultSize={35}
                  minSize={15}
                  maxSize={60}
                >
                  <TerminalPanel
                    projectId={projectId}
                    onClose={() => setTerminalOpen(false)}
                    pendingCommand={pendingTerminalCommand}
                    onEntriesChange={setTerminalLog}
                    onServerDetected={handleServerDetected}
                    onCommandDone={refreshProjectTree}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>

      <GithubDeployModal
        open={githubModalOpen}
        onOpenChange={setGithubModalOpen}
        projectId={project.id}
        defaultName={project.name}
      />
    </AppLayout>
  );
}

// ─── Desktop: Code / Preview tab switcher ────────────────────────────────────

function DesktopCodePreview({
  projectId,
  fileContent,
  isFileLoading,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onRunBuild,
  terminalPort,
}: {
  projectId: string;
  fileContent: FileContent | undefined;
  isFileLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onRunBuild: (cmd: string) => void;
  terminalPort?: number | null;
}) {
  const [view, setView] = React.useState<"code" | "preview">("code");
  const [previewPath, setPreviewPath] = React.useState<string | undefined>(undefined);

  const handlePreview = React.useCallback((filePath: string) => {
    setPreviewPath(filePath);
    setView("preview");
  }, []);

  // Auto-switch to preview when terminal detects a running server
  React.useEffect(() => {
    if (terminalPort) setView("preview");
  }, [terminalPort]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab switcher */}
      <div className="h-8 shrink-0 flex border-b border-[#30363d] bg-[#161b22]">
        <button
          onClick={() => setView("code")}
          className={cn(
            "px-4 text-xs font-medium transition-colors flex items-center gap-1.5",
            view === "code"
              ? "text-[#e6edf3] border-b-2 border-primary -mb-px"
              : "text-[#8b949e] hover:text-[#c9d1d9]"
          )}
        >
          <Code2 className="w-3 h-3" />
          Código
        </button>
        <button
          onClick={() => setView("preview")}
          className={cn(
            "px-4 text-xs font-medium transition-colors flex items-center gap-1.5",
            view === "preview"
              ? "text-[#e6edf3] border-b-2 border-primary -mb-px"
              : "text-[#8b949e] hover:text-[#c9d1d9]"
          )}
        >
          <Monitor className="w-3 h-3" />
          Preview
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "code" ? (
          <CodeViewer
            file={fileContent}
            isLoading={isFileLoading}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={onBack}
            onForward={onForward}
            onPreview={handlePreview}
            projectId={projectId}
          />
        ) : (
          <PreviewPanel
            projectId={projectId}
            onRunBuild={onRunBuild}
            previewPath={previewPath}
            terminalPort={terminalPort}
          />
        )}
      </div>
    </div>
  );
}

// ─── Mobile Tab Button ────────────────────────────────────────────────────────

function MobileTabButton({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      {active && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />
      )}
      {icon}
      <span>{label}</span>
      {badge && (
        <span className="absolute top-1.5 right-3 text-[8px] bg-primary/20 text-primary px-1 rounded-full max-w-[60px] truncate">
          {badge}
        </span>
      )}
    </button>
  );
}
