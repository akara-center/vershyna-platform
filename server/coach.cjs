"use strict";

const { randomUUID } = require("node:crypto");

const sections = {
  vision: "Бачення", route: "Маршрут", projects: "Проєкти", indicators: "Показники",
};
const blankTracker = () => ({ schemaVersion: 4, theme: "dark", active: null, missions: [] });

function trackerBlocks(tracker, visionLabels) {
  const rows = new Map();
  const add = (id, parent, label, fields) => {
    const scope = parent ? [...rows.get(parent).scope, id] : [id];
    rows.set(id, { id, parent, label, scope, fields });
  };
  for (const [id, label] of Object.entries(sections)) add(id, null, label, {});
  function steps(nodes, parent) {
    for (const task of nodes) {
      const id = "step:" + task.id;
      add(id, parent, task.name, { name: task.name, result: task.result, done: task.done });
      steps(task.children ?? [], id);
    }
  }
  for (const mission of tracker?.missions || []) {
    const id = "project:" + mission.id;
    add(id, "projects", mission.name, { name: mission.name, goal: mission.goal, archived: Boolean(mission.archived) });
    steps(mission.steps, id);
  }
  const pilot = tracker?.pilot;
  for (const [field, label] of Object.entries(visionLabels))
    add("vision:" + field, "vision", label, { text: pilot?.vision[field] ?? "" });
  for (const goal of pilot?.goals || []) {
    const id = "goal:" + goal.id;
    add(id, "route", goal.name, { name: goal.name, why: goal.why, change: goal.change, criteria: goal.criteria });
    for (const milestone of goal.milestones)
      add("milestone:" + milestone.id, id, milestone.name, { name: milestone.name });
  }
  for (const indicator of pilot?.indicators || [])
    add("indicator:" + indicator.id, "indicators", indicator.name,
      { name: indicator.name, scale: indicator.max, entries: indicator.entries });
  return rows;
}

function editField(tracker, blockId, field, text) {
  const [type, ...parts] = blockId.split(":");
  const id = parts.join(":");
  if (type === "vision" && field === "text") {
    tracker.pilot ??= { version: 1, vision: {}, revisions: [], completions: [], indicators: [], reports: [] };
    if (text) tracker.pilot.vision[id] = text;
    else delete tracker.pilot.vision[id];
    return;
  }
  if (type === "project" && ["name", "goal"].includes(field)) {
    tracker.missions.find((item) => item.id === id)[field] = text;
    return;
  }
  if (type === "step" && ["name", "result"].includes(field)) {
    for (const mission of tracker.missions) {
      const hit = QuestCore.find(mission.steps, id);
      if (hit) {
        hit.node[field] = text;
        return;
      }
    }
  }
  if (type === "goal" && ["name", "why", "change", "criteria"].includes(field)) {
    tracker.pilot.goals.find((item) => item.id === id)[field] = text;
    return;
  }
  if (type === "milestone" && field === "name") {
    tracker.pilot.goals.flatMap((goal) => goal.milestones).find((item) => item.id === id).name = text;
    return;
  }
  throw Error("Це поле не можна змінити пропозицією.");
}

