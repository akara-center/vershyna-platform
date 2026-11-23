const assert = require("node:assert/strict");
const test = require("node:test");
const C = require("../dist/collaboration.js");

const at = "2026-11-23T10:00:00Z";
const add = (state, role, id, text, parent) =>
  C.change(state, role, { op: "add", id, label: id, text, parent }, at);
const edit = (state, role, id, text) => C.change(state, role, { op: "edit", id, text }, at);
function start() {
  const state = { trackerId: null, trackers: [], contracts: [], proposals: [], notes: [], seq: 0 };
  C.start(state, { id: "first", trackerId: "tracker", initial: true });
  add(state, "coach", "vision", "Initial vision");
  add(state, "coach", "goal", "one walk", "vision");
  C.current(state).phase = "shared";
  return state;
}

test("Різниця одного слова, додавання й видалення, приховування вкладених змін", () => {
  const state = start();
  edit(state, "client", "goal", "two walks");
  add(state, "client", "detail", "private detail", "vision");
  C.change(state, "client", { op: "delete", id: "detail" }, at);
  assert.deepEqual(C.coachView(state).events.map((e) => e.operation), ["edit", "add", "delete"]);
  assert.equal(C.coachView(state).unread, 3);
  assert.deepEqual(C.diff("go once today", "go twice today"), {
    prefix: "go ", removed: "on", added: "twi", suffix: "ce today",
  });
  C.current(state).read.push(3);
  assert.equal(C.coachView(state).unread, 2);
  C.tracker(state).private.push("vision");
  assert.deepEqual(C.coachView(state), { blocks: [], events: [], proposals: [], unread: 0 });
});

test("Пропозиції застосовуються вибірково й відхиляють застарілу редакцію", () => {
  let state = start();
  assert.throws(() => edit(state, "coach", "goal", "overwrite"), /пропозицію/);
  C.propose(state, "proposal", [{ id: "goal", text: "three walks" },
    { id: "new", operation: "add", parent: "vision", label: "New step", text: "Prepare shoes" }]);
  C.message(state, "client", "proposal", "Коли?");
  state = C.decide(state, "proposal", ["new"], at);
  assert.equal(C.tracker(state).blocks.find((item) => item.id === "goal").text, "one walk");
  assert.equal(C.tracker(state).blocks.find((item) => item.id === "new").parent, "vision");
  edit(state, "client", "goal", "two walks");
  assert.throws(() => C.decide(state, "proposal", ["goal"], at), /Блок змінився/);
  C.tracker(state).private.push("goal");
  assert.deepEqual(C.coachView(state).proposals[0].rows.map((row) => row.id), ["new"]);
  assert.deepEqual(C.coachView(state).proposals[0].messages, []);
});

test("Завершення забирає спільний доступ, новий контракт і трекер зберігають старі записи", () => {
  const state = start();
  state.notes.push({ id: "note", text: "private note" });
  C.finish(state);
  edit(state, "client", "goal", "two walks");
  assert.deepEqual(C.coachView(state).blocks, []);
  assert.equal(state.notes.length, 1);
  C.start(state, { id: "second", trackerId: "tracker", scopes: ["goal"] });
  assert.deepEqual(C.coachView(state).blocks.map(({ id, parent }) => [id, parent]), [["goal", null]]);
  assert.deepEqual(C.coachView(state).events, []);
  C.finish(state);
  C.start(state, { id: "third", trackerId: "another", initial: true });
  assert.equal(C.tracker(state).blocks.length, 0);
  C.change(state, "client", { op: "edit", trackerId: "tracker", id: "goal", text: "four walks" }, at);
  assert.equal(C.tracker(state, "tracker").blocks.at(-1).text, "four walks");
  assert.deepEqual(C.coachView(state).events, []);
});
