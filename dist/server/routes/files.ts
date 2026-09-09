import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "../../lib/db/index.js";
import { GetFileContentQueryParams, WriteFileBody, DeleteFileQueryParams } from "../../lib/api-zod/index.js";
import { detectLanguage, isBinaryFile } from "../lib/storage.js";
import { dbSaveFile, dbDeleteFile, ensureProjectOnDisk } from "../lib/persistFiles.js";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveProjectPath(
  projectId: string,
  filePath: string
): Promise<{ projectDbId: number; storagePath: string; fullPath: string } | null> {
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return null;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return null;
  // Restore from DB if /tmp directory was wiped
  await ensureProjectOnDisk(project.id, project.storagePath);
  const normalized = filePath.replace(/^\/+/, "");
  const fullPath = path.join(project.storagePath, normalized);
  const resolved = path.resolve(fullPath);
  const base = path.resolve(project.storagePath);
  if (!resolved.startsWith(base)) return null;
  return { projectDbId: project.id, storagePath: project.storagePath, fullPath };
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    await Promise.all(entries.map((e) => copyRecursive(path.join(src, e), path.join(dest, e))));
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

// ─── GET — read file content ──────────────────────────────────────────────────

router.get("/projects/:projectId/files", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const queryParsed = GetFileContentQueryParams.safeParse(req.query);
  if (!queryParsed.success) { res.status(400).json({ error: queryParsed.error.message }); return; }

  const filePath = queryParsed.data.path;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const normalizedPath = filePath.replace(/^\//, "");
  const fullPath = path.join(project.storagePath, normalizedPath);
  const resolved = path.resolve(fullPath);
  const base = path.resolve(project.storagePath);
  if (!resolved.startsWith(base)) { res.status(400).json({ error: "Invalid path" }); return; }

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) { res.status(400).json({ error: "Path is not a file" }); return; }
  } catch { res.status(404).json({ error: "File not found" }); return; }

  const binary = isBinaryFile(filePath);
  const language = detectLanguage(filePath);

  if (binary) {
    res.json({ path: filePath, content: "[Binary file - content not available]", language: "plaintext", isBinary: true });
    return;
  }

  try {
    const buffer = await fs.readFile(fullPath);
    res.json({ path: filePath, content: buffer.toString("utf-8"), language, isBinary: false });
  } catch { res.status(500).json({ error: "Could not read file" }); }
});

// ─── PUT — write / create file ────────────────────────────────────────────────

router.put("/projects/:projectId/files", async (req, res): Promise<void> => {
  const parsed = WriteFileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { path: filePath, content } = parsed.data;
  const resolved = await resolveProjectPath(req.params.projectId, filePath);
  if (!resolved) { res.status(400).json({ error: "Invalid project or path" }); return; }

  await fs.mkdir(path.dirname(resolved.fullPath), { recursive: true });
  await fs.writeFile(resolved.fullPath, content, "utf-8");
  // Persist to DB so file survives server restarts
  await dbSaveFile(resolved.projectDbId, filePath, content);
  res.json({ path: filePath, message: "Arquivo salvo com sucesso" });
});

// ─── DELETE — delete file OR folder ──────────────────────────────────────────

router.delete("/projects/:projectId/files", async (req, res): Promise<void> => {
  const queryParsed = DeleteFileQueryParams.safeParse(req.query);
  if (!queryParsed.success) { res.status(400).json({ error: queryParsed.error.message }); return; }

  const resolved = await resolveProjectPath(req.params.projectId, queryParsed.data.path);
  if (!resolved) { res.status(400).json({ error: "Invalid project or path" }); return; }

  try {
    const stat = await fs.stat(resolved.fullPath);
    if (stat.isDirectory()) {
      await fs.rm(resolved.fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(resolved.fullPath);
    }
    // Remove from DB too
    await dbDeleteFile(resolved.projectDbId, queryParsed.data.path);
    res.status(204).send();
  } catch { res.status(404).json({ error: "Arquivo ou pasta não encontrado" }); }
});

// ─── POST /mkdir — create folder ─────────────────────────────────────────────

const MkdirBody = z.object({ path: z.string().min(1) });

router.post("/projects/:projectId/files/mkdir", async (req, res): Promise<void> => {
  const parsed = MkdirBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Campo 'path' é obrigatório" }); return; }

  const resolved = await resolveProjectPath(req.params.projectId, parsed.data.path);
  if (!resolved) { res.status(400).json({ error: "Invalid project or path" }); return; }

  await fs.mkdir(resolved.fullPath, { recursive: true });
  res.json({ path: parsed.data.path, message: "Pasta criada com sucesso" });
});

// ─── PATCH /rename — rename or move file/folder ───────────────────────────────

const RenameBody = z.object({ from: z.string().min(1), to: z.string().min(1) });

router.patch("/projects/:projectId/files", async (req, res): Promise<void> => {
  const parsed = RenameBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Campos 'from' e 'to' são obrigatórios" }); return; }

  const src = await resolveProjectPath(req.params.projectId, parsed.data.from);
  const dest = await resolveProjectPath(req.params.projectId, parsed.data.to);
  if (!src || !dest) { res.status(400).json({ error: "Invalid project or path" }); return; }

  try {
    await fs.stat(src.fullPath);
  } catch { res.status(404).json({ error: "Origem não encontrada" }); return; }

  await fs.mkdir(path.dirname(dest.fullPath), { recursive: true });
  await fs.rename(src.fullPath, dest.fullPath);
  res.json({ from: parsed.data.from, to: parsed.data.to, message: "Renomeado com sucesso" });
});

// ─── POST /copy — copy file or folder ────────────────────────────────────────

const CopyBody = z.object({ from: z.string().min(1), to: z.string().min(1) });

router.post("/projects/:projectId/files/copy", async (req, res): Promise<void> => {
  const parsed = CopyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Campos 'from' e 'to' são obrigatórios" }); return; }

  const src = await resolveProjectPath(req.params.projectId, parsed.data.from);
  const dest = await resolveProjectPath(req.params.projectId, parsed.data.to);
  if (!src || !dest) { res.status(400).json({ error: "Invalid project or path" }); return; }

  try {
    await fs.stat(src.fullPath);
  } catch { res.status(404).json({ error: "Origem não encontrada" }); return; }

  try {
    await copyRecursive(src.fullPath, dest.fullPath);
    res.json({ from: parsed.data.from, to: parsed.data.to, message: "Copiado com sucesso" });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Erro ao copiar" });
  }
});

export default router;
