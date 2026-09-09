import path from "path";
import fs from "fs/promises";
import os from "os";

const STORAGE_BASE = process.env.STORAGE_PATH ?? path.join(os.tmpdir(), "code-editor-projects");

export async function ensureStorageDir(): Promise<string> {
  await fs.mkdir(STORAGE_BASE, { recursive: true });
  return STORAGE_BASE;
}

export function getProjectDir(slug: string): string {
  return path.join(STORAGE_BASE, slug);
}

export async function ensureProjectDir(slug: string): Promise<string> {
  const dir = getProjectDir(slug);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function deleteProjectDir(slug: string): Promise<void> {
  const dir = getProjectDir(slug);
  await fs.rm(dir, { recursive: true, force: true });
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export async function buildFileTree(rootDir: string, relativePath = ""): Promise<FileNode> {
  const fullPath = relativePath ? path.join(rootDir, relativePath) : rootDir;
  const name = relativePath ? path.basename(relativePath) : path.basename(rootDir);

  const stat = await fs.stat(fullPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(fullPath);
    const children = await Promise.all(
      entries
        .filter(e => !e.startsWith("."))
        .sort((a, b) => a.localeCompare(b))
        .map(async (entry) => {
          const childRelPath = relativePath ? `${relativePath}/${entry}` : entry;
          return buildFileTree(rootDir, childRelPath);
        })
    );

    const dirs = children.filter(c => c.type === "directory");
    const files = children.filter(c => c.type === "file");

    return {
      name,
      path: relativePath || "",
      type: "directory",
      children: [...dirs, ...files],
    };
  } else {
    return {
      name,
      path: relativePath,
      type: "file",
    };
  }
}

export async function countFiles(dir: string): Promise<{ count: number; sizeBytes: number }> {
  let count = 0;
  let sizeBytes = 0;

  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = path.join(d, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await walk(fullPath);
      } else {
        count++;
        sizeBytes += stat.size;
      }
    }
  }

  await walk(dir);
  return { count, sizeBytes };
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".md": "markdown",
    ".mdx": "markdown",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".sql": "sql",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".env": "plaintext",
    ".txt": "plaintext",
    ".log": "plaintext",
    ".Dockerfile": "dockerfile",
    ".tf": "hcl",
    ".lua": "lua",
    ".r": "r",
    ".R": "r",
    ".vue": "vue",
    ".svelte": "svelte",
  };
  return map[ext] ?? "plaintext";
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".ttf", ".woff", ".woff2", ".eot",
  ".pyc", ".class", ".o",
]);

export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}
