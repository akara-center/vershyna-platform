"use strict";

const CoachPackage = (() => {
  const maxBytes = 256 * 1024;
  const types = { observation: "Спостереження", question: "Запитання", suggestion: "Пропозиція" };

  function parse(raw) {
    function requireValue(ok, message) {
      if (!ok) throw Error(message);
    }
    function read(value, label, limit = 2000, required = false) {
      requireValue(typeof value === "string" && value.length <= limit && (!required || value.trim()), label);
      return value.trim();
    }
    function list(value, limit, label) {
      requireValue(Array.isArray(value) && value.length <= limit, label);
      return value;
    }
    requireValue(new TextEncoder().encode(raw).length <= maxBytes, "Пакет має бути меншим за 256 КБ.");
    const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
    requireValue(value && value.type === "vershyna-coach-route" && value.version === 1,
      "Потрібен пакет маршруту коуча версії 1.");
    const id = read(value.id, "Пакет має мати ідентифікатор.", 120, true);
    const author = read(value.author, "Вкажи автора пакета.", 120, true);
    const source = read(value.source, "Вкажи джерело матеріалу.", 200, true);
    const vision = {};
    requireValue(value.vision && typeof value.vision === "object" && !Array.isArray(value.vision),
      "Некоректні поля бачення.");
    for (const [key, text] of Object.entries(value.vision)) {
      requireValue(Object.hasOwn(Route.visionLabels, key), "Пакет містить невідоме поле бачення.");
      const cleaned = read(text, "Некоректний текст бачення.");
      if (cleaned) vision[key] = cleaned;
    }

    function steps(nodes, depth = 0) {
      return list(nodes, 100, "Забагато кроків в одній гілці.").map((node) => {
        requireValue(node && depth <= 6 && typeof node === "object", "Некоректний або надто вкладений крок.");
        const result = {
          id: read(node.id, "У кроку відсутній ідентифікатор.", 120, true),
          name: read(node.name, "У кроку відсутня назва.", 500, true),
          result: read(node.result ?? "", "Некоректний опис кроку."),
          minutes: node.minutes ?? 10, xp: node.xp ?? 50, done: false,
        };
        if (node.children !== undefined) result.children = steps(node.children, depth + 1);
        return result;
      });
    }
    const missions = list(value.projects, 25, "Некоректний перелік проєктів.").map((project) => {
      requireValue(project && typeof project === "object", "Некоректний проєкт.");
      return {
        id: read(project.id, "У проєкту відсутній ідентифікатор.", 120, true),
        name: read(project.name, "У проєкту відсутня назва.", 500, true),
        goal: read(project.goal ?? "", "Некоректна ціль проєкту."),
        steps: steps(project.steps),
      };
    });
    QuestCore.validate({ schemaVersion: 4, missions });
    const projectIds = new Set(missions.map((project) => project.id));
    function links(values) {
      return list(values ?? [], 25, "Некоректні зв’язки з проєктами.").map((id) => {
        requireValue(projectIds.has(id), "Зв’язок веде до проєкту поза пакетом.");
        return id;
      });
    }
    function routeItem(item) {
      requireValue(item && typeof item === "object", "Некоректний запис маршруту.");
      return {
        id: read(item.id, "У запису маршруту відсутній ідентифікатор.", 120, true),
        name: read(item.name, "У запису маршруту відсутня назва.", 500, true),
        projectIds: links(item.projectIds),
      };
    }
    const goals = list(value.goals, 25, "Некоректний перелік цілей.").map((goal) => ({
      ...routeItem(goal),
      why: read(goal.why ?? "", "Некоректний опис сенсу."),
      change: read(goal.change ?? "", "Некоректний опис зміни."),
      criteria: read(goal.criteria ?? "", "Некоректні критерії."),
      milestones: list(goal.milestones ?? [], 50, "Некоректні проміжні результати.").map(routeItem),
    }));
    requireValue(Route.valid(goals), "У маршруті є дублікати або некоректні зв’язки.");
    const materials = list(value.materials, 25, "Некоректний перелік матеріалів.").map((item) => {
      requireValue(item && Object.hasOwn(types, item.kind), "Невідомий тип матеріалу.");
      return {
        kind: item.kind,
        title: read(item.title, "Матеріал має мати назву.", 150, true),
        text: read(item.text, "Матеріал має містити текст.", 4000, true),
      };
    });
    requireValue(Object.keys(vision).length || goals.length || missions.length || materials.length,
      "Пакет порожній.");
    return { id, author, source, vision, goals, missions, materials };
  }

  function draft(value, packet, uid, at) {
    const copy = structuredClone(value);
    const current = copy.pilot ?? Pilot.empty();
    if (current.coachImports?.some((row) => row.id === packet.id)) throw Error("Цей пакет уже застосовано.");
    const projects = new Map(packet.missions.map((project) => [project.id, uid()]));
    const newSteps = (steps) => steps.map((step) => ({
      ...step, id: uid(), ...(step.children ? { children: newSteps(step.children) } : {}),
    }));
    const newProjects = packet.missions.map((project) => ({
      ...project, id: projects.get(project.id), steps: newSteps(project.steps),
    }));
    const remap = (item) => ({
      ...item, id: uid(), projectIds: item.projectIds.map((id) => projects.get(id)),
    });
    const newGoals = packet.goals.map((goal) => ({ ...remap(goal), milestones: goal.milestones.map(remap) }));
    const savedVision = Object.fromEntries(Object.entries(current.vision).filter(([, value]) => value.trim()));
    copy.pilot = Route.revise(current, { ...packet.vision, ...savedVision },
      [...Route.goals(current), ...newGoals], at, copy.missions);
    copy.pilot.coachImports = [...(current.coachImports || []), {
      id: packet.id, author: packet.author, source: packet.source, at, materials: packet.materials,
    }];
    copy.missions.push(...newProjects);
    copy.active ||= newProjects[0]?.id || null;
    QuestCore.validate(copy);
    Pilot.validate(copy.pilot);
    return copy;
  }

  function validImports(value) {
    return value === undefined || (Array.isArray(value) && value.every((row) =>
      row && ["id", "author", "source", "at"].every((key) => typeof row[key] === "string") &&
      Number.isFinite(Date.parse(row.at)) && Array.isArray(row.materials) && row.materials.every((item) =>
        item && Object.hasOwn(types, item.kind) && typeof item.title === "string" && typeof item.text === "string")));
  }

  function validSettings(settings) {
    return settings === undefined || (settings &&
      typeof settings.telegram === "string" && /^(?:[A-Za-z][A-Za-z0-9_]{4,31})?$/.test(settings.telegram) &&
      typeof settings.whatsapp === "string" && /^(?:[1-9][0-9]{6,14})?$/.test(settings.whatsapp) &&
      typeof settings.support === "boolean" && typeof settings.rhythm === "string" && settings.rhythm.length <= 200);
  }

  return { parse, draft, validImports, validSettings, maxBytes, types };
})();
