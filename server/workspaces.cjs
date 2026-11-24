"use strict";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { setUpCoach } = require("./coach.cjs");

require("../dist/quest-core.js");
const { validatePilot, applyPackage, reviseRoute, visionLabels } = vm.runInNewContext(
  ["route.js", "coach-package.js", "pilot-core.js"].map((name) =>
    fs.readFileSync(path.join(__dirname, "../dist", name), "utf8")).join("\n") + `
({
    validatePilot: Pilot.validate,
    visionLabels: Route.visionLabels,
    reviseRoute: (previous, updated, at, missions) => Route.revise(previous, updated.vision, Route.goals(updated), at, missions),
    applyPackage: (tracker, packet, uid, at) => CoachPackage.draft(tracker, CoachPackage.parse(packet), uid, at),
  })`, { TextEncoder, structuredClone, QuestCore, atob },
);

function validateTracker(value) {
  if (value?.schemaVersion !== 4) throw Error("Потрібна резервна копія Вершини 2.0.");
  QuestCore.validate(value);
  validatePilot(value.pilot);
}

function configureCoach(db) {
  return setUpCoach(db, {
    validateTracker, visionLabels, reviseRoute,
    applyPackage: (tracker, packet) => applyPackage(tracker, packet, randomUUID, new Date().toISOString()),
  });
}

const token = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessionLifetime = 7 * 86400;
const maxBytes = 8 * 1024 * 1024 + 1024;

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
    );
    CREATE TABLE IF NOT EXISTS workspace_google_identities (
      subject TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE REFERENCES workspace_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS google_login_attempts (
      digest TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL
    );`);
  configureCoach(db);
  return db;
}

function provision(db, id, role = "client", rotate = false) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error("Ідентифікатор акаунта має бути від 1 до 80 символів A–Z, 0–9, _ або -.");
  if (!["client", "coach"].includes(role)) throw Error("Роль має бути client або coach.");
  const key = token();
  const coach = configureCoach(db);
  coach.transaction(() => {
    if (rotate) {
      if (!db.prepare("UPDATE workspace_accounts SET key_digest = ? WHERE id = ?").run(hash(key), id).changes)
        throw Error("Акаунта немає.");
      db.prepare("DELETE FROM workspace_sessions WHERE account_id = ?").run(id);
    } else {
      db.prepare("INSERT INTO workspace_accounts (id, key_digest) VALUES (?, ?)").run(id, hash(key));
      if (role === "coach") db.prepare("INSERT INTO coach_roles VALUES (?)").run(id);
    }
  });
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
    if (size > maxBytes) throw Object.assign(Error("Дані перевищують 8 МБ."), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function activeAccount(db, req) {
  const digest = sessionDigest(req);
  return db.prepare(`SELECT a.id, a.tracker, a.revision FROM workspace_accounts a
    JOIN workspace_sessions s ON a.id = s.account_id WHERE s.digest = ? AND s.expires > ?`)
    .get(digest, Math.floor(Date.now() / 1000));
}

function sessionDigest(req) {
  return hash(/(?:^|;\s*)vershyna_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "")?.[1] || "");
}

function snapshot(account) {
  return { account: account.id, revision: account.revision,
    tracker: account.tracker ? JSON.parse(account.tracker) : null };
}

function sessionCookie(origin, value, maxAge) {
  return `vershyna_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
}

function startSession(db, origin, req, accountId) {
  const session = token();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM workspace_sessions WHERE expires <= ? OR digest = ?").run(now, sessionDigest(req));
  db.prepare("INSERT INTO workspace_sessions VALUES (?, ?, ?)").run(hash(session), accountId, now + sessionLifetime);
  return sessionCookie(origin, session, sessionLifetime);
}

