import express from "express";
import { createServer as createViteServer } from "vite";
import apiApp from "./server/app.js";
import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: "info" });
const PORT = parseInt(process.env.PORT ?? "5000", 10);

async function main() {
  const app = express();

  // Mount the API app (it internally registers /api/* routes)
  app.use(apiApp);

  // Create Vite dev server in middleware mode
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: __dirname,
  });

  // Use Vite's connect-compatible middleware
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    logger.info({ port: PORT }, "CodeLens server running");
    console.log(`\n  CodeLens rodando em http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
