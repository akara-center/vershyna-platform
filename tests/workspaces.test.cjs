const test = require("node:test");
const assert = require("node:assert/strict");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");
const { createServer } = require("../server/start.cjs");

test("Два пристрої читають копію акаунта, чужий доступ і застарілий запис відхиляються", async () => {
  const db = openWorkspaces(":memory:");
  const keys = [provision(db, "client-one"), provision(db, "client-two")];
  const origin = "http://127.0.0.1";
  const server = createServer(db, origin);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (route, method = "GET", payload, Cookie, requestOrigin = origin) => fetch(base + route, {
    method, headers: { Origin: requestOrigin, ...(Cookie ? { Cookie } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  async function login(key) {
    const res = await call("/api/session", "POST", { key });
    assert.equal(res.status, 200);
    const header = res.headers.get("set-cookie");
    assert.match(header, /HttpOnly; SameSite=Strict/);
    return header.split(";")[0];
  }
  try {
    assert.equal((await call("/account")).status, 200);
    assert.equal((await call("/api/workspace")).status, 401);
    assert.equal((await call("/api/session", "POST", { key: keys[0] }, undefined, "https://example.com")).status, 403);
    const first = await login(keys[0]);
    const second = await login(keys[0]);
    const other = await login(keys[1]);
    const tracker = { schemaVersion: 4, active: null, theme: "dark", missions: [] };
    assert.equal((await call("/api/workspace", "PUT", { revision: 0, tracker: {} }, first)).status, 400);
    assert.equal((await call("/api/workspace", "PUT", { revision: 0, tracker }, first)).status, 200);
    assert.deepEqual(await (await call("/api/workspace", "GET", undefined, second)).json(),
      { account: "client-one", revision: 1, tracker });
    assert.equal((await call("/api/workspace", "PUT", { revision: 0, tracker }, second)).status, 409);
    assert.deepEqual(await (await call("/api/workspace?account=client-one", "GET", undefined, other)).json(),
      { account: "client-two", revision: 0, tracker: null });
    await call("/api/session", "DELETE", undefined, first);
    assert.equal((await call("/api/workspace", "GET", undefined, first)).status, 401);
    assert.equal((await call("/api/workspace", "GET", undefined, second)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
