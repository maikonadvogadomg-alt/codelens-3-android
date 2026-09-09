import React, { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Save, Plus, Trash2, Play, Code2, Eye, Download, FileCode2 } from "lucide-react";

interface PlaygroundSave {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface PlaygroundSaveFull extends PlaygroundSave {
  html: string;
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playground</title>
  <style>
    body {
      font-family: sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0d1117;
      color: #e6edf3;
    }
    h1 { color: #58a6ff; }
  </style>
</head>
<body>
  <div style="text-align:center">
    <h1>🚀 HTML Playground</h1>
    <p>Edite este código e veja o resultado ao vivo!</p>
  </div>
</body>
</html>`;

export default function PlaygroundPage() {
  const [code, setCode] = useState(DEFAULT_HTML);
  const [preview, setPreview] = useState(DEFAULT_HTML);
  const [autoRun, setAutoRun] = useState(true);
  const [title, setTitle] = useState("Sem título");
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [saves, setSaves] = useState<PlaygroundSave[]>([]);
  const [showSaves, setShowSaves] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const autoRunTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadSaves();
  }, []);

  useEffect(() => {
    if (!autoRun) return;
    if (autoRunTimer.current) clearTimeout(autoRunTimer.current);
    autoRunTimer.current = setTimeout(() => setPreview(code), 600);
    return () => { if (autoRunTimer.current) clearTimeout(autoRunTimer.current); };
  }, [code, autoRun]);

  async function loadSaves() {
    try {
      const r = await fetch("/api/playground");
      const data = await r.json();
      setSaves(data);
    } catch {}
  }

  async function handleSave() {
    setLoading(true);
    try {
      if (currentId) {
        await fetch(`/api/playground/${currentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, html: code }),
        });
        toast({ title: "Salvo!", description: "Playground atualizado." });
      } else {
        const r = await fetch("/api/playground", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, html: code }),
        });
        const data = await r.json();
        setCurrentId(data.id);
        toast({ title: "Salvo!", description: "Playground salvo com sucesso." });
      }
      await loadSaves();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
    setLoading(false);
  }

  async function handleLoad(id: number) {
    try {
      const r = await fetch(`/api/playground/${id}`);
      const data: PlaygroundSaveFull = await r.json();
      setCode(data.html);
      setPreview(data.html);
      setTitle(data.title);
      setCurrentId(data.id);
      setShowSaves(false);
    } catch {
      toast({ title: "Erro ao carregar", variant: "destructive" });
    }
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/playground/${id}`, { method: "DELETE" });
    if (currentId === id) handleNew();
    await loadSaves();
    toast({ title: "Deletado" });
  }

  function handleNew() {
    setCode(DEFAULT_HTML);
    setPreview(DEFAULT_HTML);
    setTitle("Sem título");
    setCurrentId(null);
  }

  function handleDownload() {
    const blob = new Blob([code], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-sidebar">
          <FileCode2 className="w-4 h-4 text-primary shrink-0" />
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="h-7 text-sm max-w-[200px] bg-background"
            placeholder="Nome do arquivo..."
          />
          <div className="flex items-center gap-1 ml-auto">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setPreview(code)}>
              <Play className="w-3 h-3" /> Executar
            </Button>
            <Button
              size="sm"
              variant={autoRun ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setAutoRun(v => !v)}
            >
              {autoRun ? "Auto ✓" : "Auto"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleDownload}>
              <Download className="w-3 h-3" /> .html
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowSaves(v => !v)}>
              <Eye className="w-3 h-3" /> Saves ({saves.length})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleNew}>
              <Plus className="w-3 h-3" /> Novo
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={loading}>
              <Save className="w-3 h-3" /> Salvar
            </Button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Saves sidebar */}
          {showSaves && (
            <div className="w-56 shrink-0 border-r border-border bg-sidebar flex flex-col">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                Arquivos salvos
              </div>
              <div className="flex-1 overflow-y-auto">
                {saves.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3">Nenhum arquivo salvo ainda.</p>
                )}
                {saves.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleLoad(s.id)}
                    className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent text-sm group ${currentId === s.id ? "bg-accent text-foreground" : "text-muted-foreground"}`}
                  >
                    <span className="truncate flex-1">{s.title}</span>
                    <button
                      onClick={e => handleDelete(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-destructive ml-1 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border flex items-center gap-1">
              <Code2 className="w-3 h-3" /> Editor HTML
            </div>
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-background text-foreground text-xs font-mono p-3 focus:outline-none"
              placeholder="Digite seu código HTML aqui..."
            />
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border flex items-center gap-1">
              <Eye className="w-3 h-3" /> Preview
            </div>
            <iframe
              srcDoc={preview}
              className="flex-1 w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              title="preview"
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
