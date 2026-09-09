import React, { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Folder,
  FolderOpen,
  FileText,
  Sparkles,
  Image as ImageIcon,
  FilePlus,
  FolderPlus,
  Pencil,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib-api-client";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import type { FileOp } from "@/hooks/use-file-ops";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileOps {
  clipboard: FileOp | null;
  createFile: (path: string, content?: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renameItem: (from: string, to: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  copyToClipboard: (path: string, name: string) => void;
  cutToClipboard: (path: string, name: string) => void;
  pasteInto: (targetFolder: string) => Promise<void>;
}

export interface FileTreeProps {
  node: FileNode;
  onSelectFile: (path: string) => void;
  onAnalyzeFile: (path: string) => void;
  onAnalyzeFolder: (path: string) => void;
  selectedPath?: string;
  level?: number;
  ops: FileOps;
}

type MenuAction = { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean } | "sep";

// ─── Inline input (rename / new item) ────────────────────────────────────────

function InlineInput({ initial, onConfirm, onCancel }: {
  initial: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const dot = initial.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); if (val.trim()) onConfirm(val.trim()); }
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => { if (val.trim()) onConfirm(val.trim()); else onCancel(); }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 bg-[#1f2937] border border-primary/50 rounded px-1.5 py-0.5 text-sm text-foreground outline-none min-w-0"
    />
  );
}

// ─── File icon helper ─────────────────────────────────────────────────────────

function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) return <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" />;
  if (lower.match(/\.(ts|tsx)$/)) return <FileCode className="w-4 h-4 text-blue-400 shrink-0" />;
  if (lower.match(/\.(js|jsx|mjs|cjs)$/)) return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
  if (lower.match(/\.(css|scss|sass|less)$/)) return <FileCode className="w-4 h-4 text-pink-400 shrink-0" />;
  if (lower.match(/\.(html|htm)$/)) return <FileCode className="w-4 h-4 text-orange-400 shrink-0" />;
  if (lower.match(/\.py$/)) return <FileCode className="w-4 h-4 text-green-400 shrink-0" />;
  if (lower.match(/\.rs$/)) return <FileCode className="w-4 h-4 text-orange-500 shrink-0" />;
  if (lower.match(/\.go$/)) return <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />;
  return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
}

// ─── Menu renderers ───────────────────────────────────────────────────────────

function ContextMenuItems({ actions }: { actions: MenuAction[] }) {
  return (
    <>
      {actions.map((a, i) =>
        a === "sep" ? (
          <ContextMenuSeparator key={`sep-${i}`} />
        ) : (
          <ContextMenuItem
            key={a.label}
            onClick={a.onClick}
            className={cn("gap-2 cursor-pointer text-sm", a.danger && "text-destructive focus:text-destructive")}
          >
            {a.icon}
            <span>{a.label}</span>
          </ContextMenuItem>
        )
      )}
    </>
  );
}

function DropdownMenuItems({ actions }: { actions: MenuAction[] }) {
  return (
    <>
      {actions.map((a, i) =>
        a === "sep" ? (
          <DropdownMenuSeparator key={`sep-${i}`} />
        ) : (
          <DropdownMenuItem
            key={a.label}
            onClick={(e) => { e.stopPropagation(); a.onClick(); }}
            className={cn("gap-2 cursor-pointer text-sm", a.danger && "text-destructive focus:text-destructive")}
          >
            {a.icon}
            <span>{a.label}</span>
          </DropdownMenuItem>
        )
      )}
    </>
  );
}

// ─── Main FileTree node ───────────────────────────────────────────────────────

