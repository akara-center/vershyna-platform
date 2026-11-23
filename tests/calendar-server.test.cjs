const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");
const { createServer } = require("../server/start.cjs");

test("Підключення Google належить сесії, посилання переживає повтор, події синхронізуються в обидві сторони", async (t) => {
  const db = openWorkspaces(":memory:");
  const key = provision(db, "client");
  const otherKey = provision(db, "unrelated-client");
  const origin = "http://127.0.0.1";
  const scope = "https://www.googleapis.com/auth/calendar.events.owned";
  const events = new Map();
  let codeChallenge;
  let nextStatus = "confirmed";
  let failEventWrite = false;
  const mockGoogle = async (address, options) => {
    const url = new URL(address);
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(options.body.get("client_secret"), "synthetic-secret");
      if (options.body.get("grant_type") === "authorization_code") {
        assert.equal(options.body.get("redirect_uri"), origin + "/api/calendar/callback");
        assert.equal(createHash("sha256").update(options.body.get("code_verifier")).digest("base64url"), codeChallenge);
        return Response.json({ access_token: "first-access", refresh_token: "fake-refresh", scope });
      }
      assert.equal(options.body.get("refresh_token"), "fake-refresh");
      return Response.json({ access_token: "second-access" });
    }
    assert.equal(options.headers.Authorization, "Bearer second-access");
    if (options.method === "POST") {
      const data = JSON.parse(options.body);
      const existing = events.get(data.id);
      if (existing) return Response.json({}, { status: 409 });
      events.set(data.id, { ...data, status: "confirmed", etag: "first" });
      if (failEventWrite) throw Error("Збій після створення події");
      return Response.json(events.get(data.id));
    }
    if (url.pathname.endsWith("/events")) {
      const items = [...events.values()].map(({ id }) => ({ id, status: nextStatus }));
      return Response.json({ items, nextSyncToken: "next-sync-token" });
    }
    const id = url.pathname.split("/").at(-1);
    const event = events.get(id);
    if (options.method === "PATCH") {
      assert.equal(options.headers["If-Match"], event.etag);
      const updated = { ...event, ...JSON.parse(options.body), etag: "updated" };
      events.set(id, updated);
      return Response.json(updated);
    }
    if (nextStatus === "cancelled") return Response.json({}, { status: 410 });
    return Response.json(event);
  };
  const server = createServer(db, origin, {
    clientId: "synthetic-client", clientSecret: "synthetic-secret", encryptionKey: randomBytes(32).toString("base64url"),
    request: mockGoogle,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = origin + ":" + server.address().port;
  async function call(route, cookie, body, method = body === undefined ? "GET" : "POST", status = 200) {
    const response = await fetch(base + route, {
      method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, status, route + " " + await response.clone().text());
    return response;
  }
  async function login(value) {
    return (await call("/api/session", null, { key: value })).headers.get("set-cookie").split(";")[0];
  }
  const client = await login(key);
  const unrelated = await login(otherKey);
  const root = "/api/calendar/";
  const authorize = await (await call(root + "connect", client, {})).json();
  const params = new URL(authorize.url).searchParams;
  codeChallenge = params.get("code_challenge");
  const callback = root + "callback?code=mocked&state=" + params.get("state");
  assert.equal((await call(callback, unrelated, undefined, "GET", 303)).headers.get("location"), "/account?google=cancelled");
  assert.equal((await call(callback, client, undefined, "GET", 303)).headers.get("location"), "/account?google=connected");
  assert.equal((await call(callback, client, undefined, "GET", 303)).headers.get("location"), "/account?google=cancelled");
  const getStatus = (cookie) => call(root + "status", cookie).then((response) => response.json());
  assert.equal((await getStatus(unrelated)).connected, false);
  assert.equal((await getStatus(client)).connected, true);
  assert.notEqual(db.prepare("SELECT refresh_token FROM calendar_connections WHERE account_id = 'client'").get().refresh_token, "fake-refresh");

  const tracker = { schemaVersion: 4, active: "m", theme: "dark", missions: [{
    id: "m", name: "Місія", goal: "", steps: [{ id: "s", name: "Крок", result: "", done: false, xp: 50, minutes: 10, plannedDate: "2026-12-01" }],
  }] };
  const workspace = "/api/workspace";
  await call(workspace, client, { tracker, revision: 0 }, "PUT");
  const slot = { start: "2026-12-01T09:00:00.000Z", end: "2026-12-01T10:00:00.000Z" };
  const link = async (options) => (await (await call(root + "link", client, { task: "s", ...options })).json()).link;
  failEventWrite = true;
  assert.equal((await link({ slot })).status, "unavailable");
  failEventWrite = false;
  assert.equal((await link({ slot })).status, "synced");
  assert.equal(events.size, 1);
  const [event] = events.values();
  tracker.missions[0].steps[0].name = "Назва у Вершині";
  await call(workspace, client, { tracker, revision: 1 }, "PUT");
  assert.equal((await link({})).status, "synced");
  assert.equal(events.get(event.id).summary, "Назва у Вершині");
  events.get(event.id).summary = "Назва у Google";
  assert.equal((await link({})).status, "synced");
  const updated = await (await call(workspace, client)).json();
  assert.equal(updated.tracker.missions[0].steps[0].name, "Назва у Google");
  assert.equal(updated.tracker.missions[0].steps[0].plannedDate, "2026-12-01");
  assert.equal(updated.tracker.missions[0].steps[0].xp, 50);
  nextStatus = "cancelled";
  assert.equal((await link({})).status, "unscheduled");
  assert.ok((await (await call(workspace, client)).json()).tracker.missions[0].steps[0]);
  await call(root + "connect", client, undefined, "DELETE");
  assert.equal((await getStatus(client)).connected, false);
  assert.equal(events.size, 1);
});
