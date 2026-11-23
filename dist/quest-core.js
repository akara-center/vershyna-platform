/* Shared, side-effect-free rules for step copies, order and the hero's aura. */
(function (root) {
  "use strict";
  function copyStep(source, id) {
    if (!source || typeof id !== "string" || id === source.id)
      throw new Error("A copy needs a new identity");
    const value = {
      id,
      name: source.name,
      result: source.result,
      minutes: source.minutes,
      done: false,
    };
    if (Number.isInteger(source.xp)) value.xp = source.xp;
    if (source.kind === "course") value.kind = "course";
    if (source.collapsed === true) value.collapsed = true;
    if (source.children?.length)
      value.children = source.children.map((child) => copyStep(child, crypto.randomUUID()));
    return value;
  }
  function moveStep(steps, id, direction) {
    if (direction !== -1 && direction !== 1) return false;
    const index = steps.findIndex((step) => step.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= steps.length) return false;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    return true;
  }
  function auraState(xp, artifacts) {
    const rank = Math.floor(Math.max(0, xp) / 200) + 1;
    const strength = Math.min(1, (rank - 1) * 0.1 + Math.max(0, artifacts) * 0.1);
    return {
      rank,
      strength,
      radius: 72 + strength * 32,
      glowOpacity: 0.3 + strength * 0.65,
      ringOpacity: 0.14 + strength * 0.66,
      ringWidth: 1 + strength * 1.5,
      rayOpacity: strength * 0.8,
      sparkOpacity: Math.min(1, strength * 1.6),
      label:
        strength < 0.2
          ? "Аура пробуджується"
          : strength < 0.5
            ? "Аура набирає сили"
            : strength < 0.8
              ? "Аура сяє яскравіше"
              : "Потужне сяйво аури",
    };
  }
  function leaves(node) {
    return node.children?.length ? node.children.flatMap(leaves) : [node];
  }
  function allSteps(steps) {
    return steps.flatMap((step) => [step, ...allSteps(step.children || [])]);
  }
  function hasDone(node) {
    return leaves(node).some((step) => step.done);
  }
  function isDone(node) {
    return node.children?.length ? node.children.every(isDone) : node.done;
  }
  function earned(node) {
    return node.children?.length
      ? node.children.reduce((sum, child) => sum + earned(child), 0)
      : node.done
        ? node.xp
        : 0;
  }
  // One compact undo snapshot per checked group, never a history of clicks.
  function toggleGroupCompletion(node) {
    const descendants = allSteps(node.children || []);
    if (node.finalized) {
      if (node.completionUndo) {
        const previous = new Map(node.completionUndo.map((entry) => [entry.id, entry]));
        descendants.forEach((child) => {
          const entry = previous.get(child.id);
          if (!entry) return; // Deleted/moved items are never recreated.
          child.done = entry.done;
          if (entry.finalized) child.finalized = true;
          else delete child.finalized;
        });
      }
      delete node.completionUndo;
      delete node.finalized;
      refreshTree([node]);
      return;
    }
    node.completionUndo = descendants.map((child) => ({
      id: child.id,
      done: child.done === true,
      finalized: child.finalized === true,
    }));
    descendants.forEach((child) => {
      child.done = true;
    });
    node.done = true;
    node.finalized = true;
  }
  function distribute(node) {
    if (!node.children?.length) return;
    // Finished and partially finished branches retain their allocation.
    const locked = node.children.filter(hasDone);
    const open = node.children.filter((child) => !hasDone(child));
    const available = Math.max(0, node.xp - locked.reduce((sum, child) => sum + child.xp, 0));
    open.forEach((child, i) => {
      child.xp = Math.floor(available / open.length) + (i < available % open.length ? 1 : 0);
      distribute(child);
    });
    node.done = isDone(node);
    if (!node.done) delete node.finalized;
  }
  function find(steps, id, parent = null) {
    for (const node of steps) {
      if (node.id === id) return { node, siblings: steps, parent };
      const match = find(node.children || [], id, node);
      if (match) return match;
    }
    return null;
  }
  // Display sorting never destroys the user's manual order; undo restores it.
  function ordered(
    nodes,
    done = (n) => (n.children?.length ? n.finalized === true && isDone(n) : isDone(n)),
  ) {
    return [...nodes.filter((n) => !done(n)), ...nodes.filter(done)];
  }
  function missionDone(m) {
    return m.steps.length > 0 && m.steps.every(isDone);
  }
  function inactiveSteps(steps) {
    const ids = new Set();
    function visit(nodes, inherited) {
      for (const node of nodes) {
        const inactive = inherited || node.inactive === true;
        if (inactive) ids.add(node.id);
        if (node.children) visit(node.children, inactive);
      }
    }
    visit(steps, false);
    return ids;
  }

  function nextAction(m) {
    function pending(node) {
      if (node.inactive || isDone(node)) return [];
      return node.children?.length ? node.children.flatMap(pending) : [node];
    }
    const actions = m.steps.flatMap(pending);
    return actions.find((n) => n.id === m.focusId && !isDone(n)) || actions.find((n) => !isDone(n));
  }
  function refreshTree(nodes) {
    nodes.forEach((n) => {
      if (n.children?.length) {
        refreshTree(n.children);
        n.done = isDone(n);
        if (!n.done) delete n.finalized;
      }
      if (!n.finalized) delete n.completionUndo;
    });
  }
  // Work on a clone: invalid destinations and failed invariants never mutate progress.
  function transfer(value, sourceId, targetMissionId, parentId = null) {
    const draft = structuredClone(value),
      before = draft.missions.flatMap((m) => m.steps).reduce((s, n) => s + earned(n), 0);
    const wholeMission = draft.missions.find((m) => m.id === sourceId);
    const from = wholeMission || draft.missions.find((m) => find(m.steps, sourceId));
    const to = draft.missions.find((m) => m.id === targetMissionId);
    if (!from || !to || (wholeMission && from === to))
      throw Error("Обери інший проєкт або задачу.");
    const match = wholeMission ? null : find(from.steps, sourceId);
    if (wholeMission && !from.steps.length)
      throw Error("Порожній проєкт поки немає що переносити.");
    const node = wholeMission
      ? {
          id: from.id,
          name: from.name,
          result: from.goal,
          deadline: from.deadline || "",
          minutes: 10,
          done: missionDone(from),
          xp: from.steps.reduce((s, n) => s + n.xp, 0),
          children: from.steps,
        }
      : match.node;
    const parent = parentId ? find(to.steps, parentId)?.node : null;
    if (parentId && !parent) throw Error("Місце перенесення не знайдено.");
    if (parent && (parent.id === node.id || find(node.children || [], parent.id)))
      throw Error("Не можна переносити задачу в себе або власний підкрок.");
    if (
      !wholeMission &&
      ((parent && match.parent === parent) || (!parent && from === to && !match.parent))
    )
      throw Error("Задача вже знаходиться тут.");
    if (parent && !parent.children?.length && parent.done)
      throw Error("Завершену дію не можна перетворити на групу. Обери проєкт або іншу задачу.");
    const changed = new Set();
    function markAncestors(nodes, id) {
      for (const n of nodes)
        if (n.children?.length && find(n.children, id)) {
          changed.add(n.id);
          markAncestors(n.children, id);
        }
    }
    if (!wholeMission) markAncestors(from.steps, node.id);
    if (parent) {
      markAncestors(to.steps, parent.id);
      changed.add(parent.id);
    }
    if (wholeMission) draft.missions.splice(draft.missions.indexOf(from), 1);
    else match.siblings.splice(match.siblings.indexOf(node), 1);
    if (parent) {
      parent.children ??= [];
      parent.children.push(node);
      parent.collapsed = false;
    } else to.steps.push(node);
    function reconcile(nodes) {
      nodes.forEach((n) => {
        if (n.children?.length) {
          reconcile(n.children);
          if (changed.has(n.id)) n.xp = n.children.reduce((s, c) => s + c.xp, 0);
          n.done = isDone(n);
          if (!n.done) delete n.finalized;
        } else if (changed.has(n.id)) {
          delete n.children;
          n.xp = 0;
          n.done = false;
        }
      });
    }
    draft.missions.forEach((m) => {
      reconcile(m.steps);
      if (m.focusId && !m.steps.flatMap(leaves).some((n) => n.id === m.focusId && !n.done))
        delete m.focusId;
    });
    if (draft.active === sourceId || !draft.missions.some((m) => m.id === draft.active))
      draft.active = to.id;
    validate(draft);
    const after = draft.missions.flatMap((m) => m.steps).reduce((s, n) => s + earned(n), 0);
    if (before !== after) throw Error("Перенесення скасовано: бали мають залишитися незмінними.");
    return draft;
  }
  function normalize(value) {
    value.missions.forEach((m) =>
      m.steps.forEach(function visit(node) {
        if (!Number.isInteger(node.xp)) node.xp = 50;
        if (node.children?.length) {
          node.children.forEach(visit);
          node.done = isDone(node);
          if (!node.done) delete node.finalized;
        }
        if (!node.finalized) delete node.completionUndo;
      }),
    );
    value.schemaVersion = 4;
    return value;
  }
  function validate(value) {
    if (
      !value ||
      !Array.isArray(value.missions) ||
      (!value.missions.length && value.schemaVersion !== 4) ||
      value.missions.length > 500
    )
      throw Error("Потрібен файл прогресу «Вершини» з місіями.");
    if (Number(value.schemaVersion) > 4)
      throw Error("Цей файл створено новішою версією «Вершини».");
    const ids = new Set();
    let count = 0;
    function unique(id) {
      if (typeof id !== "string" || !id || ids.has(id))
        throw Error("Файл містить порожні або повторені ідентифікатори.");
      ids.add(id);
    }
    function visit(node, depth) {
      if (!node || depth > 8 || ++count > 20000) throw Error("Завелика структура задач.");
      unique(node.id);
      if (
        typeof node.name !== "string" ||
        !node.name.trim() ||
        typeof node.result !== "string" ||
        !Number.isFinite(node.minutes) ||
        node.minutes < 1 ||
        node.minutes > 120 ||
        typeof node.done !== "boolean" ||
        (node.inactive !== undefined && typeof node.inactive !== "boolean") ||
        (node.plannedDate !== undefined && node.plannedDate !== "" &&
          (typeof node.plannedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(node.plannedDate)))
      )
        throw Error("У файлі є некоректний крок.");
      if (node.xp !== undefined && (!Number.isInteger(node.xp) || node.xp < 0 || node.xp > 1000000))
        throw Error("Некоректна кількість XP.");
      if (node.completionUndo !== undefined) {
        if (!Array.isArray(node.completionUndo) || node.completionUndo.length > 20000)
          throw Error("Некоректна копія стану підкроків.");
        const savedIds = new Set();
        for (const entry of node.completionUndo) {
          if (
            !entry ||
            typeof entry.id !== "string" ||
            !entry.id ||
            savedIds.has(entry.id) ||
            typeof entry.done !== "boolean" ||
            typeof entry.finalized !== "boolean"
          )
            throw Error("Некоректна копія стану підкроків.");
          savedIds.add(entry.id);
        }
      }
      if (Number(value.schemaVersion) === 4 && node.xp === undefined)
        throw Error("У кроку відсутня кількість XP.");
      if (node.children !== undefined) {
        if (!Array.isArray(node.children) || !node.children.length)
          throw Error("Некоректні підзадачі.");
        node.children.forEach((child) => visit(child, depth + 1));
        if (node.children.reduce((sum, child) => sum + child.xp, 0) > node.xp)
          throw Error("Бали підзадач перевищують загальну винагороду.");
      }
    }
    value.missions.forEach((m) => {
      if (!m || typeof m.name !== "string" || typeof m.goal !== "string" || !Array.isArray(m.steps))
        throw Error("Некоректна місія.");
      unique(m.id);
      m.steps.forEach((node) => visit(node, 0));
    });
    const budget = value.missions
      .flatMap((m) => m.steps)
      .reduce((sum, node) => sum + (node.xp ?? 50), 0);
    if (budget > 1000000) throw Error("Загальна винагорода у файлі перевищує 1 000 000 XP.");
    return value;
  }

  const TRASH_TTL = 7 * 24 * 60 * 60 * 1000;
  function pruneTrash(value, now = Date.now()) {
    value.trash = (value.trash || []).filter((e) => e.deletedAt + TRASH_TTL > now);
    return value;
  }
  function trashItem(value, id, now = Date.now()) {
    const draft = pruneTrash(structuredClone(value), now);
    const m = draft.missions.find((m) => m.id === id || find(m.steps, id));
    if (!m) throw Error("Елемент не знайдено.");
    const whole = m.id === id,
      match = whole ? null : find(m.steps, id);
    const node = whole ? m : match.node;
    const entry = {
      id: crypto.randomUUID(),
      kind: whole ? "project" : "step",
      node: structuredClone(node),
      missionId: m.id,
      missionName: m.name,
      parentId: match?.parent?.id || null,
      parentName: match?.parent?.name || "",
      index: whole ? draft.missions.indexOf(m) : match.siblings.indexOf(node),
      deletedAt: now,
    };
    draft.trash.push(entry);
    if (whole) {
      draft.missions.splice(entry.index, 1);
      if (draft.active === id) draft.active = draft.missions.find((m) => !m.archived)?.id || null;
    } else {
      match.siblings.splice(entry.index, 1);
      if (match.parent) {
        match.parent.xp = Math.max(0, match.parent.xp - node.xp);
        if (!match.siblings.length) {
          delete match.parent.children;
          match.parent.done = false;
        }
      }
      refreshTree(m.steps);
    }
    validate(draft);
    return draft;
  }
  function restoreTrash(value, id, now = Date.now()) {
    const draft = pruneTrash(structuredClone(value), now),
      entry = draft.trash.find((e) => e.id === id);
    if (!entry) throw Error("Термін зберігання минув або елемент уже відновлено.");
    const ids = new Set(
      draft.missions.flatMap((m) => [m.id, ...allSteps(m.steps).map((n) => n.id)]),
    );
    const restoredIds =
      entry.kind === "project"
        ? [entry.node.id, ...allSteps(entry.node.steps).map((n) => n.id)]
        : allSteps([entry.node]).map((n) => n.id);
    if (restoredIds.some((id) => ids.has(id))) throw Error("Такий елемент уже є серед проєктів.");
    if (entry.kind === "project") {
      draft.missions.splice(Math.min(entry.index, draft.missions.length), 0, entry.node);
      if (!entry.node.archived) draft.active = entry.node.id;
    } else {
      const m = draft.missions.find((m) => m.id === entry.missionId);
      if (!m) throw Error("Спочатку віднови батьківський проєкт із кошика.");
      const parent = entry.parentId ? find(m.steps, entry.parentId)?.node : null;
      if (entry.parentId && !parent) throw Error("Спочатку віднови батьківську задачу із кошика.");
      const siblings = parent ? (parent.children ??= []) : m.steps;
      siblings.splice(Math.min(entry.index, siblings.length), 0, entry.node);
      if (parent) {
        parent.xp += entry.node.xp;
        parent.collapsed = false;
      }
      draft.active = m.id;
    }
    draft.trash = draft.trash.filter((e) => e.id !== id);
    validate(draft);
    return draft;
  }
  function rewards(xp) {
    const seeds = [
      { threshold: 50, icon: "✧", name: "Іскра початку" },
      { threshold: 150, icon: "◈", name: "Кристал ясності" },
      { threshold: 350, icon: "☀", name: "Мантія втілення" },
    ];
    const icons = ["✺", "◇", "✦", "❋", "☼", "✵"];
    const forms = ["Печатка", "Ореол", "Знак", "Зірка", "Ключ", "Сфера"];
    const qualities = ["ясності", "впливу", "втілення", "стійкості", "напряму", "сили"];
    const extra = Math.max(0, Math.floor((xp - 750) / 400) + 1);
    for (let i = 0; i < extra; i++)
      seeds.push({
        threshold: 750 + i * 400,
        icon: icons[i % 6],
        name: `${forms[i % 6]} ${qualities[Math.floor(i / 6) % 6]}${i >= 36 ? " · " + (Math.floor(i / 36) + 1) : ""}`,
      });
    return {
      unlocked: seeds.filter((r) => xp >= r.threshold),
      next: seeds.find((r) => xp < r.threshold)?.threshold ?? 750 + extra * 400,
    };
  }
  root.QuestCore = {
    toggleGroupCompletion,
    trashItem,
    restoreTrash,
    pruneTrash,
    TRASH_TTL,
    copyStep,
    moveStep,
    auraState,
    leaves,
    allSteps,
    hasDone,
    isDone,
    earned,
    distribute,
    find,
    normalize,
    validate,
    rewards,
    ordered,
    missionDone,
    nextAction,
    inactiveSteps,
    refreshTree,
    transfer,
  };
})(globalThis);