export function FileTree({
  node,
  onSelectFile,
  onAnalyzeFile,
  onAnalyzeFolder,
  selectedPath,
  level = 0,
  ops,
}: FileTreeProps) {
  const [isOpen, setIsOpen] = useState(level === 0);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const isMobile = useIsMobile();
  const isDirectory = node.type === "directory";
  const isSelected = selectedPath === node.path;

  const sortedChildren = React.useMemo(() => {
    if (!node.children) return [];
    return [...node.children].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [node.children]);

  // ── helpers ──────────────────────────────────────────────────────────────────

  const parentPath = () => {
    const parts = node.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  };

  const handleNewFile = () => { if (isDirectory) setIsOpen(true); setCreating("file"); };
  const handleNewFolder = () => { if (isDirectory) setIsOpen(true); setCreating("folder"); };

  const confirmCreate = async (name: string) => {
    const base = isDirectory ? node.path : parentPath();
    const newPath = base === "." ? name : `${base}/${name}`;
    if (creating === "file") await ops.createFile(newPath, "");
    else await ops.createFolder(newPath);
    setCreating(null);
  };

  const confirmRename = async (newName: string) => {
    const parent = parentPath();
    const newPath = parent === "." ? newName : `${parent}/${newName}`;
    await ops.renameItem(node.path, newPath);
    setRenaming(false);
  };

  const handleDelete = async () => {
    const label = isDirectory ? "pasta" : "arquivo";
    if (!confirm(`Excluir ${label} "${node.name}"?\n\nEsta ação não pode ser desfeita.`)) return;
    await ops.deleteItem(node.path);
  };

  const pasteTarget = () => isDirectory ? node.path : parentPath();

  // ── menu actions (data) ──────────────────────────────────────────────────────

  const actions: MenuAction[] = [
    ...(isDirectory ? [
      { label: "Novo Arquivo", icon: <FilePlus className="w-3.5 h-3.5" />, onClick: handleNewFile },
      { label: "Nova Pasta", icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: handleNewFolder },
      "sep" as const,
    ] : []),
    {
      label: isDirectory ? "Analisar Pasta" : "Analisar com IA",
      icon: <Sparkles className="w-3.5 h-3.5 text-primary" />,
      onClick: () => isDirectory ? onAnalyzeFolder(node.path) : onAnalyzeFile(node.path),
    },
    "sep" as const,
    { label: "Renomear", icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setRenaming(true) },
    { label: "Copiar", icon: <Copy className="w-3.5 h-3.5" />, onClick: () => ops.copyToClipboard(node.path, node.name) },
    { label: "Recortar", icon: <Scissors className="w-3.5 h-3.5" />, onClick: () => ops.cutToClipboard(node.path, node.name) },
    ...(ops.clipboard ? [{
      label: `Colar "${ops.clipboard.name}"`,
      icon: <ClipboardPaste className="w-3.5 h-3.5" />,
      onClick: () => ops.pasteInto(pasteTarget()),
    }] : []),
    "sep" as const,
    { label: "Excluir", icon: <Trash2 className="w-3.5 h-3.5" />, onClick: handleDelete, danger: true },
  ];

  // ── row ───────────────────────────────────────────────────────────────────────

  const indent = level * 14 + 8;

  const row = (
    <div
      className={cn(
        "flex items-center gap-1 py-1.5 pr-1 hover:bg-accent/50 cursor-pointer rounded-sm text-sm group relative",
        isSelected && "bg-accent text-accent-foreground",
        !isSelected && "text-muted-foreground",
        isMobile && "py-2.5"
      )}
      style={{ paddingLeft: `${indent}px` }}
      onClick={(e) => {
        e.stopPropagation();
        if (renaming) return;
        if (isDirectory) setIsOpen((v) => !v);
        else onSelectFile(node.path);
      }}
    >
      {isDirectory ? (
        <span className="flex items-center gap-1 flex-1 overflow-hidden min-w-0">
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 opacity-70 shrink-0" />}
          {isOpen ? <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" /> : <Folder className="w-4 h-4 text-blue-400 shrink-0" />}
          {renaming ? (
            <InlineInput initial={node.name} onConfirm={confirmRename} onCancel={() => setRenaming(false)} />
          ) : (
            <span className="truncate font-medium">{node.name}</span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 flex-1 overflow-hidden min-w-0 ml-5">
          <FileIcon name={node.name} />
          {renaming ? (
            <InlineInput initial={node.name} onConfirm={confirmRename} onCancel={() => setRenaming(false)} />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </span>
      )}

      {/* Hover action buttons (desktop) */}
      {!renaming && !isMobile && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
          {isDirectory && (
            <>
              <SmallBtn title="Novo arquivo" onClick={(e) => { e.stopPropagation(); handleNewFile(); }}>
                <FilePlus className="w-3 h-3" />
              </SmallBtn>
              <SmallBtn title="Nova pasta" onClick={(e) => { e.stopPropagation(); handleNewFolder(); }}>
                <FolderPlus className="w-3 h-3" />
              </SmallBtn>
            </>
          )}
          <SmallBtn title={isDirectory ? "Analisar pasta" : "Analisar com IA"} onClick={(e) => {
            e.stopPropagation();
            isDirectory ? onAnalyzeFolder(node.path) : onAnalyzeFile(node.path);
          }}>
            <Sparkles className="w-3 h-3 text-primary" />
          </SmallBtn>
        </div>
      )}

      {/* Mobile: ⋮ dropdown */}
      {!renaming && isMobile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 ml-1 p-1.5 rounded text-muted-foreground active:bg-accent"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItems actions={actions} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  // ── new-item inline input ────────────────────────────────────────────────────

  const newItemInput = creating && (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: `${indent + 14 + 4 + 16 + 6}px` }}
    >
      {creating === "file"
        ? <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        : <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
      <InlineInput
        initial=""
        onConfirm={confirmCreate}
        onCancel={() => setCreating(null)}
      />
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────────

  const children = isDirectory && isOpen && (
    <div className="flex flex-col">
      {newItemInput}
      {sortedChildren.map((child) => (
        <FileTree key={child.path} node={child} onSelectFile={onSelectFile}
          onAnalyzeFile={onAnalyzeFile} onAnalyzeFolder={onAnalyzeFolder}
          selectedPath={selectedPath} level={level + 1} ops={ops} />
      ))}
    </div>
  );

  if (isMobile) {
    return <div className="select-none">{row}{children}</div>;
  }

  return (
    <div className="select-none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{row}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
      {children}
    </div>
  );
}

// ─── Small button ─────────────────────────────────────────────────────────────

function SmallBtn({ title, onClick, children }: {
  title: string;
  onClick: React.MouseEventHandler;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}
