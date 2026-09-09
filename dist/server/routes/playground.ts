import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, playgroundSavesTable } from "../../lib/db/index.js";

const router: IRouter = Router();

// Listar todos os saves
router.get("/playground", async (req, res): Promise<void> => {
  try {
    const saves = await db.select({
      id: playgroundSavesTable.id,
      title: playgroundSavesTable.title,
      createdAt: playgroundSavesTable.createdAt,
      updatedAt: playgroundSavesTable.updatedAt,
    }).from(playgroundSavesTable).orderBy(desc(playgroundSavesTable.updatedAt));
    res.json(saves);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Buscar um save pelo id
router.get("/playground/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = await db.select().from(playgroundSavesTable).where(eq(playgroundSavesTable.id, id));
    if (!rows[0]) { res.status(404).json({ error: "Não encontrado" }); return; }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Criar novo save
router.post("/playground", async (req, res): Promise<void> => {
  try {
    const { title, html } = req.body as { title?: string; html?: string };
    const now = new Date().toISOString();
    const rows = await db.insert(playgroundSavesTable)
      .values({ title: title || "Sem título", html: html || "", createdAt: now, updatedAt: now })
      .returning();
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Atualizar save existente
router.put("/playground/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, html } = req.body as { title?: string; html?: string };
    const now = new Date().toISOString();
    const rows = await db.update(playgroundSavesTable)
      .set({ ...(title !== undefined && { title }), ...(html !== undefined && { html }), updatedAt: now })
      .where(eq(playgroundSavesTable.id, id))
      .returning();
    if (!rows[0]) { res.status(404).json({ error: "Não encontrado" }); return; }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Deletar save
router.delete("/playground/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(playgroundSavesTable).where(eq(playgroundSavesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
