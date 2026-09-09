import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetProjectQueryKey } from "@/lib-api-client";

async function apiFetch(url: string, opts: RequestInit) {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const res = await fetch(`${base}/api${url}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export interface FileOp {
  type: "copy" | "cut";
  path: string;
  name: string;
}

export function useFileOps(projectId: string) {
  const qc = useQueryClient();
  const [clipboard, setClipboard] = useState<FileOp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
  }, [qc, projectId]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e: any) {
      setError(e.message ?? "Erro desconhecido");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const createFile = useCallback((filePath: string, content = "") =>
    run(() => apiFetch(`/projects/${projectId}/files`, {
      method: "PUT",
      body: JSON.stringify({ path: filePath, content }),
    })), [projectId, run]);

  const createFolder = useCallback((folderPath: string) =>
    run(() => apiFetch(`/projects/${projectId}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path: folderPath }),
    })), [projectId, run]);

  const renameItem = useCallback((from: string, to: string) =>
    run(() => apiFetch(`/projects/${projectId}/files`, {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    })), [projectId, run]);

  const deleteItem = useCallback((itemPath: string) =>
    run(() => apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(itemPath)}`, {
      method: "DELETE",
    })), [projectId, run]);

  const copyItemTo = useCallback((from: string, to: string) =>
    run(() => apiFetch(`/projects/${projectId}/files/copy`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    })), [projectId, run]);

  const copyToClipboard = useCallback((path: string, name: string) => {
    setClipboard({ type: "copy", path, name });
  }, []);

  const cutToClipboard = useCallback((path: string, name: string) => {
    setClipboard({ type: "cut", path, name });
  }, []);

  const pasteInto = useCallback(async (targetFolder: string) => {
    if (!clipboard) return;
    const destName = clipboard.name;
    const dest = targetFolder === "." ? destName : `${targetFolder}/${destName}`;
    if (clipboard.type === "copy") {
      await copyItemTo(clipboard.path, dest);
    } else {
      await renameItem(clipboard.path, dest);
      setClipboard(null);
    }
  }, [clipboard, copyItemTo, renameItem]);

  return {
    clipboard,
    busy,
    error,
    clearError: () => setError(null),
    createFile,
    createFolder,
    renameItem,
    deleteItem,
    copyToClipboard,
    cutToClipboard,
    pasteInto,
  };
}
