"use strict";

// Pure collaboration rules. The pilot supplies fixed demo identities; a server must derive them from sessions.
const Collaboration = (() => {
  const roles = ["client", "coach"];
  const need = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const tracker = (state, id = state.trackerId) => state.trackers.find((item) => item.id === id);
  const current = (state) => state.contracts.at(-1);
  const itemById = (t, id) => t.blocks.find((item) => item.id === id);
  const active = (state) => current(state)?.status === "active";
  const clientCanUse = (state) => state.clientBlocked !== true;

  function setClientAccess(state, role, enabled) {
    need(role === "coach", "Цю дію може виконати лише коуч.");
    need(typeof enabled === "boolean", "Некоректний стан доступу.");
    state.clientBlocked = !enabled;
  }
  const clear = (text) => String(text ?? "").trim().slice(0, 2000);

  function scope(t, block) {
    const ids = [block.id];
    let parent = itemById(t, block.parent);
    while (parent) {
      ids.push(parent.id);
      parent = itemById(t, parent.parent);
    }
    return ids;
  }

  function allowed(state, t, ids) {
    const contract = current(state);
    return active(state) && contract.trackerId === t.id &&
      ids.every((id) => !t.private.includes(id)) &&
      (!contract.scopes || ids.some((id) => contract.scopes.includes(id)));
  }

  function change(state, role, input, at) {
    need(roles.includes(role), "Невідома роль.");
    need(role !== "client" || clientCanUse(state), "Доступ клієнта до трекера заблоковано.");
    const t = tracker(state, role === "coach" ? current(state)?.trackerId : input.trackerId);
    need(t, "Трекер недоступний.");
    const item = itemById(t, input.id);
    const operation = input.op;
    need(["add", "edit", "delete"].includes(operation), "Некоректна дія.");
    need(operation === "add" ? !item && !t.events.some((event) => event.blockId === input.id) : item, "Запис змінився або більше недоступний.");
    const parent = operation === "add" ? input.parent || null : item.parent;
    need(!parent || itemById(t, parent), "Батьківський блок недоступний.");
    const ids = scope(t, item || { id: input.id, parent });
    const visibilityScope = operation === "add" && parent ? ids.slice(1) : ids;
    need(role === "client" || current(state)?.phase === "setup", "Надішли пропозицію клієнту.");
    need(role === "client" || (active(state) && allowed(state, t, visibilityScope)), "Блок недоступний.");
    need(operation !== "delete" || !t.blocks.some((row) => row.parent === item.id), "Спочатку оброби вкладені записи.");
    const text = clear(input.text);
    if (operation === "edit" && text === item.text) return false;
    need(operation === "delete" || text, "Додай текст.");
    const before = item?.text ?? "";
    const label = item?.label || clear(input.label);
    need(label, "Додай назву блока.");
    if (operation === "add") t.blocks.push({ id: input.id, label, text, parent, revision: 1 });
    if (operation === "edit") {
      item.text = text;
      item.revision++;
    }
    if (operation === "delete") t.blocks = t.blocks.filter((row) => row.id !== item.id);
    t.events.push({
      seq: ++state.seq, blockId: input.id, scope: ids, label, operation, before,
      after: operation === "delete" ? "" : text, role, at,
    });
    return true;
  }

  function proposalVisible(state, t, row) {
    if (row.operation === "add" && row.status === "pending") {
      const parent = itemById(t, row.parent);
      return row.parent ? parent && allowed(state, t, scope(t, parent)) : allowed(state, t, [row.id]);
    }
    const item = itemById(t, row.id);
    return item && allowed(state, t, scope(t, item));
  }

  function propose(state, id, changes) {
    const contract = current(state);
    const t = tracker(state, contract.trackerId);
    need(active(state) && contract.phase === "shared", "Співпраця має бути активною після передачі трекера.");
    need(!state.proposals.some((row) => row.id === id), "Пропозицію вже створено.");
    need(changes.length && new Set(changes.map((row) => row.id)).size === changes.length,
      "Вибери різні блоки для пропозицій.");
    const rows = changes.map((entry) => {
      const text = clear(entry.text);
      if (entry.operation === "add") {
        const row = {
          id: entry.id, label: clear(entry.label), parent: entry.parent || null,
          operation: "add", before: "", text, status: "pending",
        };
        need(row.label && text && !itemById(t, row.id) && proposalVisible(state, t, row),
          "Для нового блока вкажи назву, текст і доступний розділ.");
        return row;
      }
      const item = itemById(t, entry.id);
      need(item && allowed(state, t, scope(t, item)), "Блок недоступний для пропозиції.");
      need(text && item.text !== text, "Запропонуй текст, який відрізняється від поточного.");
      return { id: item.id, label: item.label, operation: "edit", before: item.text, text,
        revision: item.revision, status: "pending" };
    });
    state.proposals.push({ id, contractId: contract.id, rows, messages: [] });
  }

  function decide(state, proposalId, ids, at) {
    need(clientCanUse(state), "Доступ клієнта до трекера заблоковано.");
    const updated = structuredClone(state);
    const contract = current(updated);
    const t = tracker(updated, contract?.trackerId);
    const proposal = updated.proposals.find((row) => row.id === proposalId && row.contractId === contract?.id);
    need(active(updated) && proposal, "Співпраця або пропозиція недоступна.");
    need(ids.length && new Set(ids).size === ids.length, "Обери зміни для застосування.");
    const entries = ids.map((id) => {
      const entry = proposal.rows.find((row) => row.id === id && row.status === "pending");
      const block = itemById(t, id);
      const unchanged = entry?.operation === "add" ? !block : block?.revision === entry?.revision;
      need(entry && unchanged && proposalVisible(updated, t, entry),
        "Блок змінився, закритий або пропозицію вже застосовано. Попроси оновлену пропозицію.");
      return entry;
    });
    for (const entry of entries) {
      change(updated, "client", { op: entry.operation, trackerId: t.id, id: entry.id,
        text: entry.text, parent: entry.parent, label: entry.label }, at);
      entry.status = "accepted";
    }
    return updated;
  }

  function message(state, role, proposalId, text) {
    need(active(state) && roles.includes(role), "Співпраця неактивна.");
    need(role !== "client" || clientCanUse(state), "Доступ клієнта до трекера заблоковано.");
    const proposal = state.proposals.find((row) => row.id === proposalId && row.contractId === current(state).id);
    const t = tracker(state, current(state).trackerId);
    const body = clear(text);
    need(proposal && body && proposal.rows.every((row) => proposalVisible(state, t, row)), "Пропозиція або текст недоступні.");
    proposal.messages.push({ role, text: body });
  }

  function coachView(state) {
    const contract = current(state);
    const t = tracker(state, contract.trackerId);
    const visible = t.blocks.filter((item) => allowed(state, t, scope(t, item)));
    const visibleIds = new Set(visible.map((item) => item.id));
    const blocks = visible.map(({ id, label, text, parent, revision }) =>
      ({ id, label, text, parent: visibleIds.has(parent) ? parent : null, revision }));
    const events = t.events
      .filter((event) => event.role === "client" && event.seq > (contract?.startedAfter ?? 0) &&
        allowed(state, t, event.scope) && (!itemById(t, event.blockId) || visibleIds.has(event.blockId)))
      .map(({ seq, operation, label, before, after, at, blockId }) =>
        ({ seq, operation, label, before, after, at, blockId }));
    const proposals = state.proposals.filter((item) => item.contractId === contract?.id && active(state))
      .flatMap((item) => {
        const rows = item.rows.filter((row) => proposalVisible(state, t, row));
        return rows.length ? [{ id: item.id, rows, messages: rows.length === item.rows.length ? item.messages : [] }] : [];
      });
    return { blocks, events, proposals, unread: events.filter((event) => !contract.read.includes(event.seq)).length };
  }

  function finish(state) {
    need(active(state), "Співпраця вже закрита.");
    current(state).status = "closed";
  }

  function start(state, { id, trackerId, scopes, initial }) {
    need(!active(state), "Спочатку заверши активну співпрацю.");
    need(!state.contracts.some((item) => item.id === id), "Цей контракт уже існує.");
    let t = state.trackers.find((item) => item.id === trackerId);
    if (initial) {
      need(!t, "Трекер із цим номером уже існує.");
      t = { id: trackerId, blocks: [], private: [], events: [] };
      state.trackers.push(t);
    }
    need(t, "Трекер недоступний.");
    need(initial || (Array.isArray(scopes) && scopes.length &&
      scopes.every((scopeId) => itemById(t, scopeId) && !scope(t, itemById(t, scopeId)).some((blockId) => t.private.includes(blockId)))),
      "Клієнт має відкрити принаймні один доступний блок.");
    state.trackerId = trackerId;
    state.contracts.push({ id, trackerId, status: "active", phase: initial ? "setup" : "shared",
      scopes: initial ? null : [...scopes], startedAfter: state.seq, read: [] });
  }

  // Preserve a shared prefix and suffix for a compact, exact before/after highlight.
  function diff(before, after) {
    const a = Array.from(before), b = Array.from(after);
    let first = 0, last = 0;
    while (first < a.length && first < b.length && a[first] === b[first]) first++;
    while (last < a.length - first && last < b.length - first &&
      a[a.length - last - 1] === b[b.length - last - 1]) last++;
    return {
      prefix: a.slice(0, first).join(""), removed: a.slice(first, a.length - last).join(""),
      added: b.slice(first, b.length - last).join(""), suffix: a.slice(a.length - last).join(""),
    };
  }

  return { tracker, current, active, clientCanUse, setClientAccess, scope, allowed, change, propose, decide, message, coachView, finish, start, diff };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Collaboration;
