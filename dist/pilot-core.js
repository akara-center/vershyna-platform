"use strict";

const Pilot = (() => {
  const empty = () => ({
    version: 1, vision: {}, revisions: [], completions: [], indicators: [], reports: [],
  });

  const visionFields = [...Object.keys(Route.visionLabels), "goal", "criteria", "milestones", "project"];
  const text = (value) => typeof value === "string";
  const day = (value) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const stamp = (value) => text(value) && Number.isFinite(Date.parse(value));
  const validVision = (value) => value && typeof value === "object" &&
    !Array.isArray(value) && Object.keys(value).every((key) => visionFields.includes(key) && text(value[key]));

  const graphicLimits = { avatar: 384 * 1024, infographic: 768 * 1024 };

  function validGraphic(key, data) {
    if (!Object.hasOwn(graphicLimits, key) || typeof data !== "string") return false;
    const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if (!match || match[2].length % 4) return false;
    const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
    if (bytes > graphicLimits[key]) return false;
    const header = atob(match[2].slice(0, 16));
    if (match[1] === "png") return header.startsWith("\x89PNG\r\n\x1a\n");
    return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  }

  function validGraphics(value) {
    return value === undefined || (value && typeof value === "object" && !Array.isArray(value) &&
      Object.entries(value).every(([key, data]) => validGraphic(key, data)));
  }

  function validate(value) {
    if (value === undefined) return;
    if (!value || value.version !== 1 || !validVision(value.vision) || !validGraphics(value.graphics) ||
        !Route.valid(value.goals) || !CoachPackage.validImports(value.coachImports) || !CoachPackage.validSettings(value.coachSettings) ||
        (value.relevance !== undefined && (!Array.isArray(value.relevance) ||
          !value.relevance.every((row) => row && text(row.id) && text(row.name) &&
            text(row.project) && stamp(row.at) && typeof row.inactive === "boolean"))) ||
        !Array.isArray(value.revisions) || !value.revisions.every((r) =>
          r && stamp(r.at) && validVision(r.vision) && Route.valid(r.goals) && Route.validNames(r.projectNames)) ||
        !Array.isArray(value.completions) || !value.completions.every((r) => r &&
          (r.kind === undefined || ["project", "milestone"].includes(r.kind)) &&
          text(r.id) && text(r.project) && text(r.name) && (r.projectId === undefined || text(r.projectId)) && (!r.planned || day(r.planned)) && stamp(r.at) && (!r.reversedAt || stamp(r.reversedAt))) ||
        !Array.isArray(value.indicators) || !value.indicators.every((r) => r &&
          text(r.id) && text(r.name) && [10, 100].includes(r.max) && r.version === 1 &&
          Array.isArray(r.entries) && r.entries.every((e) => e && day(e.date) &&
            Number.isInteger(e.value) && e.value >= 0 && e.value <= r.max)) ||
        !Array.isArray(value.reports) || !value.reports.every((r) => r && stamp(r.at) && text(r.text))) {
      throw Error("Додаткові дані Вершини 2.0 мають несумісний формат.");
    }
  }

  const kyivDate = (date = new Date()) => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);

  function periodStart(today, months) {
    const [year, month, dayOfMonth] = today.split("-").map(Number);
    const last = new Date(Date.UTC(year, month - months, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - months - 1, Math.min(dayOfMonth, last)))
      .toISOString().slice(0, 10);
  }

  function actions(missions) {
    return missions.flatMap((project) => {
      const inactive = QuestCore.inactiveSteps(project.steps);
      return [
        ...QuestCore.allSteps(project.steps).map((node) => ({
          id: node.id, name: node.name, project: project.name, projectId: project.id,
          planned: day(node.plannedDate) ? node.plannedDate : undefined, archived: Boolean(project.archived),
          done: node.children?.length ? Boolean(node.finalized) : node.done,
          inactive: inactive.has(node.id), directlyInactive: node.inactive === true,
          treeDone: QuestCore.isDone(node),
          canFocus: !inactive.has(node.id) && Boolean(QuestCore.nextAction({ steps: [node] })),
        })),
        { id: project.id, name: project.name, project: project.name, projectId: project.id,
          done: Boolean(project.finalized), archived: Boolean(project.archived), kind: "project" },
      ];
    });
  }

  function recordCompletion(data, before, after, at) {
    const old = new Map(before.map((item) => [item.id, item.done]));
    for (const item of after) {
      if (old.get(item.id) === item.done || !old.has(item.id)) continue;
      if (item.done) {
        data.completions.push({ id: item.id, project: item.project, projectId: item.projectId, name: item.name, planned: item.planned, kind: item.kind, at });
      } else {
        const entry = [...data.completions].reverse().find((row) => row.kind !== "milestone" && row.id === item.id && !row.reversedAt);
        if (entry) entry.reversedAt = at;
      }
    }
  }

  function results(data, from, to) {
    return data.completions.filter((row) => {
      const date = kyivDate(new Date(row.at));
      return !row.reversedAt && date >= from && date <= to;
    }).sort((a, b) => b.at.localeCompare(a.at));
  }

  function report(at, from, to, selected, comment) {
    const planned = selected.filter((row) => row.planned && row.planned >= from && row.planned <= to);
    const done = selected.filter((row) => row.at);
    const open = selected.filter((row) => !row.done && !row.at);
    const list = (rows) => rows.map((row) => `• ${row.project} — ${row.name}`).join("\n");
    return [
      "Міжсесійна звірка · Вершина 2.0",
      `Період ${from} — ${to}. Підготовлено ${kyivDate(new Date(at))}.`,
      planned.length ? `План на період\n${list(planned)}` : "Планові дати для вибраних кроків у цьому періоді відсутні.",
      done.length ? `Виконано за період\n${list(done)}` : "",
      open.length ? `Залишилося виконати\n${list(open)}` : "",
      comment ? `Коментар\n${comment}` : "",
    ].filter(Boolean).join("\n\n");
  }

  return { empty, validate, visionFields, validGraphic, graphicLimits, kyivDate, periodStart, actions, recordCompletion, results, report };
})();
