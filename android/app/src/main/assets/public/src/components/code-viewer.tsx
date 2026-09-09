import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import {
  Loader2,
  FileX,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Save,
  X,
} from "lucide-react";
import type { FileContent } from "@/lib-api-client";
import { useWriteFile, getGetProjectQueryKey } from "@/lib-api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";

interface CodeViewerProps {
  file: FileContent | undefined;
  isLoading: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  /** Called when user clicks "Visualizar" on an HTML/SVG file */
  onPreview?: (filePath: string) => void;
  /** Project ID – enables inline editing + save */
  projectId?: string;
}

const PREVIEWABLE_EXTS = new Set(["html", "htm", "svg"]);

// Map our language names to highlight.js aliases
const LANG_MAP: Record<string, string> = {
  typescript: "typescript",
  tsx: "typescript",
  javascript: "javascript",
  jsx: "javascript",
  python: "python",
  rust: "rust",
  go: "go",
  java: "java",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  json: "json",
  yaml: "yaml",
  markdown: "markdown",
  md: "markdown",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  php: "php",
  ruby: "ruby",
  cpp: "cpp",
  c: "c",
  csharp: "csharp",
  swift: "swift",
  kotlin: "kotlin",
  dart: "dart",
  toml: "ini",
  dockerfile: "dockerfile",
};

export function CodeViewer({
  file,
  isLoading,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onPreview,
  projectId,
}: CodeViewerProps) {
  const ext = file?.path?.split(".").pop()?.toLowerCase() ?? "";
  const isPreviewable = PREVIEWABLE_EXTS.has(ext);
  const canEdit = !!projectId && !!file && !file.isBinary;

  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const writeMutation = useWriteFile();

  // Enter edit mode — copy current content
  const enterEdit = useCallback(() => {
    setEditContent(file?.content ?? "");
    setEditMode(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [file?.content]);

  // Exit edit mode without saving
  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditContent("");
  }, []);

  // Save
  const saveFile = useCallback(async () => {
    if (!file || !projectId) return;
    setSaving(true);
    try {
      await writeMutation.mutateAsync({
        projectId,
        data: { path: file.path, content: editContent },
      });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files`] });
      setEditMode(false);
      toast({ title: "Arquivo salvo com sucesso" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      toast({ title: "Erro ao salvar", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [file, projectId, editContent, writeMutation, queryClient, toast]);

  // Ctrl+S saves; Esc cancels
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      if (e.key === "Escape") cancelEdit();
    },
    [saveFile, cancelEdit]
  );

  // Exit edit mode when a different file opens
  useEffect(() => {
    setEditMode(false);
    setEditContent("");
  }, [file?.path]);

  const { highlighted, lineCount } = useMemo(() => {
    if (!file?.content) return { highlighted: "", lineCount: 0 };
    const lang = file.language ? LANG_MAP[file.language.toLowerCase()] : undefined;
    try {
      const result =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(file.content, { language: lang })
          : hljs.highlightAuto(file.content);
      return {
        highlighted: result.value,
        lineCount: (file.content.match(/\n/g)?.length ?? 0) + 1,
      };
    } catch {
      return {
        highlighted: file.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        lineCount: (file.content.match(/\n/g)?.length ?? 0) + 1,
      };
    }
  }, [file?.content, file?.language]);

  const editLineCount = useMemo(
    () => (editContent.match(/\n/g)?.length ?? 0) + 1,
    [editContent]
  );

  const lineNumbers = useMemo(
    () => Array.from({ length: editMode ? editLineCount : lineCount }, (_, i) => i + 1),
    [editMode, editLineCount, lineCount]
  );

  const displayLineCount = editMode ? editLineCount : lineCount;
  const lineNumWidth = Math.max(String(displayLineCount).length, 2);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#0d1117]">
        <Loader2 className="w-6 h-6 animate-spin text-[#8b949e]" />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0d1117] text-[#8b949e]">
        <FileX className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-sm">Selecione um arquivo para ver o conteúdo</p>
      </div>
    );
  }

  if (file.isBinary) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0d1117] text-[#8b949e]">
        <FileX className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-sm">Arquivo binário não pode ser exibido</p>
        <p className="text-xs opacity-70 mt-1 font-mono">{file.path}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#0d1117] overflow-hidden">
      {/* Tab bar */}
      <div className="h-10 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-2 gap-1">
        {/* Back / Forward */}
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Arquivo anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onForward}
          disabled={!canGoForward}
          className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Próximo arquivo"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-[#30363d] mx-1 shrink-0" />

        <span className="text-sm text-[#c9d1d9] font-mono truncate flex-1">
          {file.path.split("/").pop()}
          {editMode && (
            <span className="ml-1.5 text-[10px] text-yellow-400 font-medium">• editando</span>
          )}
        </span>
        <span className="text-[10px] text-[#8b949e] truncate hidden md:block max-w-[200px]">
          {file.path}
        </span>

        <div className="w-px h-5 bg-[#30363d] mx-1 shrink-0" />

        {/* Visualizar button for HTML/SVG files */}
        {isPreviewable && onPreview && !editMode && (
          <button
            onClick={() => onPreview(file.path)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/30 transition-colors shrink-0"
            title="Visualizar este arquivo no painel de Preview"
          >
            <Eye className="w-3 h-3" />
            Visualizar
          </button>
        )}

        {/* Edit / Save / Cancel buttons */}
        {canEdit && !editMode && (
          <button
            onClick={enterEdit}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3] border border-[#444d56] transition-colors shrink-0"
            title="Editar arquivo (duplo clique no código também funciona)"
          >
            <Pencil className="w-3 h-3" />
            Editar
          </button>
        )}

        {editMode && (
          <>
            <button
              onClick={saveFile}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-colors shrink-0"
              title="Salvar (Ctrl+S)"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              Salvar
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#30363d] text-[#8b949e] hover:text-[#e6edf3] border border-[#444d56] transition-colors shrink-0"
              title="Cancelar edição (Esc)"
            >
              <X className="w-3 h-3" />
              Cancelar
            </button>
          </>
        )}

        {file.language && !editMode && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[#8b949e] shrink-0">
            {file.language}
          </span>
        )}
        <span className="text-[10px] text-[#8b949e] shrink-0 tabular-nums ml-2">
          {displayLineCount} ln
        </span>
      </div>

      {/* Code / Editor area */}
      <div className="flex-1 overflow-auto flex" onDoubleClick={canEdit && !editMode ? enterEdit : undefined}>
        {/* Line numbers column */}
        <div
          className="select-none text-right text-[#8b949e] text-[12px] font-mono leading-relaxed pt-3 pb-3 pr-3 pl-4 border-r border-[#30363d] shrink-0"
          style={{ minWidth: `${lineNumWidth + 3}ch` }}
          aria-hidden="true"
        >
          {lineNumbers.map((n) => (
            <div key={n} className="leading-relaxed hover:text-[#c9d1d9]">
              {n}
            </div>
          ))}
        </div>

        {editMode ? (
          /* Edit mode — textarea */
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 pl-4 pr-6 pt-3 pb-3 text-sm font-mono leading-relaxed bg-transparent text-[#e6edf3] outline-none resize-none caret-white selection:bg-blue-500/40"
            style={{ tabSize: 2, lineHeight: "1.625" }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        ) : (
          /* View mode — highlighted */
          <pre
            className="flex-1 pl-4 pr-6 pt-3 pb-3 text-sm font-mono leading-relaxed overflow-x-auto m-0 bg-transparent"
            style={{ tabSize: 2 }}
          >
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}
