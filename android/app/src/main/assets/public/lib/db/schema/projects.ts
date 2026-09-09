import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  storagePath: text("storage_path").notNull(),
  fileCount: integer("file_count").notNull().default(0),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const projectFilesTable = sqliteTable("project_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
}, (table) => [
  unique("project_files_project_path").on(table.projectId, table.path),
]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type ProjectFile = typeof projectFilesTable.$inferSelect;
