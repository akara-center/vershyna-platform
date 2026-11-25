"use strict";

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const { openAsBlob } = require("node:fs");

const scope = "https://www.googleapis.com/auth/drive.file";
const folderMime = "application/vnd.google-apps.folder";
const sqliteMime = "application/vnd.sqlite3";
const apiBase = "https://www.googleapis.com/drive/v3/files";
const uploadBase = "https://www.googleapis.com/upload/drive/v3/files";
const ownerId = "kateryna-coach";
const token = () => randomBytes(32).toString("base64url");

function setupDriveBackup(db, origin, coach, options = {}) {
  const { clientId, clientSecret, encryptionKey, request = fetch } = options;
  const key = Buffer.from(encryptionKey || "", "base64url");
  const enabled = Boolean(clientId && clientSecret && key.length === 32);
  const callback = origin + "/api/drive-backup/callback";
  let busy = false;
  let retryAt = 0;
  let connectInProgress = false;
  let notify = () => {};

  db.exec(`CREATE TABLE IF NOT EXISTS drive_backup_connections (
    id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL, folder TEXT NOT NULL,
    last_date TEXT, error TEXT
  );
  CREATE TABLE IF NOT EXISTS drive_backup_attempt (
    id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, session TEXT NOT NULL,
    verifier TEXT NOT NULL, expires INTEGER NOT NULL
  );`);
  const connection = () => db.prepare("SELECT * FROM drive_backup_connections WHERE id = 1").get();

  function encrypt(value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    return Buffer.concat([nonce, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  }

  function decrypt(value) {
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8");
  }

  async function exchange(params) {
    const response = await request("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
    });
    const value = await response.json();
    if (!response.ok || !value.access_token)
      throw Object.assign(Error("Google authorization failed"), { reconnect: value.error === "invalid_grant" });
    return value;
  }

  function drive(accessToken, url, options = {}) {
    return request(url, {
      ...options, redirect: "error", signal: AbortSignal.timeout(options.body instanceof Blob ? 120000 : 15000),
      headers: { Authorization: "Bearer " + accessToken, ...options.headers },
    });
  }

  async function findFile(accessToken, query, fields = "id") {
    const params = new URLSearchParams({
      q: query + " and trashed = false",
      fields: "files(" + fields + ")", pageSize: "1",
    });
    const response = await drive(accessToken, apiBase + "?" + params);
    if (!response.ok) throw Error("Google Drive listing failed");
    return (await response.json()).files[0];
  }

  async function folderFor(accessToken) {
    const folder = await findFile(accessToken,
      "'root' in parents and mimeType = '" + folderMime + "' and appProperties has { key='vershyna' and value='backup-folder' }");
    if (folder) return folder.id;
    const response = await drive(accessToken, apiBase + "?fields=id", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Вершина — резервні копії", mimeType: folderMime,
        appProperties: { vershyna: "backup-folder" },
      }),
    });
    if (!response.ok) throw Error("Google Drive folder creation failed");
    return (await response.json()).id;
  }

  async function upload(accessToken, folder, date, slot, withSnapshot) {
    if (!/^[A-Za-z0-9_-]+$/.test(folder)) throw Error("Invalid Google Drive folder");
    const existing = await findFile(accessToken,
      "'" + folder + "' in parents and appProperties has { key='vershynaSlot' and value='" + slot + "' }",
      "id,appProperties");
    if (existing?.appProperties?.backupDate === date) return;

    await withSnapshot(async (file) => {
      const body = await openAsBlob(file, { type: sqliteMime });
      const meta = {
        name: "vershyna-" + date + ".sqlite", mimeType: sqliteMime,
        appProperties: { vershynaSlot: slot, backupDate: date },
      };
      if (!existing) meta.parents = [folder];
      const url = uploadBase + (existing ? "/" + encodeURIComponent(existing.id) : "") + "?uploadType=resumable&fields=id";
      const session = await drive(accessToken, url, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "X-Upload-Content-Type": sqliteMime,
          "X-Upload-Content-Length": String(body.size) },
        body: JSON.stringify(meta),
      });
      const location = session.headers.get("location");
      if (!session.ok || !location || !/^https:\/\/www\.googleapis\.com\/upload\//.test(location)) throw Error("Google Drive upload session failed");
      await session.body?.cancel();
      const result = await drive(accessToken, location, {
        method: "PUT", headers: { "Content-Type": sqliteMime, "Content-Length": String(body.size) }, body,
      });
      await result.body?.cancel();
      if (!result.ok) throw Error("Google Drive upload failed");
    });
  }

  return {
    enabled,
    onConnect(listener) { notify = listener; },
    async check(date, slot, withSnapshot) {
      if (!enabled || busy || connectInProgress || Date.now() < retryAt) return false;
      const row = connection();
      if (!row || row.error === "reconnect") return false;
      if (row.last_date === date) return true;
      busy = true;
      try {
        const { access_token: accessToken } = await exchange({
          grant_type: "refresh_token", refresh_token: decrypt(row.token),
        });
        await upload(accessToken, row.folder, date, slot, withSnapshot);
        db.prepare("UPDATE drive_backup_connections SET last_date = ?, error = NULL WHERE id = 1").run(date);
        console.info("Резервну копію Вершини збережено в Google Drive: " + date);
        return true;
      } catch (error) {
        retryAt = Date.now() + 15 * 60000;
        db.prepare("UPDATE drive_backup_connections SET error = ? WHERE id = 1")
          .run(error.reconnect ? "reconnect" : "retry");
        console.warn("Не вдалося зберегти резервну копію Вершини в Google Drive.");
        return false;
      } finally {
        busy = false;
      }
    },
    async api(req, res, pathname, account, { json, digest, activeAccount }) {
      const permitted = enabled && account.id === ownerId && coach.role(account.id) === "coach";
      if (pathname === "/api/drive-backup/status" && req.method === "GET") {
        const row = permitted && connection();
        return json(res, 200, {
          enabled: permitted, connected: Boolean(row), lastDate: row?.last_date ?? null, error: row?.error ?? null,
          folder: row && /^[A-Za-z0-9_-]+$/.test(row.folder) ? "https://drive.google.com/drive/folders/" + row.folder : null,
        });
      }
      if (!permitted) return json(res, 403, { error: "Керування копіями доступне власниці Вершини." });
      if (pathname === "/api/drive-backup/connect" && req.method === "POST") {
        const state = token();
        const verifier = token();
        db.prepare("INSERT OR REPLACE INTO drive_backup_attempt VALUES (1, ?, ?, ?, ?)")
          .run(state, digest, verifier, Date.now() + 600000);
        const params = new URLSearchParams({
          client_id: clientId, redirect_uri: callback, response_type: "code", scope, state,
          access_type: "offline", prompt: "select_account consent",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
        });
        return json(res, 200, { url: "https://accounts.google.com/o/oauth2/v2/auth?" + params });
      }
      if (pathname === "/api/drive-backup/connect" && req.method === "DELETE") {
        if (busy || connectInProgress) return json(res, 409, { error: "Триває підключення або запис копії. Спробуй ще раз." });
        coach.transaction(() => {
          db.exec("DELETE FROM drive_backup_connections; DELETE FROM drive_backup_attempt;");
        });
        return json(res, 200, {});
      }
      if (pathname === "/api/drive-backup/callback" && req.method === "GET") {
        const url = new URL(req.url, origin);
        const redirect = (result) => res.writeHead(303, { Location: "/account?driveBackup=" + result,
          "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end();
        const attempt = db.prepare("DELETE FROM drive_backup_attempt WHERE state = ? AND session = ? AND expires > ? RETURNING verifier")
          .get(url.searchParams.get("state") || "", digest, Date.now());
        const code = url.searchParams.get("code");
        if (!attempt || !code || busy || connectInProgress) return redirect("error");
        connectInProgress = true;
        try {
          const tokens = await exchange({ code, code_verifier: attempt.verifier,
            grant_type: "authorization_code", redirect_uri: callback });
          if (!tokens.refresh_token || !String(tokens.scope || "").split(" ").includes(scope)) return redirect("error");
          if (activeAccount(db, req)?.id !== ownerId) return redirect("error");
          const folder = await folderFor(tokens.access_token);
          if (activeAccount(db, req)?.id !== ownerId) return redirect("error");
          db.prepare("INSERT OR REPLACE INTO drive_backup_connections VALUES (1, ?, ?, NULL, NULL)")
            .run(encrypt(tokens.refresh_token), folder);
          retryAt = 0;
          setImmediate(notify);
          return redirect("connected");
        } catch {
          return redirect("error");
        } finally {
          connectInProgress = false;
        }
      }
      return json(res, 404, { error: "Невідома дія." });
    },
  };
}

module.exports = { setupDriveBackup };
