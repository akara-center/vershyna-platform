"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createServer } = require("../server/start.cjs");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");

test("owner authorizes a separate Drive and the backup scheduler sends SQLite", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "vershyna-drive-test-"));
  const dbPath = path.join(folder, "source.sqlite");
  const db = openWorkspaces(dbPath);
  const origin = "https://vershyna.example";
  let snapshot;
  let authorization;
  const server = createServer(db, origin, undefined, undefined, {
    dbPath, clientId: "app", clientSecret: "secret", encryptionKey: Buffer.alloc(32, 1).toString("base64url"),
    request: async (url, options) => {
      if (url === "https://oauth2.googleapis.com/token") {
        if (options.body.get("grant_type") === "authorization_code") {
          assert.equal(options.body.get("redirect_uri"), origin + "/api/drive-backup/callback");
          assert.equal(options.body.get("code"), "grant");
          assert.equal(authorization.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
        } else assert.equal(options.body.get("refresh_token"), "drive-refresh");
        return Response.json({ access_token: "drive-token", refresh_token: "drive-refresh",
          scope: "https://www.googleapis.com/auth/drive.file" });
      }
      assert.equal(options.headers.Authorization, "Bearer drive-token");
      if (url.includes("upload_id=")) {
        assert.equal(options.method, "PUT");
        snapshot = Buffer.from(await options.body.arrayBuffer());
        return Response.json({ id: "copy" });
      }
      if (url.includes("uploadType=resumable")) {
        assert.deepEqual(JSON.parse(options.body).parents, ["private-folder"]);
        return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } });
      }
      if (options.method === "POST") {
        assert.equal(JSON.parse(options.body).name, "Вершина — резервні копії");
        return Response.json({ id: "private-folder" });
      }
      return Response.json({ files: [] });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(folder, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (route, { cookie, method = "GET", body } = {}) => fetch(base + route, {
    method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body,
  });
  const login = async (id, role) => {
    const key = provision(db, id, role);
    const response = await request("/api/session", { method: "POST", body: JSON.stringify({ key }) });
    return response.headers.getSetCookie()[0].split(";")[0];
  };
  const guest = await login("other-coach", "coach");
  const owner = await login("kateryna-coach", "coach");
  assert.equal((await request("/api/drive-backup/connect", { cookie: guest, method: "POST" })).status, 403);
  const start = await request("/api/drive-backup/connect", { cookie: owner, method: "POST" });
  authorization = new URL((await start.json()).url);
  assert.equal(authorization.searchParams.get("prompt"), "select_account consent");
  const route = "/api/drive-backup/callback?code=grant&state=" + authorization.searchParams.get("state");
  assert.equal((await request(route, { cookie: guest })).status, 403);
  assert.equal((await request(route, { cookie: owner })).headers.get("location"), "/account?driveBackup=connected");
  assert.equal((await request(route, { cookie: owner })).headers.get("location"), "/account?driveBackup=error");
  let status;
  for (let attempt = 0; attempt < 60; attempt++) {
    status = await (await request("/api/drive-backup/status", { cookie: owner })).json();
    if (status.lastDate) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(status.lastDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(status.folder, "https://drive.google.com/drive/folders/private-folder");
  assert.equal(snapshot.subarray(0, 15).toString(), "SQLite format 3");
  assert.notEqual(db.prepare("SELECT token FROM drive_backup_connections").get().token, "drive-refresh");
  assert.equal((await request("/api/drive-backup/connect", { cookie: owner, method: "DELETE" })).status, 200);
});
