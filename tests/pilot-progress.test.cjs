const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("../dist/quest-core.js");
const appSource = require("./helpers/app-source.cjs")();
const context = vm.createContext({ QuestCore, Date, TextEncoder, structuredClone });
vm.runInContext(appSource.slice(0, appSource.indexOf("\ninitializeState();")), context);
const { Pilot, CoachPackage } = vm.runInContext("({ Pilot, CoachPackage })", context);
const day = "2026-11-23";
const at = day + "T10:00:00Z";
const step = (id) => ({ id, name: id, minutes: 10, result: "", xp: 25, done: false });
const project = { id: "project", name: "Проєкт", goal: "", focusId: "child", steps: [
  { ...step("group"), xp: 50, inactive: true, children: [
    step("child"), { ...step("finished"), done: true },
  ] },
  step("next"),
] };
const snapshot = { schemaVersion: 4, theme: "dark", active: project.id, missions: [project] };
assert.equal(QuestCore.nextAction(project).id, "next");
assert.equal(QuestCore.earned(project.steps[0]), 25);
assert.equal(QuestCore.missionDone(project), false);
assert.equal(Pilot.actions([project]).find((item) => item.id === "child").inactive, true);
assert.equal(Pilot.actions([project]).find((item) => item.id === "child").canFocus, false);
delete project.steps[0].inactive;
assert.equal(QuestCore.nextAction(project).id, "child");

const journal = Pilot.empty();
const before = Pilot.actions([project]);
project.steps[1].done = true;
Pilot.recordCompletion(journal, before, Pilot.actions([project]), at);
const completed = Pilot.actions([project]);
project.steps[1].done = false;
Pilot.recordCompletion(journal, completed, Pilot.actions([project]), day + "T11:00:00Z");
assert.equal(Pilot.results(journal, day, day).length, 0);
assert.equal(journal.completions[0].projectId, project.id);
assert.ok(journal.completions[0].reversedAt);

const source = fs.readFileSync("dist/example-coach-route.json", "utf8");
const packet = CoachPackage.parse(source);
const previous = { ...snapshot, pilot: { ...Pilot.empty(), vision: { horizon: "Мій горизонт" } } };
let id = 0;
const apply = (snapshot, packet) => CoachPackage.draft(snapshot, packet, () => "new-" + ++id, at);
const updated = apply(previous, packet);
assert.equal(previous.missions.length, 1);
assert.equal(updated.missions.length, 2);
assert.equal(updated.pilot.vision.horizon, "Мій горизонт");
assert.equal(updated.pilot.goals[0].milestones[0].projectIds[0], updated.missions[1].id);
assert.equal(updated.missions[1].steps[0].done, false);
assert.equal(updated.pilot.coachImports[0].materials[0].title, packet.materials[0].title);
assert.throws(() => apply(updated, packet), /уже застосовано/);
assert.throws(() => CoachPackage.parse(source.replace('["project"]', '["чужий"]')), /поза пакетом/);
assert.throws(() => CoachPackage.parse(source.replace('"id": "action"', '"id": "project"')), /ідентифікатори/);
assert.ok(CoachPackage.validSettings({telegram:"demo_coach", whatsapp:"380000000000", support:true, rhythm:"Щоп’ятниці"}));
assert.ok(!CoachPackage.validSettings({telegram:"https://example.com", whatsapp:"", support:false, rhythm:""}));
