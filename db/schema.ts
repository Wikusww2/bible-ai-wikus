import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userState = sqliteTable("user_state", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  apiKeyCipher: text("api_key_cipher"),
  updatedAt: integer("updated_at").notNull(),
});

export const libraryFiles = sqliteTable("library_files", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  kind: text("kind").notNull(),
  format: text("format").notNull(),
  r2Key: text("r2_key").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const USER_STATE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  api_key_cipher TEXT,
  updated_at INTEGER NOT NULL
)`;

export const LIBRARY_FILES_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}' NOT NULL,
  created_at INTEGER NOT NULL
)`;
