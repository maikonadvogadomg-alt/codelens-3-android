import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const playgroundSavesTable = sqliteTable("playground_saves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("Sem título"),
  html: text("html").notNull().default(""),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export type PlaygroundSave = typeof playgroundSavesTable.$inferSelect;
