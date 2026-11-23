"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

require("../dist/quest-core.js");
const validatePilot = vm.runInNewContext(
  ["route.js", "coach-package.js", "pilot-core.js"].map((name) =>
    fs.readFileSync(path.join(__dirname, "../dist", name), "utf8")).join("\n") + "\nPilot.validate",
);

function validateTracker(value) {
  if (value?.schemaVersion !== 4) throw Error("Потрібна резервна копія Вершини 2.0.");
  QuestCore.validate(value);
  validatePilot(value.pilot);
}

const token = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessionLifetime = 7 * 86400;
const maxBytes = 4 * 1024 * 1024;

function openWorkspaces(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS workspace_accounts (
      id TEXT PRIMARY KEY, key_digest TEXT NOT NULL UNIQUE,
      tracker TEXT, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS workspace_sessions (
      digest TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES workspace_accounts(id),
      expires INTEGER NOT NULL
    );`);
  return db;
}

function provision(db, id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error("Ідентифікатор акаунта має бути від 1 до 80 символів A–Z, 0–9, _ або -.");
  const key = token();
  db.prepare("INSERT INTO workspace_accounts (id, key_digest) VALUES (?, ?)").run(id, hash(key));
  return key;
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...headers });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(Error("Файл перевищує 4 МБ."), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function workspaceApi(db, origin) {
  const cookie = (value, maxAge) => `vershyna_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
  return async (req, res, pathname) => {
    const method = req.method;
    try {
      if (method !== "GET" && req.headers.origin !== origin) return json(res, 403, { error: "Неприпустимий запит." });
      const digest = hash(/(?:^|;\s*)vershyna_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "")?.[1] || "");
      const now = Math.floor(Date.now() / 1000);
      if (pathname === "/api/session" && method === "POST") {
        const payload = await readJson(req);
        const key = payload?.key;
        const account = typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key) &&
          db.prepare("SELECT id FROM workspace_accounts WHERE key_digest = ?").get(hash(key));
        if (!account) return json(res, 401, { error: "Ключ доступу недійсний." });
        const session = token();
        db.prepare("DELETE FROM workspace_sessions WHERE expires <= ? OR digest = ?").run(now, digest);
        db.prepare("INSERT INTO workspace_sessions VALUES (?, ?, ?)").run(hash(session), account.id, now + sessionLifetime);
        return json(res, 200, { account: account.id }, { "Set-Cookie": cookie(session, sessionLifetime) });
      }
      if (pathname === "/api/session" && method === "DELETE") {
        db.prepare("DELETE FROM workspace_sessions WHERE digest = ?").run(digest);
        return json(res, 200, {}, { "Set-Cookie": cookie("", 0) });
      }
      const account = db.prepare(`SELECT a.id, a.tracker, a.revision FROM workspace_accounts a
        JOIN workspace_sessions s ON a.id = s.account_id WHERE s.digest = ? AND s.expires > ?`).get(digest, now);
      if (!account) return json(res, 401, { error: "Увійди до акаунта Вершини." });
      if (pathname === "/api/workspace" && method === "GET") {
        return json(res, 200, { account: account.id, revision: account.revision,
          tracker: account.tracker ? JSON.parse(account.tracker) : null });
      }
      if (pathname === "/api/workspace" && method === "PUT") {
        const payload = await readJson(req);
        if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0)
          return json(res, 400, { error: "Відсутня версія даних." });
        try {
          validateTracker(payload.tracker);
        } catch {
          return json(res, 400, { error: "Некоректна копія трекера." });
        }
        const updated = db.prepare(`UPDATE workspace_accounts SET tracker = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND EXISTS (
            SELECT 1 FROM workspace_sessions WHERE digest = ? AND expires > ?
          )`).run(JSON.stringify(payload.tracker), account.id, payload.revision, digest, Math.floor(Date.now() / 1000));
        if (!updated.changes) return json(res, 409, { error: "Серверна версія змінилася або сесію закрито. Онови сторінку й звір дані." });
        return json(res, 200, { revision: payload.revision + 1 });
      }
      return json(res, 404, { error: "Сторінку не знайдено." });
    } catch (error) {
      if (error instanceof SyntaxError) return json(res, 400, { error: "Некоректний JSON." });
      if (error.status === 413) {
        req.resume();
        return json(res, 413, { error: error.message });
      }
      if (!res.headersSent) json(res, 500, { error: "Не вдалося обробити запит." });
    }
  };
}

module.exports = { openWorkspaces, provision, workspaceApi };
