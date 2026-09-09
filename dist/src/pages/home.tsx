import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";
import {
  useListProjects,
  useUploadProject,
  useDeleteProject,
  useImportFromGithub,
  getListProjectsQueryKey,
} from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  FolderArchive,
  Loader2,
  Clock,
  HardDrive,
  FileCode2,
  Github,
  Upload,
  FileText,
  Globe,
  Box,
  Atom,
} from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";

// ─── Templates ───────────────────────────────────────────────────────────────

interface Template {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const TEMPLATES: Template[] = [
  {
    id: "html",
    label: "HTML + CSS + JS",
    description: "Site estático pronto. Preview funciona na hora, sem instalar nada.",
    icon: <Globe className="w-5 h-5" />,
    color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  },
  {
    id: "node",
    label: "Node.js (servidor)",
    description: "Servidor HTTP sem dependências. Clique em Iniciar no Preview para rodar.",
    icon: <Box className="w-5 h-5" />,
    color: "text-green-400 bg-green-400/10 border-green-400/30",
  },
  {
    id: "express",
    label: "Express + API",
    description: "Servidor Express com rota de API. Requer npm install, depois Iniciar.",
    icon: <Box className="w-5 h-5" />,
    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  },
  {
    id: "react",
    label: "React + Vite",
    description: "App com React. Requer npm install e npm run dev para ver ao vivo.",
    icon: <Atom className="w-5 h-5" />,
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  },
  {
    id: "blank",
    label: "Projeto em Branco",
    description: "Só um README.md. Para começar do zero ou importar código.",
    icon: <FileText className="w-5 h-5" />,
    color: "text-gray-400 bg-gray-400/10 border-gray-400/30",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState("html");
  const [isCreatingBlank, setIsCreatingBlank] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });

