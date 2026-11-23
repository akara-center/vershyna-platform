"use strict";
// Task/project changes, focus, completion, archive and trash actions.

function deleteStep(id) {
  const s = Q.find(mission().steps, id)?.node;
  if (!s) return;
  const count = Q.allSteps([s]).length - 1;
  confirmRemoval(
    `Перемістити «${s.name}» у кошик на 7 днів?${count ? " Разом із підкроками: " + count + "." : " Лише цей крок."} Можна буде відновити.`,
    () => {
      try {
        if (storeProjectChange(Q.trashItem(state, id))) toast(`«${s.name}» у кошику на 7 днів.`);
      } catch (e) {
        toast(e.message);
      }
    },
  );
}

function finishEdit() {
  resetTimer();
  save();
  $("#modal").close();
  render();
}

function takeInWork(id) {
  const m = mission(),
    match = Q.find(m.steps, id);
  if (!match || Q.isDone(match.node) || Q.inactiveSteps(m.steps).has(id)) return;
  const target = Q.nextAction({ steps: [match.node] });
  if (!target) return;
  function promote(nodes) {
    const index = nodes.findIndex(
      (n) =>
        n.id === id ||
        n.children?.some(function contains(c) {
          return c.id === id || c.children?.some(contains);
        }),
    );
    if (index < 0) return;
    const node = nodes.splice(index, 1)[0];
    nodes.unshift(node);
    if (node.children?.length) {
      node.collapsed = false;
      if (node.id !== id) promote(node.children);
    }
  }
  promote(m.steps);
  m.focusId = target.id;
  resetTimer();
  save();
  render();
  toast("Задачу взято в роботу й піднято на початок списку.");
}

function updateParents() {
  Q.refreshTree(mission().steps);
  if (!Q.missionDone(mission())) delete mission().finalized;
  if (mission().focusId && Q.nextAction(mission())?.id !== mission().focusId)
    delete mission().focusId;
}

function toggle(id) {
  const found = Q.find(mission().steps, id);
  if (!found || found.node.children?.length || Q.inactiveSteps(mission().steps).has(id)) return;
  const completions = Pilot.actions([mission()]);
  const before = totalXP(),
    oldRewards = Q.rewards(before).unlocked.length;
  found.node.done = !found.node.done;
  if (found.node.done && mission().focusId === id) delete mission().focusId;
  updateParents();
  recordPilotCompletion(completions);
  const gain = totalXP() - before,
    newRewards = Q.rewards(totalXP()).unlocked;
  if (gain > 0) {
    celebrate();
    toast(
      newRewards.length > oldRewards
        ? `Відкрито артефакт: ${newRewards.at(-1).name}! +${gain} XP`
        : `Крок втілено! +${gain} XP · +${number(gain / 5)} іскор`,
    );
  } else
    toast(
      found.node.done
        ? "Крок втілено. Прогрес оновлено."
        : "Виконання скасовано. Прогрес і нагороди перераховано.",
    );
  resetTimer();
  save();
  render();
}

function finalize(id) {
  const m = mission(),
    node = id === m.id ? m : Q.find(m.steps, id)?.node;
  if (!node) return;
  if (node !== m && (Q.inactiveSteps(m.steps).has(id) ||
      (!node.finalized && Q.allSteps(node.children || []).some((child) => child.inactive && !Q.isDone(child))))) {
    toast("Поверни неактуальні кроки до плану, щоб завершити цю задачу.");
    return;
  }
  const ready = node === m ? Q.missionDone(m) : Q.isDone(node);
  if (node === m && !node.finalized && !ready) {
    toast("Спочатку заверши задачі проєкту.");
    return;
  }
  const completions = Pilot.actions([m]);
  if (node !== m) Q.toggleGroupCompletion(node);
  else node.finalized = !node.finalized;
  updateParents();
  recordPilotCompletion(completions);
  resetTimer();
  save();
  render();
}

function storeProjectChange(draft, backup = "-before-project-change") {
  if (persistenceBlocked) {
    toast(startupError);
    return false;
  }
  try {
    Q.validate(draft);
    writeBackup(backup, JSON.stringify(state));
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    toast("Не вдалося зберегти зміну. Поточні проєкти залишилися без змін.");
    return false;
  }
  state = draft;
  resetTimer();
  $("#modal").close();
  render();
  return true;
}

function archiveProject(id) {
  const m = state.missions.find((m) => m.id === id);
  if (!m || m.archived) return;
  const draft = structuredClone(state);
  draft.missions.find((m) => m.id === id).archived = true;
  if (draft.active === id) draft.active = draft.missions.find((m) => !m.archived)?.id || null;
  if (storeProjectChange(draft)) toast("Проєкт в архіві. Усі кроки й XP збережено.");
}

function restoreProject(id) {
  const draft = structuredClone(state),
    m = draft.missions.find((m) => m.id === id);
  if (!m) return;
  delete m.archived;
  draft.active = id;
  if (storeProjectChange(draft)) toast("Проєкт повернуто в активні.");
}

function deleteProject(id) {
  const m = state.missions.find((m) => m.id === id);
  if (!m) return;
  confirmRemoval(
    `Перемістити проєкт «${m.name}» разом з усіма кроками в кошик на 7 днів? Можна буде відновити.`,
    () => {
      try {
        if (storeProjectChange(Q.trashItem(state, id)))
          toast(`Проєкт «${m.name}» у кошику на 7 днів.`);
      } catch (e) {
        toast(e.message);
      }
    },
  );
}

function recordPilotCompletion(before) {
  state.pilot ??= Pilot.empty();
  Pilot.recordCompletion(state.pilot, before, Pilot.actions([mission()]), new Date().toISOString());
}


function setTaskRelevance(projectId, id, inactive) {
  const draft = structuredClone(state);
  const project = draft.missions.find((item) => item.id === projectId && !item.archived);
  const node = project && Q.find(project.steps, id)?.node;
  if (!node || Boolean(node.inactive) === inactive || (inactive && Q.isDone(node))) return false;
  if (inactive) node.inactive = true;
  else delete node.inactive;
  if (project.focusId && Q.nextAction(project)?.id !== project.focusId) delete project.focusId;
  draft.pilot ??= Pilot.empty();
  draft.pilot.relevance ??= [];
  draft.pilot.relevance.push({
    id, project: project.name, name: node.name, inactive, at: new Date().toISOString(),
  });
  const previous = state;
  state = draft;
  if (!save()) {
    state = previous;
    return false;
  }
  resetTimer();
  render();
  toast(inactive ? "Крок позначено неактуальним." : "Крок повернуто до плану.");
  return true;
}
