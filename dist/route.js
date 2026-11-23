"use strict";

const Route = (() => {
  const visionLabels = {
    future: "Я і моє майбутнє",
    present: "Точка А · ситуація, ресурси й опори",
    values: "Цінності й сенси",
    qualities: "Якості, навички й стан",
    horizon: "Результат на горизонті співпраці",
    beyond: "Бачення за межами співпраці",
    image: "Мій образ або метафора",
    persona: "Ім’я мого персонажа",
  };
  const goalFields = {
    name: "Назва цілі",
    why: "Чому це важливо",
    change: "Що зміниться",
    criteria: "Як я помічу результат",
  };

  function goals({ vision, goals: saved }) {
    if (saved) return saved;
    if (![vision.goal, vision.criteria, vision.milestones, vision.project].some(Boolean)) return [];
    const projectIds = vision.project ? [vision.project] : [];
    return [{
      id: "legacy-goal", name: vision.goal || "Моя ціль", why: "", change: "",
      criteria: vision.criteria || "", projectIds: vision.milestones ? [] : projectIds,
      milestones: vision.milestones
        ? [{ id: "legacy-milestone", name: vision.milestones, projectIds }]
        : [],
    }];
  }

  function valid(goals) {
    if (goals === undefined) return true;
    const ids = new Set();
    const list = (entries) => Array.isArray(entries) && entries.length <= 500;
    const links = (entries) => list(entries) && new Set(entries).size === entries.length &&
      entries.every((id) => typeof id === "string" && id);
    const item = (row) => {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
          typeof row.name !== "string" || !row.name.trim() || !links(row.projectIds)) return false;
      ids.add(row.id);
      return true;
    };
    return list(goals) && goals.every((goal) => item(goal) &&
      ["why", "change", "criteria"].every((key) => typeof goal[key] === "string") &&
      list(goal.milestones) && goal.milestones.every(item));
  }

  function revise(data, vision, nextGoals, at, projects) {
    if (JSON.stringify(vision) === JSON.stringify(data.vision) &&
        JSON.stringify(nextGoals) === JSON.stringify(goals(data))) return data;
    const current = goals(data);
    const linked = new Set(current.flatMap((goal) => [
      ...goal.projectIds, ...goal.milestones.flatMap((milestone) => milestone.projectIds),
    ]));
    const projectNames = Object.fromEntries(projects.filter((project) => linked.has(project.id))
      .map((project) => [project.id, project.name]));
    const revisions = Object.keys(data.vision).length || current.length
      ? [...data.revisions, { at, vision: data.vision, goals: current, projectNames }]
      : data.revisions;
    return { ...data, vision, goals: nextGoals, revisions };
  }

  function validNames(names) {
    return names === undefined || (names && typeof names === "object" &&
      !Array.isArray(names) && Object.values(names).every((name) => typeof name === "string"));
  }

  return { visionLabels, goalFields, goals, valid, revise, validNames };
})();
