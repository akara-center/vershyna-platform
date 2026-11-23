const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(["route.js", "pilot-core.js"]
  .map((name) => fs.readFileSync("dist/" + name, "utf8")).join("\n"), context);
const { Route, Pilot } = vm.runInContext("({ Route, Pilot })", context);

const legacy = {
  ...Pilot.empty(),
  vision: { future: "Майбутнє", goal: "Стара ціль", criteria: "Критерій",
    milestones: "Перший результат\nДругий результат", project: "m" },
};
const initialGoals = Route.goals(legacy);
assert.equal(initialGoals.length, 1);
assert.equal(initialGoals[0].milestones[0].name, legacy.vision.milestones);
assert.deepEqual(Array.from(initialGoals[0].milestones[0].projectIds), ["m"]);
const nextGoals = structuredClone(initialGoals);
nextGoals[0].name = "Оновлена ціль";
const revised = Route.revise(legacy, { future: "Інше бачення" }, nextGoals,
  "2026-11-23T09:00:00.000Z", [{ id: "m", name: "Мій проєкт" }]);
const restored = JSON.parse(JSON.stringify(revised));
Pilot.validate(restored);
assert.equal(restored.revisions[0].goals[0].name, "Стара ціль");
assert.equal(restored.revisions[0].projectNames.m, "Мій проєкт");
assert.equal(restored.goals[0].name, "Оновлена ціль");
assert.equal(Route.revise(revised, revised.vision, revised.goals, "2026-11-23T09:01:00.000Z", []), revised);
assert.throws(() => Pilot.validate({ ...restored, goals: [...restored.goals, ...restored.goals] }));
assert.throws(() => Pilot.validate({ ...restored, goals: [{ ...restored.goals[0], projectIds: ["m", "m"] }] }));
