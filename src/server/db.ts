import { Database } from "bun:sqlite";
import type { InterviewConfig } from "../pipeline/prompt-builder";

const db = new Database("data.sqlite", { create: true });

// One-time schema setup
db.run(`
  CREATE TABLE IF NOT EXISTS interview_links (
    token      TEXT PRIMARY KEY,
    config     TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

export interface InterviewLink {
  token: string;
  config: InterviewConfig;
  label: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export function createLink(
  config: InterviewConfig,
  label: string,
  ttlHours = 72
): InterviewLink {
  const token = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlHours * 3600;

  db.run(
    `INSERT INTO interview_links (token, config, label, expires_at)
     VALUES (?, ?, ?, ?)`,
    [token, JSON.stringify(config), label, expiresAt]
  );

  return { token, config, label, expiresAt, usedAt: null, createdAt: Math.floor(Date.now() / 1000) };
}

export function getLink(token: string): InterviewLink | null {
  const row = db.query(
    `SELECT * FROM interview_links WHERE token = ?`
  ).get(token) as any;

  if (!row) return null;

  return {
    token: row.token,
    config: JSON.parse(row.config),
    label: row.label,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export function markLinkUsed(token: string): void {
  db.run(
    `UPDATE interview_links SET used_at = unixepoch() WHERE token = ?`,
    [token]
  );
}

export function listLinks(): InterviewLink[] {
  const rows = db.query(
    `SELECT * FROM interview_links ORDER BY created_at DESC LIMIT 50`
  ).all() as any[];

  return rows.map(row => ({
    token: row.token,
    config: JSON.parse(row.config),
    label: row.label,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  }));
}

export function deleteLink(token: string): void {
  db.run(`DELETE FROM interview_links WHERE token = ?`, [token]);
}
