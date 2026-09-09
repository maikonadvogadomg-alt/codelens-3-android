import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, settingsTable } from "../../lib/db/index.js";
import { CreateGithubRepoBody } from "../../lib/api-zod/index.js";
import { isBinaryFile } from "../lib/storage.js";
import { Octokit } from "@octokit/rest";
import path from "path";
import fs from "fs/promises";

const router: IRouter = Router();

interface FileToCommit {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
}

async function collectAllFiles(dir: string, prefix: string, files: FileToCommit[]): Promise<void> {
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const fullPath = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await collectAllFiles(fullPath, rel, files);
    } else {
      const binary = isBinaryFile(entry);
      if (binary) {
        const buf = await fs.readFile(fullPath);
        files.push({ path: rel, content: buf.toString("base64"), encoding: "base64" });
      } else {
        try {
          const buf = await fs.readFile(fullPath);
          files.push({ path: rel, content: buf.toString("utf-8"), encoding: "utf-8" });
        } catch {
          const buf = await fs.readFile(fullPath);
          files.push({ path: rel, content: buf.toString("base64"), encoding: "base64" });
        }
      }
    }
  }
}

router.post("/github/create-repo", async (req, res): Promise<void> => {
  const parsed = CreateGithubRepoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, repoName, description, isPrivate } = parsed.data;

  const id = parseInt(projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const settingsRows = await db.select().from(settingsTable).limit(1);
  const settings = settingsRows[0];

  if (!settings?.githubToken) {
    res.status(400).json({ error: "GitHub token not configured. Please go to Settings." });
    return;
  }

  const octokit = new Octokit({ auth: settings.githubToken });

  try {
    // Verify token first
    let user: { login: string };
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      user = data;
    } catch (authErr: any) {
      const status = authErr?.status ?? 0;
      if (status === 401 || status === 403) {
        res.status(400).json({ error: "Token GitHub inválido ou sem permissão. Verifique o token em Configurações." });
      } else {
        res.status(400).json({ error: "Não foi possível autenticar no GitHub. Verifique sua conexão e o token." });
      }
      return;
    }

    let repo: { html_url: string; full_name: string };
    try {
      const { data } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: description ?? undefined,
        private: isPrivate,
        auto_init: false,
      });
      repo = data;
    } catch (createErr: any) {
      const status = createErr?.status ?? 0;
      if (status === 422) {
        res.status(400).json({ error: `Repositório "${repoName}" já existe na conta ${user.login}. Escolha outro nome.` });
      } else {
        res.status(400).json({ error: createErr?.message ?? "Falha ao criar repositório no GitHub." });
      }
      return;
    }

    const files: FileToCommit[] = [];
    await collectAllFiles(project.storagePath, "", files);

    if (files.length === 0) {
      res.status(400).json({ error: "No files found in project" });
      return;
    }

    const treeItems = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner: user.login,
          repo: repoName,
          content: f.content,
          encoding: f.encoding,
        });
        return {
          path: f.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    const { data: tree } = await octokit.rest.git.createTree({
      owner: user.login,
      repo: repoName,
      tree: treeItems,
    });

    const { data: commit } = await octokit.rest.git.createCommit({
      owner: user.login,
      repo: repoName,
      message: `Initial commit from CodeLens - ${project.name}`,
      tree: tree.sha,
      parents: [],
    });

    await octokit.rest.git.createRef({
      owner: user.login,
      repo: repoName,
      ref: "refs/heads/main",
      sha: commit.sha,
    });

    res.json({
      repoUrl: repo.html_url,
      repoName: repo.full_name,
      filesCommitted: files.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "GitHub API error";
    req.log.error({ err }, "GitHub repo creation failed");
    res.status(400).json({ error: message });
    return;
  }
});

export default router;
