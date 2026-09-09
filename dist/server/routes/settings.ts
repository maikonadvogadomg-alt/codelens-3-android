import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "../../lib/db/index.js";
import {
  UpdateSettingsBody,
  UpdateSettingsResponse,
  GetSettingsResponse,
} from "../../lib/api-zod/index.js";

const router: IRouter = Router();

router.get("/settings", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable).limit(1);
  const row = rows[0];

  if (!row) {
    res.json(GetSettingsResponse.parse({
      aiApiKeySet: false,
      aiBaseUrl: null,
      aiModel: null,
      githubTokenSet: false,
    }));
    return;
  }

  res.json(GetSettingsResponse.parse({
    aiApiKeySet: !!row.aiApiKey,
    aiBaseUrl: row.aiBaseUrl ?? null,
    aiModel: row.aiModel ?? null,
    githubTokenSet: !!row.githubToken,
  }));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { aiApiKey, aiBaseUrl, aiModel, githubToken } = parsed.data;

  const rows = await db.select().from(settingsTable).limit(1);
  const existing = rows[0];

  const updateData: Record<string, string | null | Date> = {
    updatedAt: new Date(),
  };

  if (aiBaseUrl !== undefined) updateData.aiBaseUrl = aiBaseUrl?.trim() || null;
  if (aiModel !== undefined) updateData.aiModel = aiModel?.trim() || null;
  if (aiApiKey !== undefined) updateData.aiApiKey = aiApiKey?.trim() || null;
  if (githubToken !== undefined) updateData.githubToken = githubToken?.trim() || null;

  if (existing) {
    await db.update(settingsTable).set(updateData).where(eq(settingsTable.id, existing.id));
  } else {
    await db.insert(settingsTable).values({
      aiApiKey: aiApiKey ?? null,
      aiBaseUrl: aiBaseUrl ?? null,
      aiModel: aiModel ?? null,
      githubToken: githubToken ?? null,
    });
  }

  const updated = await db.select().from(settingsTable).limit(1);
  const row = updated[0];

  res.json(UpdateSettingsResponse.parse({
    aiApiKeySet: !!row?.aiApiKey,
    aiBaseUrl: row?.aiBaseUrl ?? null,
    aiModel: row?.aiModel ?? null,
    githubTokenSet: !!row?.githubToken,
  }));
});

export default router;
