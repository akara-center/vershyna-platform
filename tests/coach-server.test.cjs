const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");
const { createServer } = require("../server/start.cjs");

test("Ролі, передача трекера, приватні гілки, пропозиції та повторний контракт", async (t) => {
  const db = openWorkspaces(":memory:");
  const coachKey = provision(db, "coach", "coach");
  const clientKey = provision(db, "client");
  const otherKey = provision(db, "other", "coach");
  const origin = "http://127.0.0.1";
  const server = createServer(db, origin);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = origin + ":" + server.address().port;
  async function call(route, cookie, body, method = body === undefined ? "GET" : "POST", expected = 200) {
    const response = await fetch(base + route, {
      method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected, route + " " + await response.clone().text());
    return response;
  }
  async function login(key) {
    return (await call("/api/session", null, { key })).headers.get("set-cookie").split(";")[0];
  }
  const coach = await login(coachKey);
  const client = await login(clientKey);
  const other = await login(otherKey);
  const contracts = "/api/coach/contracts";
  const created = await (await call(contracts, coach, { client: "client" })).json();
  const detail = contracts + "/" + created.id;
  const info = async (cookie) => (await call(detail, cookie)).json();
  const work = async () => (await call("/api/workspace", client)).json();
  const change = async (payload, expected) => call(detail, coach, payload, "POST", expected);

  await call(detail, other, undefined, "GET", 404);
  const otherClient = await login(provision(db, "other-client"));
  const otherCreated = await (await call(contracts, other, { client: "other-client" })).json();
  await call(contracts + "/" + otherCreated.id, otherClient);
  await call(contracts + "/" + otherCreated.id, coach, undefined, "GET", 404);
  assert.deepEqual((await (await call(contracts, other)).json()).contracts.map(({ id }) => id), [otherCreated.id]);
  assert.deepEqual((await (await call(contracts, coach)).json()).contracts.map(({ id }) => id), [created.id]);
  const packet = fs.readFileSync(path.resolve(__dirname, "../dist/example-coach-route.json"), "utf8");
  await change({ action: "setup", package: packet });
  const { tracker, revision } = await work();
  assert.ok(tracker.missions.length > 0);
  const project = tracker.missions[0];
  const task = project.steps[0];
  const block = "step:" + task.id;
  await change({ action: "handoff" });
  await change({ action: "setup", package: packet }, 403);
  task.result = "Попередній результат";
  await call("/api/workspace", client, { tracker, revision }, "PUT");
  assert.ok((await info(coach)).events.some((row) => row.after?.result === "Попередній результат"));
  await change({ action: "propose", changes: [
    { block, field: "result", text: "Пропозиція результату" },
    { block, field: "new-step", text: "Новий підкрок" },
  ] });
  const proposal = (await info(client)).proposals[0];
  await call(detail, client, { action: "accept", id: proposal.id, changes: [proposal.changes[0].id] });
  const accepted = await work();
  assert.equal(accepted.tracker.missions[0].steps[0].result, "Пропозиція результату");
  assert.equal((await info(client)).proposals[0].changes[1].status, "pending");
  await call(detail, client, { action: "visibility", block: "project:" + project.id, private: true });
  const privateView = await info(coach);
  assert.equal(privateView.blocks.some((row) => row.id === block), false);
  assert.equal(privateView.events.length, 0);
  assert.equal(privateView.proposals.length, 0);
  assert.equal(privateView.unread, 0);
  await change({ action: "read" });
  await call(detail, client, { action: "visibility", block: "project:" + project.id, private: false });
  assert.ok((await info(coach)).unread > 0);
  await call(detail, client, { action: "accept", id: proposal.id, changes: [proposal.changes[1].id] });
  assert.ok((await work()).tracker.missions[0].steps[0].children.some((item) => item.name === "Новий підкрок"));
  await change({ action: "archive-note", text: "Приватна нотатка коуча" });
  assert.equal((await info(client)).notes.length, 0);
  await change({ action: "suspend", enabled: true });
  await call("/api/workspace", client, undefined, "GET", 403);
  await call("/api/workspace", client, { tracker, revision }, "PUT", 403);
  await change({ action: "finish" });
  assert.equal((await info(coach)).blocks.length, 0);
  assert.equal((await info(coach)).notes[0].text, "Приватна нотатка коуча");
  await change({ action: "suspend", enabled: false });
  const next = await (await call(contracts, client, { coach: "coach", scopes: [block] })).json();
  const scoped = await (await call(contracts + "/" + next.id, coach)).json();
  assert.equal(scoped.blocks[0].id, block);
  assert.equal(scoped.blocks[0].parent, null);
  assert.equal(scoped.blocks.some((row) => row.id.startsWith("project:")), false);
  await call(contracts + "/" + next.id, coach, { action: "finish" });
  await call(contracts, client, { coach: "coach", fresh: true });
  const data = await (await call(contracts, client)).json();
  assert.equal(data.archives.length, 1);
  assert.equal((await work()).tracker, null);
  const archive = "/api/coach/previous/" + data.archives[0].id;
  assert.equal((await (await call(archive, client)).json()).missions[0].id, project.id);
  await call(archive, coach, undefined, "GET", 404);
  const independent = await login(provision(db, "independent"));
  await call("/api/workspace", independent, { tracker, revision: 0 }, "PUT");
  await call(contracts, coach, { client: "independent" }, "POST", 403);
  await call(contracts, independent, { coach: "coach", scopes: [] }, "POST", 400);
  const firstShared = await (await call(contracts, independent, { coach: "coach", scopes: [block] })).json();
  const firstSharedPath = contracts + "/" + firstShared.id;
  const firstSharedView = await (await call(firstSharedPath, coach)).json();
  assert.equal(firstSharedView.phase, "shared");
  assert.deepEqual(firstSharedView.blocks.map(({ id }) => id), [block]);
  await call(firstSharedPath, independent, { action: "finish" });
  assert.deepEqual((await (await call(firstSharedPath, coach)).json()).blocks, []);
  assert.ok((await (await call("/api/workspace", independent)).json()).tracker);
  provision(db, "client", "client", true);
  await call("/api/workspace", client, undefined, "GET", 401);
});