  const uploadMutation = useUploadProject({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Projeto enviado com sucesso" });
        setLocation(`/projects/${data.id}`);
      },
      onError: (error) => {
        toast({
          title: "Falha no upload",
          description: error.message || "Arquivo muito grande ou ZIP inválido",
          variant: "destructive",
        });
      },
    },
  });

  const importGithubMutation = useImportFromGithub({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: `Repositório "${data.name}" importado com sucesso` });
        setGithubDialogOpen(false);
        setRepoUrl("");
        setBranch("");
        setLocation(`/projects/${data.id}`);
      },
      onError: (error) => {
        toast({
          title: "Falha ao importar",
          description: error.message || "Erro desconhecido",
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Projeto excluído" });
        setDeleteTarget(null);
      },
      onError: () => {
        toast({ title: "Erro ao excluir projeto", variant: "destructive" });
        setDeleteTarget(null);
      },
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.endsWith(".zip")) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Por favor, envie um arquivo .zip",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    const maxSize = 250 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        title: "Arquivo muito grande",
        description: `ZIP não pode exceder 250MB (seu arquivo tem ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    uploadMutation.mutate({ data: { file, name: file.name.replace(".zip", "") } });
    e.target.value = "";
  };

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget({ id, name });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ projectId: deleteTarget.id });
  };

  const handleGithubImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    importGithubMutation.mutate({
      data: { repoUrl: repoUrl.trim(), branch: branch.trim() || null },
    });
  };

  const handleCreateBlank = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProjectName.trim() || "Novo Projeto";
    setIsCreatingBlank(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const resp = await fetch(`${base}/api/projects/blank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, template: newProjectTemplate }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao criar projeto");
      }
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: `Projeto "${data.name}" criado com sucesso` });
      setNewProjectDialogOpen(false);
      setNewProjectName("");
      setNewProjectTemplate("blank");
      setLocation(`/projects/${data.id}`);
    } catch (err: any) {
      toast({ title: "Erro ao criar projeto", description: err.message, variant: "destructive" });
    } finally {
      setIsCreatingBlank(false);
    }
  };

  const isUploading = uploadMutation.isPending || importGithubMutation.isPending;

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8 pb-12">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Workspace
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Selecione um projeto ou adicione um novo
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                id="zip-file-input"
                type="file"
                accept=".zip"
                className="sr-only"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
              <Button
                variant="outline"
                onClick={() => setGithubDialogOpen(true)}
                disabled={isUploading}
                className="gap-2"
              >
                <Github className="w-4 h-4" />
                <span className="hidden sm:inline">Importar do GitHub</span>
                <span className="sm:hidden">GitHub</span>
              </Button>
              {uploadMutation.isPending ? (
                <Button variant="outline" disabled className="gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Upload ZIP
                </Button>
              ) : (
                <Button variant="outline" className="gap-2" asChild>
                  <label htmlFor="zip-file-input" className="cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Upload ZIP
                  </label>
                </Button>
              )}
              <Button
                onClick={() => setNewProjectDialogOpen(true)}
                disabled={isUploading}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Novo Projeto
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-lg border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <div className="group relative flex flex-col h-full rounded-lg border border-border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          {project.name.includes("/") ? (
                            <Github className="w-5 h-5" />
                          ) : (
                            <FolderArchive className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3
                            className="font-medium text-foreground truncate max-w-[160px]"
                            title={project.name}
                          >
                            {project.name.includes("/") ? project.name.split("/")[1] : project.name}
                          </h3>
                          {project.name.includes("/") && (
                            <p className="text-xs text-muted-foreground truncate">
                              {project.name.split("/")[0]}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={(e) => handleDelete(e, project.id, project.name)}
                        disabled={deleteMutation.isPending}
                        title="Excluir projeto"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="mt-auto grid grid-cols-2 gap-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {format(new Date(project.createdAt), "dd/MM/yyyy")}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5" />
                        {formatBytes(project.sizeBytes)}
                      </div>
                      <div className="flex items-center gap-1.5 col-span-2">
                        <FileCode2 className="w-3.5 h-3.5" />
                        {project.fileCount} arquivos
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border rounded-xl bg-card/50">
              <FolderArchive className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">Nenhum projeto ainda</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                Crie um novo projeto, envie um ZIP ou importe do GitHub.
              </p>
              <div className="flex gap-2 flex-wrap justify-center">
                <Button onClick={() => setNewProjectDialogOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Novo Projeto
                </Button>
                <Button onClick={() => setGithubDialogOpen(true)} variant="outline" className="gap-2">
                  <Github className="w-4 h-4" />
                  GitHub
                </Button>
                <Button variant="outline" className="gap-2" asChild>
                  <label htmlFor="zip-file-input" className="cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Upload ZIP
                  </label>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Novo Projeto Dialog ─────────────────────────────────────────────── */}
      <Dialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Novo Projeto
            </DialogTitle>
            <DialogDescription>
              O template <strong>HTML + CSS + JS</strong> abre o preview na hora — ideal para começar.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBlank}>
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label htmlFor="projectName">Nome do projeto</Label>
                <Input
                  id="projectName"
                  placeholder="Meu Projeto"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  disabled={isCreatingBlank}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label>Template</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNewProjectTemplate(t.id)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                        newProjectTemplate === t.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-border/80 hover:bg-accent/30"
                      )}
                    >
                      <div className={cn("p-1.5 rounded shrink-0 mt-0.5", t.color)}>
                        {t.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{t.label}</p>
                          {t.id === "html" && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 whitespace-nowrap">
                              👁 PREVIEW IMEDIATO
                            </span>
                          )}
                          {t.id === "node" && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 whitespace-nowrap">
                              🟢 AO VIVO (1 clique)
                            </span>
                          )}
                          {t.id === "express" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 whitespace-nowrap">
                              npm install primeiro
                            </span>
                          )}
                          {t.id === "react" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 whitespace-nowrap">
                              npm install primeiro
                            </span>
                          )}
                          {t.id === "blank" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/20 whitespace-nowrap">
                              sem preview
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewProjectDialogOpen(false)}
                disabled={isCreatingBlank}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isCreatingBlank} className="gap-2">
                {isCreatingBlank ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Criar Projeto
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── GitHub Import Dialog ───────────────────────────────────────────── */}
      <Dialog open={githubDialogOpen} onOpenChange={setGithubDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" />
              Importar do GitHub
            </DialogTitle>
            <DialogDescription>
              Cole a URL de um repositório público, ou privado se seu token GitHub estiver configurado
              em Configurações.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGithubImport}>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="repoUrl">URL do Repositório</Label>
                <Input
                  id="repoUrl"
                  placeholder="https://github.com/usuario/repositorio"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={importGithubMutation.isPending}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch">
                  Branch{" "}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Input
                  id="branch"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={importGithubMutation.isPending}
                />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGithubDialogOpen(false)}
                disabled={importGithubMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!repoUrl.trim() || importGithubMutation.isPending}
                className="gap-2"
              >
                {importGithubMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Github className="w-4 h-4" />
                    Importar
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto <strong>"{deleteTarget?.name}"</strong> e todos os seus arquivos serão
              excluídos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