function setUpCoach(db, { validateTracker, applyPackage, visionLabels, reviseRoute }) {
  const blocks = (tracker) => trackerBlocks(tracker, visionLabels);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_roles (
      account_id TEXT PRIMARY KEY REFERENCES workspace_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS suspended_clients (
      account_id TEXT PRIMARY KEY REFERENCES workspace_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS coach_contracts (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES coach_roles(account_id),
      client_id TEXT NOT NULL REFERENCES workspace_accounts(id), started TEXT NOT NULL,
      status TEXT NOT NULL, phase TEXT NOT NULL, scopes TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS coach_one_active ON coach_contracts(client_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS coach_visibility (
      client_id TEXT NOT NULL REFERENCES workspace_accounts(id), block_id TEXT NOT NULL,
      PRIMARY KEY (client_id, block_id)
    );
    CREATE TABLE IF NOT EXISTS coach_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id TEXT NOT NULL REFERENCES coach_contracts(id),
      block_id TEXT NOT NULL, payload TEXT NOT NULL, viewed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS coach_field_versions (
      contract_id TEXT NOT NULL REFERENCES coach_contracts(id), block_id TEXT NOT NULL, field TEXT NOT NULL,
      version INTEGER NOT NULL, PRIMARY KEY (contract_id, block_id, field)
    );
    CREATE TABLE IF NOT EXISTS coach_proposals (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES coach_contracts(id), payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coach_archive (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES coach_contracts(id), at TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_archives (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES workspace_accounts(id), at TEXT NOT NULL, tracker TEXT NOT NULL
    );
  `);
  const now = () => new Date().toISOString();
  const role = (id) => db.prepare("SELECT 1 FROM coach_roles WHERE account_id = ?").get(id) ? "coach" : "client";
  const suspended = (id) => Boolean(db.prepare("SELECT 1 FROM suspended_clients WHERE account_id = ?").get(id));
  const active = (id) => db.prepare("SELECT * FROM coach_contracts WHERE client_id = ? AND status = 'active'").get(id);
  const current = (id) => db.prepare("SELECT tracker, revision FROM workspace_accounts WHERE id = ?").get(id);
  const trackerOf = (id) => JSON.parse(current(id).tracker) ?? blankTracker();
  const roles = (contract, account) => contract.coach_id === account ? "coach" : contract.client_id === account ? "client" : null;

  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function mayView(contract) {
    const privateIds = new Set(db.prepare("SELECT block_id FROM coach_visibility WHERE client_id = ?").all(contract.client_id).map((row) => row.block_id));
    const allowed = contract.scopes ? new Set(JSON.parse(contract.scopes)) : null;
    return (scope) => contract.status === "active" &&
      scope.every((id) => !privateIds.has(id)) && (!allowed || scope.some((id) => allowed.has(id)));
  }

  function version(contract, block, field) {
    return db.prepare("SELECT version FROM coach_field_versions WHERE contract_id = ? AND block_id = ? AND field = ?")
      .get(contract.id, block, field)?.version ?? 0;
  }

  function logChanges(client, before, after) {
    const contract = active(client);
    if (!contract || contract.phase !== "shared") return;
    const previous = blocks(before);
    const next = blocks(after);
    const visible = mayView(contract);
    const insert = db.prepare("INSERT INTO coach_events (contract_id, block_id, payload) VALUES (?, ?, ?)");
    const bump = db.prepare(`INSERT INTO coach_field_versions VALUES (?, ?, ?, 1)
      ON CONFLICT (contract_id, block_id, field) DO UPDATE SET version = version + 1`);
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const from = previous.get(id);
      const to = next.get(id);
      const scope = [...new Set([...(from?.scope || []), ...(to?.scope || [])])];
      if (JSON.stringify(from?.fields) === JSON.stringify(to?.fields) && from?.parent === to?.parent) continue;
      for (const field of new Set([...Object.keys(from?.fields ?? {}), ...Object.keys(to?.fields ?? {})])) {
        if (JSON.stringify(from?.fields[field]) !== JSON.stringify(to?.fields[field]) || from?.parent !== to?.parent)
          bump.run(contract.id, id, field);
      }
      if ((from && !visible(from.scope)) || (to && !visible(to.scope))) continue;
      insert.run(contract.id, id, JSON.stringify({ scope, label: to?.label || from.label,
        before: from?.fields ?? null, after: to?.fields ?? null, at: now() }));
    }
  }

  function publicBlocks(rows, canView) {
    const visible = [...rows.values()].filter((row) => canView(row.scope));
    const visibleIds = new Set(visible.map((row) => row.id));
    return visible.map(({ id, parent, label, fields }) => ({ id, parent: visibleIds.has(parent) ? parent : null, label, fields }));
  }

  function eventsOf(contract, rows, canView) {
    return db.prepare("SELECT * FROM coach_events WHERE contract_id = ? ORDER BY id DESC").all(contract.id)
      .flatMap((event) => {
        const { scope, ...payload } = JSON.parse(event.payload);
        return canView(scope) && (!rows.has(event.block_id) || canView(rows.get(event.block_id).scope))
          ? [{ ...payload, id: event.id, viewed: Boolean(event.viewed) }]
          : [];
      });
  }

  function publicProposal(row, rows, canView) {
    const data = JSON.parse(row.payload);
    const changes = data.changes.filter((change) => {
      const current = rows.get(change.block);
      return current && canView(current.scope);
    });
    if (!changes.length) return null;
    return { id: row.id, at: data.at, changes, messages: changes.length === data.changes.length ? data.messages : [] };
  }

  function need(condition, message, status = 400) {
    if (!condition) throw Object.assign(Error(message), { publicStatus: status });
  }

  function clean(value, limit = 2000) {
    need(typeof value === "string" && value.length <= limit, "Некоректний текст.");
    return value.trim();
  }

  function archiveClient(id) {
    const saved = current(id).tracker;
    if (saved) db.prepare("INSERT INTO client_archives VALUES (?, ?, ?, ?)").run(randomUUID(), id, now(), saved);
    db.prepare("UPDATE workspace_accounts SET tracker = NULL, revision = revision + 1 WHERE id = ?").run(id);
    db.prepare("DELETE FROM coach_visibility WHERE client_id = ?").run(id);
  }

  function mutate(contract, by, data) {
    const role = roles(contract, by);
    const client = contract.client_id;
    const tracker = trackerOf(client);
    const rows = blocks(tracker);
    const canView = mayView(contract);
    const isCoach = role === "coach";
    const isActive = contract.status === "active";
    const action = data?.action;

    if (["archive-note", "delete-note", "suspend"].includes(action)) {
      need(isCoach, "Дію може виконати коуч.", 403);
      if (action === "archive-note") {
        const text = clean(data.text, 30000);
        need(text, "Додай текст нотатки.");
        db.prepare("INSERT INTO coach_archive VALUES (?, ?, ?, ?)").run(randomUUID(), contract.id, now(), text);
      } else if (action === "delete-note") {
        db.prepare("DELETE FROM coach_archive WHERE contract_id = ? AND id = ?").run(contract.id, String(data.id));
      } else {
        need(typeof data.enabled === "boolean", "Некоректний стан доступу.");
        if (data.enabled) db.prepare("INSERT OR IGNORE INTO suspended_clients VALUES (?)").run(client);
        else db.prepare("DELETE FROM suspended_clients WHERE account_id = ?").run(client);
      }
      return;
    }

    need(isActive, "Спільний доступ завершено.", 409);
    if (action === "finish" || action === "handoff") {
      if (action === "finish") {
        db.prepare("UPDATE coach_contracts SET status = 'closed' WHERE id = ?").run(contract.id);
      } else {
        need(isCoach, "Дію може виконати коуч.", 403);
        db.prepare("UPDATE coach_contracts SET phase = 'shared' WHERE id = ?").run(contract.id);
      }
      return;
    }

    if (action === "visibility") {
      need(!isCoach, "Видимість задає клієнт.", 403);
      need(rows.has(data.block) && typeof data.private === "boolean", "Блок недоступний.");
      if (data.private) db.prepare("INSERT OR IGNORE INTO coach_visibility VALUES (?, ?)").run(client, data.block);
      else db.prepare("DELETE FROM coach_visibility WHERE client_id = ? AND block_id = ?").run(client, data.block);
      return;
    }

    if (action === "read") {
      need(isCoach, "Дію може виконати коуч.", 403);
      const visible = eventsOf(contract, rows, canView);
      const update = db.prepare("UPDATE coach_events SET viewed = 1 WHERE contract_id = ? AND id = ?");
      for (const event of visible) if (!event.viewed) update.run(contract.id, event.id);
      return;
    }

    if (action === "setup") {
      need(isCoach && contract.phase === "setup" && !contract.scopes, "Початкове наповнення доступне до передачі.", 403);
      need(!db.prepare("SELECT 1 FROM coach_visibility WHERE client_id = ? LIMIT 1").get(client),
        "Початкове наповнення недоступне, коли клієнт закрив частину трекера.", 409);
      let updated;
      try {
        updated = applyPackage(tracker, data.package);
      } catch (error) {
        need(false, error instanceof SyntaxError ? "Пакет не вдалося прочитати як JSON." : error.message);
      }
      validateTracker(updated);
      db.prepare("UPDATE workspace_accounts SET tracker = ?, revision = revision + 1 WHERE id = ?").run(JSON.stringify(updated), client);
      return;
    }

    if (action === "propose") {
      need(isCoach && contract.phase === "shared", "Спочатку передай трекер клієнтові.", 403);
      need(Array.isArray(data.changes) && data.changes.length > 0 && data.changes.length <= 50, "Додай зміни до пропозиції.");
      const seen = new Set();
      const changes = data.changes.map((change) => {
        const row = rows.get(change?.block);
        if (change?.field === "new-step") {
          need(row && canView(row.scope) && /^(project|step):/.test(row.id), "Блок недоступний.", 403);
          const name = clean(change.text, 500);
          need(name, "Вкажи назву нового кроку.");
          return { id: randomUUID(), block: row.id, label: row.label, field: change.field,
            before: "", after: name, status: "pending", version: version(contract, row.id, "name") };
        }
        need(row && canView(row.scope) && Object.hasOwn(row.fields, change.field) &&
          typeof row.fields[change.field] === "string", "Поле недоступне.", 403);
        const key = JSON.stringify([row.id, change.field]);
        need(!seen.has(key), "Одне поле можна запропонувати один раз.");
        seen.add(key);
        const text = clean(change.text);
        need(text !== row.fields[change.field] && (change.field !== "name" || text), "Запропонуй інший текст.");
        editField(structuredClone(tracker), row.id, change.field, text);
        return { id: randomUUID(), block: row.id, label: row.label, field: change.field,
          before: row.fields[change.field], after: text, status: "pending", version: version(contract, row.id, change.field) };
      });
      db.prepare("INSERT INTO coach_proposals VALUES (?, ?, ?)").run(randomUUID(), contract.id,
        JSON.stringify({ at: now(), changes, messages: [] }));
      return;
    }

    need(action === "accept" || action === "message", "Дію не знайдено.", 404);
    const row = db.prepare("SELECT * FROM coach_proposals WHERE id = ? AND contract_id = ?").get(String(data.id), contract.id);
    const visible = row && publicProposal(row, rows, canView);
    need(visible, "Пропозиція недоступна.", 404);
    const proposal = JSON.parse(row.payload);
    if (action === "message") {
      need(visible.changes.length === proposal.changes.length, "Пропозиція частково недоступна.", 409);
      const text = clean(data.text);
      need(text && proposal.messages.length < 200, "Додай коротке повідомлення.");
      proposal.messages.push({ role, text, at: now() });
    } else {
      need(!isCoach && Array.isArray(data.changes) && data.changes.length, "Обери зміни для застосування.", 403);
      const selected = new Set(data.changes);
      const confirmed = visible.changes.filter((change) => selected.has(change.id));
      need(confirmed.length === selected.size, "Частина змін недоступна.", 409);
      const updated = structuredClone(tracker);
      for (const change of confirmed) {
        if (change.field === "new-step") {
          need(change.status === "pending" && version(contract, change.block, "name") === change.version,
            "Батьківський блок уже змінився. Потрібна нова пропозиція.", 409);
          const id = change.block.slice(change.block.indexOf(":") + 1);
          const project = change.block.startsWith("project:") && updated.missions.find((mission) => mission.id === id);
          const parent = project ? null : updated.missions.map((mission) => QuestCore.find(mission.steps, id)?.node).find(Boolean);
          need(!parent || parent.children?.length || !QuestCore.isDone(parent),
            "Спочатку скасуй виконання батьківського кроку.", 409);
          const steps = project?.steps ?? (parent.children ??= []);
          steps.push({ id: change.id, name: change.after, result: "", minutes: 10, xp: parent ? 0 : 50, done: false });
          if (parent) QuestCore.distribute(parent);
          proposal.changes.find((entry) => entry.id === change.id).status = "accepted";
          continue;
        }
        need(change.status === "pending" && rows.get(change.block).fields[change.field] === change.before &&
          version(contract, change.block, change.field) === change.version,
          "Поле вже змінилося. Потрібна нова пропозиція.", 409);
        editField(updated, change.block, change.field, change.after);
        proposal.changes.find((entry) => entry.id === change.id).status = "accepted";
      }
      if (tracker.pilot && updated.pilot)
        updated.pilot = reviseRoute(tracker.pilot, updated.pilot, now(), tracker.missions);
      QuestCore.normalize(updated);
      validateTracker(updated);
      logChanges(client, tracker, updated);
      db.prepare("UPDATE workspace_accounts SET tracker = ?, revision = revision + 1 WHERE id = ?").run(JSON.stringify(updated), client);
    }
    db.prepare("UPDATE coach_proposals SET payload = ? WHERE id = ?").run(JSON.stringify(proposal), row.id);
  }

  async function api(req, res, pathname, account, { json, readJson, digest, activeAccount }) {
    const id = account.id;
    try {
      if (pathname === "/api/coach/profile" && req.method === "GET")
        return json(res, 200, { role: role(id), suspended: suspended(id) });
      need(!suspended(id), "Доступ до трекера призупинено.", 403);
      if (pathname === "/api/coach/contracts" && req.method === "GET") {
        const contracts = db.prepare(`SELECT id, coach_id, client_id, status, phase, started FROM coach_contracts
          WHERE coach_id = ? OR client_id = ? ORDER BY started DESC`).all(id, id);
        const archives = db.prepare("SELECT id, at FROM client_archives WHERE client_id = ? ORDER BY at DESC").all(id);
        const selectable = [...blocks(trackerOf(id)).values()].map(({ id, label }) => ({ id, label }));
        return json(res, 200, { contracts, archives, selectable, hasTracker: Boolean(account.tracker) });
      }
      if (pathname === "/api/coach/contracts" && req.method === "POST") {
        const data = await readJson(req);
        need(activeAccount(db, req)?.id === id && !suspended(id), "Сесію завершено.", 401);
        return json(res, 200, transaction(() => {
          const isCoach = role(id) === "coach";
          const coach = isCoach ? id : String(data.coach);
          const client = isCoach ? String(data.client) : id;
          need(coach !== client && role(coach) === "coach" && role(client) === "client" && current(client),
            "Перевір ідентифікатори учасників.");
          need(!active(client), "Для клієнта вже є чинний контракт.", 409);
          const first = !db.prepare("SELECT 1 FROM coach_contracts WHERE client_id = ?").get(client);
          need(!isCoach || first, "Наступний контракт відкриває клієнт.", 403);
          const fresh = data.fresh === true;
          const hasTracker = Boolean(current(client).tracker);
          need(!isCoach || !hasTracker, "Клієнт має сам відкрити доступ до наявного трекера.", 403);
          const shareExisting = hasTracker && !fresh;
          const rows = blocks(trackerOf(client));
          const scopes = data.scopes;
          if (shareExisting) need(Array.isArray(scopes) && scopes.length && scopes.every((key) => rows.has(key)),
            "Обери блоки попереднього трекера для нового контракту.");
          if (fresh && hasTracker) archiveClient(client);
          const contract = randomUUID();
          db.prepare("INSERT INTO coach_contracts VALUES (?, ?, ?, ?, 'active', ?, ?)")
            .run(contract, coach, client, now(), shareExisting ? "shared" : "setup",
              shareExisting ? JSON.stringify([...new Set(scopes)]) : null);
          return { id: contract };
        }));
      }
      const archive = /^\/api\/coach\/previous\/([\w-]+)$/.exec(pathname);
      if (archive && req.method === "GET") {
        const row = db.prepare("SELECT tracker FROM client_archives WHERE id = ? AND client_id = ?").get(archive[1], id);
        need(row, "Архів недоступний.", 404);
        return json(res, 200, JSON.parse(row.tracker));
      }
      const match = /^\/api\/coach\/contracts\/([\w-]+)$/.exec(pathname);
      if (match) {
        const contract = db.prepare("SELECT * FROM coach_contracts WHERE id = ?").get(match[1]);
        need(contract && roles(contract, id), "Контракт недоступний.", 404);
        if (req.method === "POST") {
          const data = await readJson(req);
          need(activeAccount(db, req)?.id === id && !suspended(id), "Сесію завершено.", 401);
          transaction(() => mutate(db.prepare("SELECT * FROM coach_contracts WHERE id = ?").get(match[1]), id, data));
          return json(res, 200, {});
        }
        if (req.method === "GET") {
          const rows = blocks(trackerOf(contract.client_id));
          const canView = mayView(contract);
          const isCoach = contract.coach_id === id;
          const events = isCoach ? eventsOf(contract, rows, canView) : [];
          const proposals = contract.status === "active" ? db.prepare("SELECT * FROM coach_proposals WHERE contract_id = ?").all(contract.id)
            .map((row) => publicProposal(row, rows, canView)).filter(Boolean) : [];
          const notes = isCoach ? db.prepare("SELECT id, at, text FROM coach_archive WHERE contract_id = ? ORDER BY at DESC").all(contract.id) : [];
          const privateIds = !isCoach && contract.status === "active"
            ? db.prepare("SELECT block_id FROM coach_visibility WHERE client_id = ?").all(id).map((row) => row.block_id) : [];
          return json(res, 200, { phase: contract.phase, status: contract.status, blocks: publicBlocks(rows, isCoach ? canView : () => contract.status === "active"), events,
            unread: events.filter(({ viewed }) => !viewed).length, proposals, notes, privateIds, suspended: suspended(contract.client_id) });
        }
      }
      return json(res, 404, { error: "Дію співпраці не знайдено." });
    } catch (error) {
      if (!error.publicStatus) throw error;
      return json(res, error.publicStatus, { error: error.message });
    }
  }

  return { role, suspended, api, logChanges, transaction };
}

module.exports = { setUpCoach };
