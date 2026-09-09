import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, settingsTable } from "../../lib/db/index.js";
import { AnalyzeFileBody, AnalyzeFolderBody, AiChatBody } from "../../lib/api-zod/index.js";
import { isBinaryFile, detectLanguage } from "../lib/storage.js";
import { ensureProjectOnDisk } from "../lib/persistFiles.js";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import fs from "fs/promises";

async function buildProjectContext(projectId: string): Promise<{ text: string; fileCount: number; totalFiles: number; truncated: boolean; fileList: string }> {
  const numId = parseInt(projectId, 10);
  if (isNaN(numId)) throw new Error("ID de projeto inválido");
  const rows = await db.select().from(projectsTable).where(eq(projectsTable.id, numId)).limit(1);
  const project = rows[0];
  if (!project) throw new Error("Projeto não encontrado");

  await ensureProjectOnDisk(project.id, project.storagePath);

  const projectDir = project.storagePath;
  const MAX_CHARS = 500_000;
  const MAX_DEPTH = 15;
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "vendor", ".svn"]);

  const allFiles: Array<{ relPath: string; fullPath: string; size: number }> = [];

  async function collectFiles(dir: string, relBase: string, depth = 0) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    const sorted = entries
      .filter(e => !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath, relPath, depth + 1);
      } else if (!isBinaryFile(relPath)) {
        try {
          const stat = await fs.stat(fullPath);
          allFiles.push({ relPath, fullPath, size: stat.size });
        } catch {}
      }
    }
  }

  await collectFiles(projectDir, "");

  const fileList = allFiles.map(f => `  ${f.relPath} (${f.size} bytes)`).join("\n");
  const totalFiles = allFiles.length;

  const parts: string[] = [];
  let fileCount = 0;
  let totalChars = 0;
  let truncated = false;

  for (const file of allFiles) {
    if (totalChars >= MAX_CHARS) {
      truncated = true;
      continue;
    }
    try {
      const content = await fs.readFile(file.fullPath, "utf-8");
      const lang = detectLanguage(file.relPath);
      const block = `// ═══ ARQUIVO: ${file.relPath} ═══\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
      parts.push(block);
      totalChars += block.length;
      fileCount++;
    } catch {}
  }

  return { text: parts.join("\n"), fileCount, totalFiles, truncated, fileList };
}

const router: IRouter = Router();

async function getAiSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  return rows[0] ?? null;
}

function getGeminiFallback(): { apiKey: string; baseUrl: string; model: string } | null {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (baseUrl && apiKey) {
    return { apiKey, baseUrl: baseUrl.replace(/\/$/, ""), model: "gemini-2.5-flash" };
  }
  return null;
}

async function callGemini(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
  });

  const systemParts: string[] = [];
  const nonSystemMessages = messages.filter((m) => {
    if (m.role === "system") {
      systemParts.push(m.content);
      return false;
    }
    return true;
  });

  const contents = nonSystemMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const config: { maxOutputTokens: number; systemInstruction?: string } = { maxOutputTokens: 8192 };
  if (systemParts.length > 0) {
    config.systemInstruction = systemParts.join("\n\n");
  }

  const response = await client.models.generateContent({
    model,
    contents,
    config,
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }
  return text;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 8000 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned empty response");
  }
  return content;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const systemParts: string[] = [];
  const chatMessages = messages.filter((m) => {
    if (m.role === "system") {
      systemParts.push(m.content);
      return false;
    }
    return true;
  });

  const anthropicMessages = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" as const : "user" as const,
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    messages: anthropicMessages,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic returned empty response");
  }
  return textBlock.text;
}

function detectProviderFromKey(apiKey: string): "anthropic" | "gemini" | "groq" | "perplexity" | "openai" {
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("AIza")) return "gemini";
  if (apiKey.startsWith("gsk_")) return "groq";
  if (apiKey.startsWith("pplx-")) return "perplexity";
  return "openai";
}

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case "groq": return "https://api.groq.com/openai/v1";
    case "perplexity": return "https://api.perplexity.ai";
    case "gemini": return "https://generativelanguage.googleapis.com/v1beta/openai";
    default: return "https://api.openai.com/v1";
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "groq": return "llama-3.3-70b-versatile";
    case "perplexity": return "sonar-pro";
    case "gemini": return "gemini-2.5-flash";
    default: return "gpt-4o";
  }
}

async function callWithProvider(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  if (provider === "anthropic") {
    return callAnthropic(apiKey, model, messages);
  }
  return callOpenAiCompatible(
    baseUrl ?? getDefaultBaseUrl(provider),
    apiKey,
    model,
    messages
  );
}

const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile"],
  perplexity: ["sonar-pro", "sonar"],
};

async function callAi(
  settings: { aiApiKey: string | null; aiBaseUrl: string | null; aiModel: string | null },
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  if (settings.aiApiKey) {
    const provider = detectProviderFromKey(settings.aiApiKey);
    const model = settings.aiModel?.trim() || null;

    if (model) {
      try {
        return await callWithProvider(provider, settings.aiApiKey, settings.aiBaseUrl, model, messages);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("404")) throw err;
      }
    }

    const candidates = FALLBACK_MODELS[provider] ?? [getDefaultModel(provider)];
    for (const candidate of candidates) {
      if (candidate === model) continue;
      try {
        return await callWithProvider(provider, settings.aiApiKey, settings.aiBaseUrl, candidate, messages);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "";
        if (!m.includes("404")) throw e;
      }
    }

    throw new Error(`Nenhum modelo disponível para ${provider}. Verifique sua chave de API.`);
  }

  const fallback = getGeminiFallback();
  if (!fallback) {
    throw new Error("AI API key not configured. Please go to Settings and add your API key.");
  }
  return callGemini(fallback.baseUrl, fallback.apiKey, fallback.model, messages);
}

router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, fileContext, filePath, projectId, projectContext, terminalContext } = parsed.data;

  const settings = await getAiSettings();
  const effectiveSettings = {
    aiApiKey: settings?.aiApiKey ?? null,
    aiBaseUrl: settings?.aiBaseUrl ?? null,
    aiModel: settings?.aiModel ?? null,
  };
  if (!effectiveSettings.aiApiKey && !getGeminiFallback()) {
    res.status(400).json({ error: "Chave de API da IA não configurada. Vá em Configurações." });
    return;
  }

  const systemMessages: Array<{ role: string; content: string }> = [];

  const FILE_CHANGE_INSTRUCTIONS = `
Você tem TRÊS capacidades especiais — use os formatos abaixo quando apropriado. O sistema renderizará botões de ação para cada bloco.

1. CRIAR OU EDITAR arquivo:
<codelens-write path="caminho/do/arquivo.ts">
conteúdo completo do arquivo aqui
</codelens-write>

2. DELETAR arquivo:
<codelens-delete path="caminho/do/arquivo.ts"/>

3. SUGERIR COMANDO para o terminal (npm install, git, node, etc.):
<codelens-exec>npm install axios</codelens-exec>

REGRAS IMPORTANTES:
- Caminhos sempre relativos à raiz do projeto, sem / inicial
- Conteúdo COMPLETO no bloco write (nunca use "..." ou "resto do código aqui")
- Pode combinar múltiplos blocos write + exec em uma única resposta
- Para instalar pacotes: use <codelens-exec>npm install nome-do-pacote</codelens-exec>
- Para banco de dados: SQLite usa "better-sqlite3" ou "drizzle-orm", Postgres usa "pg" ou "drizzle-orm/node-postgres"
- Explique em PORTUGUÊS o que você está fazendo antes de cada bloco
- Quando houver múltiplas etapas (instalar + criar arquivo + configurar), faça tudo em sequência na mesma resposta`;

  if (projectContext && projectId) {
    try {
      const { text, fileCount, totalFiles, truncated, fileList } = await buildProjectContext(projectId);
      systemMessages.push({
        role: "system",
        content: `Voce e um engenheiro de software senior. Objetivo e direto. Sem gentilezas, sem desculpas, sem rodeios.

══════════════════════════════════════════════════════════════
INVENTARIO COMPLETO DO PROJETO (${totalFiles} arquivos encontrados):
══════════════════════════════════════════════════════════════
${fileList}
══════════════════════════════════════════════════════════════

${truncated
  ? `NOTA: Projeto grande. ${fileCount} de ${totalFiles} arquivos incluidos com conteudo completo abaixo (limite de tamanho atingido). Os ${totalFiles - fileCount} restantes estao listados acima mas sem conteudo — se precisar deles, crie uma versao melhorada com bloco de acao.`
  : `TODOS os ${totalFiles} arquivos do projeto estao incluidos com conteudo completo abaixo. Nao falta NENHUM arquivo.`}

╔══════════════════════════════════════════════════════════════╗
║  REGRA ABSOLUTA: NUNCA PECA ARQUIVOS AO USUARIO            ║
║                                                              ║
║  Voce JA TEM todos os arquivos. Eles estao ABAIXO.          ║
║  A lista completa esta ACIMA.                                ║
║                                                              ║
║  PROIBIDO dizer:                                             ║
║  - "preciso ver o arquivo X"                                 ║
║  - "pode me mostrar/enviar/compartilhar..."                  ║
║  - "para continuar, preciso de..."                           ║
║  - "poderia me fornecer..."                                  ║
║  - "nao encontrei o arquivo X" (se esta na lista, esta aqui)║
║                                                              ║
║  Se o arquivo esta na lista acima = voce TEM o conteudo.     ║
║  Se NAO esta na lista = NAO EXISTE. Crie com bloco de acao.  ║
║  NUNCA peca nada. NUNCA. Trabalhe com o que tem.             ║
╚══════════════════════════════════════════════════════════════╝

REGRAS DE COMPORTAMENTO:
1. Va direto ao ponto. Sem gentilezas, sem "desculpe", sem "com certeza".
2. Se o usuario pedir correcao, CORRIJA imediatamente com bloco de acao.
3. Bug encontrado = mostre causa em 1 frase + correcao pronta.
4. Respostas em PORTUGUES com markdown.
5. Nunca diga "nao posso". Faca por etapas se for complexo.
6. Analise usando os arquivos que JA ESTAO no contexto. Nao peca mais nada.

CAPACIDADES (use blocos de acao):
- Criar/editar arquivos: <codelens-write path="...">conteudo</codelens-write>
- Deletar arquivos: <codelens-delete path="..."/>
- Comandos de terminal: <codelens-exec>comando</codelens-exec>
- Refatorar, reorganizar, corrigir bugs — tudo com blocos de acao

══════════════════════════════════════════════════════════════
CONTEUDO DOS ARQUIVOS (${fileCount} de ${totalFiles}):
══════════════════════════════════════════════════════════════

${text}

══════════════════════════════════════════════════════════════
FIM — TODOS OS ARQUIVOS FORAM FORNECIDOS ACIMA
══════════════════════════════════════════════════════════════

Referencie arquivos pelo caminho. Use os dados acima diretamente.
${FILE_CHANGE_INSTRUCTIONS}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao carregar projeto";
      res.status(400).json({ error: message });
      return;
    }
  } else if (fileContext && filePath) {
    const language = detectLanguage(filePath);
    systemMessages.push({
      role: "system",
      content: `Voce e um engenheiro de software senior. Objetivo e direto. Sem gentilezas. O usuario esta no arquivo "${filePath}".

Conteudo do arquivo (${language}):
\`\`\`${language}
${fileContext}
\`\`\`

REGRAS: Respostas em portugues, diretas, com markdown. Se encontrar bug, corrija com bloco de acao. Nunca diga "desculpe" ou "com certeza". Va ao ponto.
${FILE_CHANGE_INSTRUCTIONS}`,
    });
  } else {
    systemMessages.push({
      role: "system",
      content: `Voce e um engenheiro de software senior. Objetivo e direto. Sem gentilezas, sem desculpas. Respostas em portugues com markdown. Se encontrar problema, corrija com bloco de acao. Nunca diga "desculpe", "com certeza" ou "fico feliz". Va direto ao ponto.
${FILE_CHANGE_INSTRUCTIONS}`,
    });
  }

  // Inject terminal context as an extra system message if provided
  if (terminalContext && terminalContext.trim()) {
    systemMessages.push({
      role: "system",
      content: `📟 SAÍDA RECENTE DO TERMINAL DO USUÁRIO:
\`\`\`
${terminalContext.trim().slice(0, 8000)}
\`\`\`
Use esse contexto para entender erros recentes e ajudar o usuário a corrigir os problemas sem precisar que ele copie e cole os erros.`,
    });
  }

  const allMessages = [
    ...systemMessages,
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const reply = await callAi(effectiveSettings, allMessages);
    res.json({ reply, model: effectiveSettings.aiModel ?? (getGeminiFallback()?.model ?? "gpt-4o") });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro na IA";
    req.log.error({ err }, "AI chat failed");
    res.status(400).json({ error: message });
    return;
  }
});

