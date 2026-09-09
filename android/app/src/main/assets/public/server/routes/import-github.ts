import { Router, type IRouter } from "express";
import { db, settingsTable, projectsTable } from "../../lib/db/index.js";
import { ImportFromGithubBody } from "../../lib/api-zod/index.js";
import {
  ensureProjectDir,
  deleteProjectDir,
  countFiles,
} from "../lib/storage.js";
import { dbSaveDirectoryTree } from "../lib/persistFiles.js";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

const router: IRouter = Router();

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const cleaned = url
      .trim()
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    const patterns = [
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/,
      /^github\.com\/([^/]+)\/([^/]+)$/,
      /^([^/]+)\/([^/]+)$/,
    ];
    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match) return { owner: match[1], repo: match[2] };
    }
    return null;
  } catch {
    return null;
  }
}

router.post("/projects/import-github", async (req, res): Promise<void> => {
  const parsed = ImportFromGithubBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { repoUrl, branch } = parsed.data;

  const repoInfo = parseGithubUrl(repoUrl);
  if (!repoInfo) {
    res.status(400).json({
      error:
        "Invalid GitHub URL. Use format: https://github.com/owner/repo",
    });
    return;
  }

  const { owner, repo } = repoInfo;

  const settingsRows = await db.select().from(settingsTable).limit(1);
  const settings = settingsRows[0];
  const githubToken = settings?.githubToken ?? null;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "CodeLens-App",
  };
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  let targetBranch = branch ?? null;

  if (!targetBranch) {
    const repoApiRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    if (!repoApiRes.ok) {
      const err = await repoApiRes.text();
      res.status(400).json({
        error: `Could not access repository: ${repoApiRes.status} - ${err.slice(0, 200)}`,
      });
      return;
    }
    const repoData = (await repoApiRes.json()) as { default_branch?: string };
    targetBranch = repoData.default_branch ?? "main";
  }

  const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${targetBranch}`;

  const zipRes = await fetch(zipUrl, { headers });
  if (!zipRes.ok) {
    res.status(400).json({
      error: `Could not download repository ZIP: ${zipRes.status}. Make sure the repo is public or configure your GitHub token in Settings.`,
    });
    return;
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

  const slug = randomUUID();
  const projectDir = await ensureProjectDir(slug);

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const entryNames = entries.map((e) => e.entryName);
    const firstPart = entryNames[0]?.split("/")[0] ?? "";
    const allHaveSameRoot =
      firstPart &&
      entryNames.every((n) => n.startsWith(firstPart + "/") || n === firstPart);
    const rootPrefix = allHaveSameRoot ? firstPart + "/" : "";

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      let entryName = entry.entryName;
      if (rootPrefix && entryName.startsWith(rootPrefix)) {
        entryName = entryName.slice(rootPrefix.length);
      }

      if (!entryName) continue;

      const targetPath = path.join(projectDir, entryName);
      const targetDir = path.dirname(targetPath);

      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(projectDir);
      if (!resolvedTarget.startsWith(resolvedBase)) continue;

      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, entry.getData());
    }

    const { count, sizeBytes } = await countFiles(projectDir);
    const projectName = `${owner}/${repo}`;

    const [inserted] = await db
      .insert(projectsTable)
      .values({
        slug,
        name: projectName,
        storagePath: projectDir,
        fileCount: count,
        sizeBytes,
      })
      .returning();

    // Persist files to DB for survival across restarts/redeploys
    await dbSaveDirectoryTree(inserted.id, projectDir);

    res.status(201).json({
      id: String(inserted.id),
      name: inserted.name,
      createdAt: inserted.createdAt.toISOString(),
      fileCount: inserted.fileCount,
      sizeBytes: inserted.sizeBytes,
    });
  } catch (err) {
    await deleteProjectDir(slug);
    req.log.error({ err }, "Failed to import GitHub repo");
    res.status(400).json({ error: "Failed to process repository files" });
    return;
  }
});

export default router;
