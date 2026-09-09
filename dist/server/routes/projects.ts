import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "../../lib/db/index.js";
import {
  ListProjectsResponse,
  GetProjectParams,
  GetProjectResponse,
  DeleteProjectParams,
} from "../../lib/api-zod/index.js";
import {
  ensureProjectDir,
  deleteProjectDir,
  buildFileTree,
  countFiles,
} from "../lib/storage.js";
import { dbSaveDirectoryTree, ensureProjectOnDisk, dbDeleteAllFiles } from "../lib/persistFiles.js";
import multer from "multer";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });

const router: IRouter = Router();

router.get("/projects", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(projectsTable)
    .orderBy(projectsTable.createdAt);

  res.json(
    ListProjectsResponse.parse(
      rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        fileCount: r.fileCount,
        sizeBytes: r.sizeBytes,
      }))
    )
  );
});

router.post(
  "/projects",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    if (!file.originalname.endsWith(".zip")) {
      res.status(400).json({ error: "Only .zip files are supported" });
      return;
    }

    const name =
      (req.body.name as string) ||
      path.basename(file.originalname, ".zip") ||
      "untitled";
    const slug = `${randomUUID()}`;

    const projectDir = await ensureProjectDir(slug);

    try {
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      // Detect if all entries share a single root folder (e.g. GitHub ZIPs: repo-main/)
      const entryNames = entries.map((e) => e.entryName);
      const firstPart = entryNames[0]?.split("/")[0] ?? "";
      const allHaveSameRoot =
        firstPart.length > 0 &&
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
        const resolvedTarget = path.resolve(targetPath);
        const resolvedBase = path.resolve(projectDir);
        if (!resolvedTarget.startsWith(resolvedBase)) continue;

        const targetDir = path.dirname(targetPath);
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(targetPath, entry.getData());
      }

      const { count, sizeBytes } = await countFiles(projectDir);

      const [inserted] = await db
        .insert(projectsTable)
        .values({
          slug,
          name,
          storagePath: projectDir,
          fileCount: count,
          sizeBytes,
        })
        .returning();

      // Persist files to DB for survival across restarts
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
      req.log.error({ err }, "Failed to extract ZIP");
      res.status(400).json({ error: "Failed to extract ZIP file" });
      return;
    }
  }
);

// ─── POST /projects/blank — create a blank project from template ─────────────

const TEMPLATES: Record<string, Array<{ file: string; content: string }>> = {
  blank: [
    { file: "README.md", content: "# Novo Projeto\n\nDescreva seu projeto aqui.\n" },
  ],
  html: [
    {
      file: "index.html",
      content: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Meu Projeto</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Olá, mundo!</h1>
  <p>Edite este arquivo para começar.</p>
  <script src="script.js"></script>
</body>
</html>
`,
    },
    {
      file: "style.css",
      content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; padding: 2rem; background: #f9f9f9; color: #333; }
h1 { margin-bottom: 1rem; color: #1a73e8; }
`,
    },
    {
      file: "script.js",
      content: `// Seu código JavaScript aqui
console.log('Projeto iniciado!');
`,
    },
  ],
  node: [
    {
      file: "server.js",
      content: `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(\`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meu Servidor Node.js</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; background: #0d1117; color: #e6edf3; max-width: 600px; margin: 0 auto; }
    h1 { color: #58a6ff; margin-bottom: 0.5rem; }
    p { color: #8b949e; line-height: 1.6; }
    code { background: #161b22; padding: 0.2em 0.5em; border-radius: 4px; color: #79c0ff; font-size: 0.9em; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>✅ Servidor Node.js rodando!</h1>
  <p>Servidor HTTP puro — sem dependências externas.</p>
  <div class="card">
    <p>URL acessada: <code>\${req.url}</code></p>
    <p>Hora: <code>\${new Date().toLocaleString('pt-BR')}</code></p>
  </div>
  <p style="margin-top:1.5rem">Edite <code>server.js</code> para personalizar o servidor.</p>
</body>
</html>\`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(\`Servidor rodando em http://localhost:\${PORT}\`);
});
`,
    },
    {
      file: "package.json",
      content: JSON.stringify(
        { name: "meu-servidor", version: "1.0.0", main: "server.js", scripts: { start: "node server.js", dev: "node server.js" } },
        null,
        2
      ) + "\n",
    },
    { file: "README.md", content: "# Servidor Node.js\n\nServidor HTTP sem dependências externas.\n\n```bash\nnode server.js\n```\n\nOu pelo preview: clique em **Iniciar Servidor**.\n" },
  ],
  express: [
    {
      file: "server.js",
      content: `const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Página inicial
app.get('/', (req, res) => {
  res.send(\`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Express App</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; background: #0d1117; color: #e6edf3; max-width: 700px; margin: 0 auto; }
    h1 { color: #58a6ff; }
    p { color: #8b949e; line-height: 1.6; }
    .btn { display: inline-block; background: #238636; color: #fff; padding: 0.5rem 1rem; border-radius: 6px; text-decoration: none; margin-top: 1rem; cursor: pointer; border: none; font-size: 1rem; }
    .btn:hover { background: #2ea043; }
    .output { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-top: 1rem; color: #79c0ff; min-height: 2rem; }
    code { background: #161b22; padding: 0.15em 0.4em; border-radius: 4px; color: #79c0ff; }
  </style>
</head>
<body>
  <h1>🚀 Express funcionando!</h1>
  <p>Servidor Express rodando. Edite <code>server.js</code> para adicionar rotas.</p>
  <button class="btn" onclick="testar()">Testar API</button>
  <div class="output" id="out">Clique no botão para testar a API...</div>
  <script>
    async function testar() {
      const r = await fetch('/api/hello');
      const d = await r.json();
      document.getElementById('out').textContent = JSON.stringify(d, null, 2);
    }
  </script>
</body>
</html>\`);
});

// API de exemplo
app.get('/api/hello', (req, res) => {
  res.json({
    mensagem: 'Olá do servidor Express!',
    hora: new Date().toLocaleString('pt-BR'),
    status: 'ok'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Express rodando em http://localhost:\${PORT}\`);
});
`,
    },
    {
      file: "package.json",
      content: JSON.stringify(
        {
          name: "express-app",
          version: "1.0.0",
          main: "server.js",
          scripts: { start: "node server.js", dev: "node server.js" },
          dependencies: { express: "^4.18.2" },
        },
        null,
        2
      ) + "\n",
    },
    { file: "README.md", content: "# Express App\n\n```bash\nnpm install\nnode server.js\n```\n\nOu pelo preview: **npm install** no terminal, depois clique em **Iniciar Servidor**.\n" },
  ],
  react: [
    {
      file: "index.html",
      content: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,
    },
    {
      file: "package.json",
      content: JSON.stringify(
        {
          name: "react-app",
          version: "0.0.0",
          private: true,
          scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
          dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
          devDependencies: { "@vitejs/plugin-react": "^4.3.0", vite: "^6.0.0" },
        },
        null,
        2
      ) + "\n",
    },
    {
      file: "vite.config.js",
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
`,
    },
    {
      file: "src/main.jsx",
      content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`,
    },
    {
      file: "src/App.jsx",
      content: `import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>React App</h1>
      <p>Contador: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  )
}
`,
    },
    { file: "README.md", content: "# React App\n\n```bash\nnpm install\nnpm run dev\n```\n" },
  ],
};