router.post("/ai/analyze-file", async (req, res): Promise<void> => {
  const parsed = AnalyzeFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, filePath, content } = parsed.data;

  const settings = await getAiSettings();
  if (!settings?.aiApiKey && !getGeminiFallback()) {
    res.status(400).json({ error: "AI API key not configured. Please go to Settings." });
    return;
  }

  const language = detectLanguage(filePath);
  const filename = path.basename(filePath);

  const prompt = `Voce e um analista de codigo objetivo e direto. Analise este arquivo e responda em portugues:
1. O que este arquivo faz (1-2 frases)
2. Padroes e responsabilidades principais
3. Bugs, problemas ou melhorias que voce identifica — se encontrar, mostre a correcao
4. Qualidade geral do codigo

Arquivo: ${filename} (${language})
Caminho: ${filePath}

\`\`\`${language}
${content.slice(0, 8000)}
\`\`\`

Seja direto. Sem rodeios. Se tem bug, mostre a correcao pronta.`;

  try {
    const effectiveSettings = {
      aiApiKey: settings?.aiApiKey ?? null,
      aiBaseUrl: settings?.aiBaseUrl ?? null,
      aiModel: settings?.aiModel ?? null,
    };
    const analysis = await callAi(effectiveSettings, [
      { role: "user", content: prompt }
    ]);

    res.json({
      analysis,
      model: effectiveSettings.aiModel ?? (getGeminiFallback()?.model ?? "gpt-4o"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown AI error";
    req.log.error({ err }, "AI analysis failed");
    res.status(400).json({ error: message });
    return;
  }
});

router.post("/ai/analyze-folder", async (req, res): Promise<void> => {
  const parsed = AnalyzeFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, folderPath } = parsed.data;

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

  const settings = await getAiSettings();
  if (!settings?.aiApiKey && !getGeminiFallback()) {
    res.status(400).json({ error: "AI API key not configured. Please go to Settings." });
    return;
  }

  const normalizedFolder = folderPath.replace(/^\//, "");
  const fullFolderPath = normalizedFolder
    ? path.join(project.storagePath, normalizedFolder)
    : project.storagePath;

  const resolved = path.resolve(fullFolderPath);
  const base = path.resolve(project.storagePath);
  if (!resolved.startsWith(base)) {
    res.status(400).json({ error: "Invalid folder path" });
    return;
  }

  interface FileEntry {
    path: string;
    language: string;
    preview: string;
  }

  const fileEntries: FileEntry[] = [];

  async function collectFiles(dir: string, prefix: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = path.join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await collectFiles(fullPath, rel);
        } else if (!isBinaryFile(entry)) {
          try {
            const buf = await fs.readFile(fullPath);
            const preview = buf.toString("utf-8").slice(0, 500);
            fileEntries.push({
              path: rel,
              language: detectLanguage(entry),
              preview,
            });
          } catch {
            fileEntries.push({ path: rel, language: detectLanguage(entry), preview: "" });
          }
        }
      }
    } catch {
    }
  }

  await collectFiles(fullFolderPath, "");

  const folderName = normalizedFolder ? path.basename(normalizedFolder) : project.name;
  const filesOverview = fileEntries.slice(0, 30).map((f) =>
    `- ${f.path} (${f.language})${f.preview ? `\n  Preview: ${f.preview.slice(0, 200).replace(/\n/g, " ")}` : ""}`
  ).join("\n");

  const prompt = `Voce e um analista de codigo objetivo e direto. Analise esta pasta e responda em portugues:
1. Proposito e funcao desta pasta no projeto
2. Tipos de arquivos e codigo que contem
3. Como se encaixa na arquitetura geral
4. Padroes e convencoes observados
5. Avaliacao da organizacao — se tem problema, aponte

Pasta: ${folderName}
Projeto: ${project.name}
Arquivos analisados: ${fileEntries.length}

Arquivos nesta pasta:
${filesOverview}

Seja direto e objetivo. Sem rodeios.`;

  try {
    const effectiveSettings = {
      aiApiKey: settings?.aiApiKey ?? null,
      aiBaseUrl: settings?.aiBaseUrl ?? null,
      aiModel: settings?.aiModel ?? null,
    };
    const analysis = await callAi(effectiveSettings, [
      { role: "user", content: prompt }
    ]);

    res.json({
      analysis,
      model: effectiveSettings.aiModel ?? (getGeminiFallback()?.model ?? "gpt-4o"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown AI error";
    req.log.error({ err }, "AI folder analysis failed");
    res.status(400).json({ error: message });
    return;
  }
});

router.post("/ai/tts", async (req, res): Promise<void> => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texto é obrigatório" });
    return;
  }

  const cleanText = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4096);

  const stamp = Date.now();
  const txtFile = `/tmp/tts_in_${stamp}.txt`;
  const mp3File = `/tmp/tts_out_${stamp}.mp3`;

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    await fs.writeFile(txtFile, cleanText, "utf8");

    await execFileAsync(
      "python3",
      [
        "-m", "edge_tts",
        "--file", txtFile,
        "--voice", "pt-BR-FranciscaNeural",
        "--write-media", mp3File,
      ],
      { timeout: 45000 }
    );

    const audioBuffer = await fs.readFile(mp3File);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length),
    });
    res.send(audioBuffer);
  } catch (err: unknown) {
    req.log.error({ err }, "TTS failed");
    res.status(500).json({ error: "Falha ao gerar áudio" });
  } finally {
    fs.unlink(txtFile).catch(() => {});
    fs.unlink(mp3File).catch(() => {});
  }
});

export default router;