function identifyGoogleAccount(db, coach, subject, isCoach, registerClients) {
  return coach.transaction(() => {
    const identity = db.prepare("SELECT account_id FROM workspace_google_identities WHERE subject = ?").get(subject);
    if (identity) {
      const role = coach.role(identity.account_id);
      if (role === "coach" && !isCoach) return null;
      return { id: identity.account_id, role };
    }
    if (!isCoach && !registerClients) return null;
    const id = isCoach ? "kateryna-coach" : randomUUID();
    const role = isCoach ? "coach" : "client";
    const existing = db.prepare("SELECT id FROM workspace_accounts WHERE id = ?").get(id);
    if (existing) {
      if (coach.role(id) !== role || db.prepare("SELECT subject FROM workspace_google_identities WHERE account_id = ?").get(id))
        return null;
    } else {
      db.prepare("INSERT INTO workspace_accounts (id, key_digest) VALUES (?, ?)").run(id, hash(token()));
      if (isCoach) db.prepare("INSERT INTO coach_roles VALUES (?)").run(id);
    }
    db.prepare("INSERT INTO workspace_google_identities VALUES (?, ?)").run(subject, id);
    return { id, role };
  });
}

function workspaceApi(db, origin, calendar, coach = configureCoach(db)) {
  return async (req, res, pathname) => {
    const method = req.method;
    try {
      if (method !== "GET" && req.headers.origin !== origin) return json(res, 403, { error: "Неприпустимий запит." });
      const digest = sessionDigest(req);
      if (pathname === "/api/session" && method === "POST") {
        const payload = await readJson(req);
        const key = payload?.key;
        const account = typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key) &&
          db.prepare("SELECT id FROM workspace_accounts WHERE key_digest = ?").get(hash(key));
        if (!account) return json(res, 401, { error: "Ключ доступу недійсний." });
        return json(res, 200, { account: account.id }, { "Set-Cookie": startSession(db, origin, req, account.id) });
      }
      if (pathname === "/api/session" && method === "DELETE") {
        db.prepare("DELETE FROM workspace_sessions WHERE digest = ?").run(digest);
        return json(res, 200, {}, { "Set-Cookie": sessionCookie(origin, "", 0) });
      }
      const account = activeAccount(db, req);
      if (!account || (req.headers["x-vershyna-account"] && req.headers["x-vershyna-account"] !== account.id))
        return json(res, 401, { error: "Увійди до потрібного акаунта Вершини." });
      if (pathname.startsWith("/api/coach/"))
        return await coach.api(req, res, pathname, account, { json, readJson, digest, activeAccount });
      if (coach.suspended(account.id)) return json(res, 403, { error: "Доступ до трекера призупинено." });
      if (pathname.startsWith("/api/calendar/") && calendar) {
        return await calendar(req, res, pathname, account, { json, readJson, digest, activeAccount });
      }
      if (pathname === "/api/workspace" && method === "GET") {
        return json(res, 200, snapshot(account));
      }
      if (pathname === "/api/workspace" && method === "PUT") {
        const payload = await readJson(req);
        if (payload?.account && payload.account !== account.id) return json(res, 401, { error: "Акаунт змінився." });
        if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0)
          return json(res, 400, { error: "Відсутня версія даних." });
        try {
          validateTracker(payload.tracker);
        } catch {
          return json(res, 400, { error: "Некоректна копія трекера." });
        }
        const updated = coach.transaction(() => {
          const current = activeAccount(db, req);
          if (!current || current.id !== account.id || coach.suspended(account.id)) return false;
          if (current.revision !== payload.revision) return false;
          db.prepare("UPDATE workspace_accounts SET tracker = ?, revision = revision + 1 WHERE id = ?")
            .run(JSON.stringify(payload.tracker), account.id);
          coach.logChanges(account.id, JSON.parse(current.tracker), payload.tracker);
          return true;
        });
        if (!updated) {
          const current = activeAccount(db, req);
          if (current?.id !== account.id) return json(res, 401, { error: "Сесію закрито." });
          if (coach.suspended(account.id)) return json(res, 403, { error: "Доступ до трекера призупинено." });
          if (current.tracker === JSON.stringify(payload.tracker)) return json(res, 200, { revision: current.revision });
          return json(res, 409, { error: "На іншому пристрої вже збережено зміни." });
        }
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

module.exports = { startSession, identifyGoogleAccount, openWorkspaces, provision, workspaceApi, activeAccount, snapshot, configureCoach };
