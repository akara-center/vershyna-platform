"use strict";

const { createHash, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { googleCalendar, reconcile } = require("./calendar-sync.cjs");

function setupCalendar(db, origin, { clientId, clientSecret, encryptionKey, request = globalThis.fetch } = {}, coach) {
  const enabled = Boolean(clientId && clientSecret && encryptionKey);
  const key = enabled && Buffer.from(encryptionKey, "base64url");
  if (enabled && key.length !== 32) throw Error("VERSHYNA_GOOGLE_TOKEN_KEY має містити 32 байти у base64url.");
  const redirect = origin + "/api/calendar/callback";
  const scope = "https://www.googleapis.com/auth/calendar.events.owned";

  db.exec(`CREATE TABLE IF NOT EXISTS calendar_oauth (
    nonce TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES workspace_accounts(id), session TEXT NOT NULL,
    verifier TEXT NOT NULL, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_connections (
    account_id TEXT PRIMARY KEY REFERENCES workspace_accounts(id), refresh_token TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_links (
    account_id TEXT NOT NULL REFERENCES workspace_accounts(id), task_id TEXT NOT NULL,
    event_id TEXT NOT NULL, slot TEXT NOT NULL, base TEXT, status TEXT NOT NULL, conflict TEXT,
    PRIMARY KEY (account_id, task_id)
  );`);

  function encrypt(text, account) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(account));
    return Buffer.concat([iv, cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  }

  function decrypt(encoded, account) {
    const bytes = Buffer.from(encoded, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(account));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8");
  }

  async function exchange(params) {
    const response = await request("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw Error("Google не підтвердив доступ до календаря.");
    return result;
  }

  function connection(account) {
    return db.prepare("SELECT refresh_token FROM calendar_connections WHERE account_id = ?").get(account);
  }

  function linkFor(account, taskId) {
    return db.prepare("SELECT * FROM calendar_links WHERE account_id = ? AND task_id = ?").get(account, taskId);
  }

  function current(account) {
    return db.prepare("SELECT tracker, revision FROM workspace_accounts WHERE id = ?").get(account);
  }

  function taskIn(tracker, taskId) {
    for (const mission of tracker?.missions || []) {
      const task = QuestCore.find(mission.steps, taskId)?.node;
      if (task) return task;
    }
    return null;
  }

  function parseSlot(input) {
    if (typeof input?.start !== "string" || typeof input.end !== "string") return null;
    const start = new Date(input.start);
    const end = new Date(input.end);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) return null;
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function viewLink(row) {
    return row && { slot: JSON.parse(row.slot), status: row.status, conflict: row.conflict ? JSON.parse(row.conflict) : null };
  }

  const active = new Set();
  const lastSync = new Map();

  async function sync(account, onlyTask, choices) {
    if (active.has(account)) return;
    const connected = connection(account);
    if (!enabled || !connected || coach.suspended(account)) return;
    active.add(account);
    try {
      const tokens = await exchange({ grant_type: "refresh_token", refresh_token: decrypt(connected.refresh_token, account) });
      const calendar = googleCalendar({ accessToken: tokens.access_token, calendarId: "primary",
        fetch: (url, options) => request(url, { ...options, signal: AbortSignal.timeout(10000) }) });
      const links = onlyTask ? [linkFor(account, onlyTask)].filter(Boolean) :
        db.prepare("SELECT * FROM calendar_links WHERE account_id = ? AND status != 'unscheduled'").all(account);
      for (const row of links) {
        const saved = current(account);
        const tracker = JSON.parse(saved.tracker);
        const task = taskIn(tracker, row.task_id);
        if (!task) {
          db.prepare("UPDATE calendar_links SET status = 'unavailable' WHERE account_id = ? AND task_id = ?").run(account, row.task_id);
          continue;
        }
        const value = { title: task.name, ...JSON.parse(row.slot) };
        let result;
        try {
          if (!row.base) {
            try {
              await calendar.create(row.event_id, value);
            } catch (error) {
              if (error.status !== 409) throw error;
            }
            result = await reconcile(calendar, { eventId: row.event_id, base: value, tracker: value, choices });
          } else {
            result = await reconcile(calendar, { eventId: row.event_id, base: JSON.parse(row.base), tracker: value, choices });
          }
        } catch {
          result = { status: "unavailable" };
        }
        if (coach.suspended(account) || !connection(account) || current(account).revision !== saved.revision || linkFor(account, row.task_id)?.event_id !== row.event_id) continue;
        db.exec("BEGIN IMMEDIATE");
        try {
          if (result.status === "synced") {
            const { title, start, end } = result.value;
            if (task.name !== title) {
              const before = structuredClone(tracker);
              task.name = title;
              QuestCore.validate(tracker);
              coach.logChanges(account, before, tracker);
              db.prepare("UPDATE workspace_accounts SET tracker = ?, revision = revision + 1 WHERE id = ?")
                .run(JSON.stringify(tracker), account);
            }
            db.prepare("UPDATE calendar_links SET base = ?, slot = ?, status = 'synced', conflict = NULL WHERE account_id = ? AND task_id = ?")
              .run(JSON.stringify(result.value), JSON.stringify({ start, end }), account, row.task_id);
          } else {
            db.prepare("UPDATE calendar_links SET status = ?, conflict = ? WHERE account_id = ? AND task_id = ?")
              .run(result.status, result.status === "conflict" ? JSON.stringify(result) : null, account, row.task_id);
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
    } finally {
      active.delete(account);
    }
  }

  function background(account) {
    if (!enabled || active.has(account) || Date.now() - (lastSync.get(account) || 0) < 60000) return;
    lastSync.set(account, Date.now());
    void sync(account).catch(() => {});
  }

  return async (req, res, pathname, account, { json, readJson, digest }) => {
    const url = new URL(req.url, origin);
    const id = account.id;
    const method = req.method;
    if (pathname === "/api/calendar/status" && method === "GET") {
      const connected = enabled && Boolean(connection(id));
      if (connected) background(id);
      const taskId = url.searchParams.get("task");
      return json(res, 200, { enabled, connected, link: taskId ? viewLink(linkFor(id, taskId)) : null });
    }
    if (!enabled) return json(res, 503, { error: "Google Calendar ще не налаштовано на сервері." });
    if (pathname === "/api/calendar/connect" && method === "POST") {
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      db.prepare("DELETE FROM calendar_oauth WHERE account_id = ? OR expires < ?").run(id, Date.now());
      db.prepare("INSERT INTO calendar_oauth VALUES (?, ?, ?, ?, ?)").run(nonce, id, digest, verifier, Date.now() + 600000);
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code",
        state: nonce, scope, access_type: "offline", prompt: "consent",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
      return json(res, 200, { url: "https://accounts.google.com/o/oauth2/v2/auth?" + params });
    }
    if (pathname === "/api/calendar/callback" && method === "GET") {
      const state = url.searchParams.get("state") ?? "";
      const row = db.prepare("DELETE FROM calendar_oauth WHERE nonce = ? AND account_id = ? AND session = ? AND expires >= ? RETURNING verifier")
        .get(state, id, digest, Date.now());
      const code = url.searchParams.get("code");
      if (!row || !code) return void res.writeHead(303, { Location: "/account?google=cancelled", "Cache-Control": "no-store" }).end();
      try {
        const tokens = await exchange({ code, code_verifier: row.verifier, grant_type: "authorization_code", redirect_uri: redirect });
        if (!tokens.refresh_token || !String(tokens.scope || "").split(" ").includes(scope))
          throw Error("Потрібен доступ до власних подій Google Calendar.");
        if (connection(id)) db.prepare("DELETE FROM calendar_links WHERE account_id = ?").run(id);
        db.prepare("INSERT OR REPLACE INTO calendar_connections VALUES (?, ?)").run(id, encrypt(tokens.refresh_token, id));
        return void res.writeHead(303, { Location: "/account?google=connected", "Cache-Control": "no-store" }).end();
      } catch {
        return void res.writeHead(303, { Location: "/account?google=error", "Cache-Control": "no-store" }).end();
      }
    }
    if (pathname === "/api/calendar/connect" && method === "DELETE") {
      if (active.has(id)) return json(res, 409, { error: "Триває синхронізація. Спробуй ще раз." });
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM calendar_connections WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM calendar_links WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM calendar_oauth WHERE account_id = ?").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return json(res, 200, {});
    }
    if (pathname === "/api/calendar/link" && method === "POST") {
      if (!connection(id)) return json(res, 409, { error: "Спочатку під’єднай Google Calendar." });
      const data = await readJson(req);
      const taskId = data?.task;
      if (typeof taskId !== "string" || !taskIn(JSON.parse(current(id).tracker), taskId))
        return json(res, 404, { error: "Збережену задачу не знайдено." });
      if (active.has(id)) return json(res, 409, { error: "Триває синхронізація. Спробуй ще раз." });
      const previous = linkFor(id, taskId);
      const slot = data.slot ? parseSlot(data.slot) : null;
      if ((data.slot || !previous) && !slot) return json(res, 400, { error: "Вкажи коректний час роботи." });
      if (previous?.status === "unscheduled" && slot)
        db.prepare("DELETE FROM calendar_links WHERE account_id = ? AND task_id = ?").run(id, taskId);
      const eventId = randomBytes(20).toString("hex");
      if (slot) db.prepare(`INSERT INTO calendar_links VALUES (?, ?, ?, ?, NULL, 'pending', NULL)
        ON CONFLICT (account_id, task_id) DO UPDATE SET slot = excluded.slot, status = 'pending'`)
        .run(id, taskId, eventId, JSON.stringify(slot));
      const choices = Object.fromEntries(Object.entries(data.choices || {}).filter(([field, choice]) =>
        ["title", "start", "end", "interval", "deleted"].includes(field) && ["tracker", "calendar"].includes(choice)));
      try { await sync(id, taskId, choices); }
      catch { return json(res, 502, { error: "Google Calendar тимчасово недоступний. Прив’язку збережено для повтору." }); }
      return json(res, 200, { link: viewLink(linkFor(id, taskId)) });
    }
    return json(res, 404, { error: "Дію календаря не знайдено." });
  };
}

module.exports = { setupCalendar };