router.post("/projects/blank", async (req, res): Promise<void> => {
  const { name, template = "blank" } = req.body as { name?: string; template?: string };
  const projectName = (name ?? "Novo Projeto").trim() || "Novo Projeto";
  const files = TEMPLATES[template] ?? TEMPLATES.blank;
  const slug = randomUUID();
  const projectDir = await ensureProjectDir(slug);

  for (const { file, content } of files) {
    const fullPath = path.join(projectDir, file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  const { count, sizeBytes } = await countFiles(projectDir);
  const [inserted] = await db
    .insert(projectsTable)
    .values({ slug, name: projectName, storagePath: projectDir, fileCount: count, sizeBytes })
    .returning();

  // Persist template files to DB for survival across restarts
  await dbSaveDirectoryTree(inserted.id, projectDir);

  res.status(201).json({
    id: String(inserted.id),
    name: inserted.name,
    createdAt: inserted.createdAt.toISOString(),
    fileCount: inserted.fileCount,
    sizeBytes: inserted.sizeBytes,
  });
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const params = GetProjectParams.safeParse({ projectId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Restore from DB if /tmp was wiped (after server restart/redeploy)
  await ensureProjectOnDisk(project.id, project.storagePath);

  const tree = await buildFileTree(project.storagePath);

  res.json(
    GetProjectResponse.parse({
      id: String(project.id),
      name: project.name,
      createdAt: project.createdAt.toISOString(),
      fileCount: project.fileCount,
      sizeBytes: project.sizeBytes,
      tree: { ...tree, name: project.name, path: "" },
    })
  );
});

// ─── GET /projects/:projectId/export — download project as ZIP ───────────────

router.get("/projects/:projectId/export", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await ensureProjectOnDisk(project.id, project.storagePath);

  try {
    const zip = new AdmZip();

    async function addDirToZip(dir: string, zipPath: string): Promise<void> {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await addDirToZip(fullPath, entryZipPath);
        } else {
          try {
            const data = await fs.readFile(fullPath);
            zip.addFile(entryZipPath, data);
          } catch {}
        }
      }
    }

    await addDirToZip(project.storagePath, "");

    const safeName = project.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const buffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "Failed to export project as ZIP");
    res.status(500).json({ error: "Failed to create ZIP" });
  }
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const params = DeleteProjectParams.safeParse({ projectId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await deleteProjectDir(project.slug);
  await db.delete(projectsTable).where(eq(projectsTable.id, id));

  res.sendStatus(204);
});

export default router;
