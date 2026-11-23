"use strict";
// Task, series, project and transfer forms and their validation.

function xpOptions(value = 50) {
  return [...new Set([25, 50, 100, 200, value])]
    .sort((a, b) => a - b)
    .map(
      (n) =>
        `<option value="${n}" ${n === value ? "selected" : ""}>${n} XP${{ 25: " · підтримувальна дія", 50: " · звичайний результат", 100: " · важливий результат", 200: " · ключовий результат" }[n] || " · власне значення"}</option>`,
    )
    .join("");
}

function stepEditor(id, { copyId = null, parentId = null } = {}) {
  const match = Q.find(mission().steps, id),
    s = match?.node,
    sourceMatch = Q.find(mission().steps, copyId),
    source = sourceMatch?.node;
  const parent = parentId ? Q.find(mission().steps, parentId)?.node : sourceMatch?.parent;
  if (parentId && !parent.children?.length && Q.isDone(parent)) {
    toast("Щоб розділити завершений крок, спочатку скасуй його виконання.");
    return;
  }
  const draft = source || s,
    allocated = !!(parent || match?.parent),
    locked = !!(s && Q.hasDone(s));
  modal(
    Templates.stepForm({
      title: source
        ? "Скопіювати крок"
        : parentId
          ? "Новий підкрок"
          : s
            ? "Редагувати крок"
            : "Новий крок",
      parentNote: parent
        ? `<p class="note">До задачі «${esc(parent.name)}». Підкроки ділять її ${parent.xp} XP. Зароблені частки зберігаються; нові дії ділять залишок.</p>`
        : "",
      name: esc(draft?.name || ""),
      result: esc(draft?.result || ""),
      minutes: draft?.minutes || 10,
      plannedDate: esc(s?.plannedDate || ""),
      rewardField: allocated
        ? '<p class="note">Бали підкроку визначаються загальною винагородою задачі.</p>'
        : Templates.stepRewardField({
            disabled: locked ? "disabled" : "",
            options: xpOptions(draft?.xp || 50),
            lockedNote: locked
              ? " Щоб змінити бали, спочатку скасуй виконання дій цієї задачі."
              : "",
          }),
    }),
  );
  $("#stepForm").onsubmit = (e) => {
    e.preventDefault();
    const v = {
      name: $("#stepName").value.trim(),
      result: $("#stepResult").value.trim(),
      minutes: Number($("#stepMinutes").value),
      plannedDate: $("#stepPlannedDate").value || "",
    };
    if (!v.name || !v.result) return;
    if (s) {
      Object.assign(s, v);
      if (!allocated && !locked) {
        s.xp = Number($("#stepXP").value);
        Q.distribute(s);
      }
    } else {
      const newNode = source ? Q.copyStep(source, uid()) : { id: uid(), done: false };
      Object.assign(newNode, v);
      newNode.xp = allocated ? 0 : Number($("#stepXP").value);
      if (parentId) {
        parent.children ??= [];
        parent.children.push(newNode);
        Q.distribute(parent);
      } else if (source) {
        sourceMatch.siblings.splice(sourceMatch.siblings.indexOf(source) + 1, 0, newNode);
        if (parent) Q.distribute(parent);
        else Q.distribute(newNode);
      } else mission().steps.push(newNode);
      if (newNode.xp === 0)
        toast(
          "Підкрок створено без додаткових XP: загальна винагорода вже розподілена між розпочатими або виконаними діями.",
        );
    }
    updateParents();
    finishEdit();
  };
}

function seriesEditor() {
  modal(Templates.seriesForm({ xpOptions: xpOptions(50) }));
  function summary() {
    const n = Number($("#lectureCount").value) || 0;
    $("#seriesSummary").textContent =
      `Загальна винагорода: ${n * Number($("#lectureXP").value)} XP. Кожна лекція ділить свої бали між її діями.`;
  }
  $("#lectureCount").oninput = summary;
  $("#lectureXP").onchange = summary;
  summary();
  $("#seriesForm").onsubmit = (e) => {
    e.preventDefault();
    const count = Number($("#lectureCount").value),
      actions = $("#lectureActions")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      name = $("#courseName").value.trim(),
      template = $("#lectureTemplate").value.trim(),
      perLecture = Number($("#lectureXP").value),
      minutes = Number($("#seriesMinutes").value);
    if (
      !name ||
      !template ||
      !actions.length ||
      actions.length > 10 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100
    ) {
      toast("Вкажи назву, від 1 до 100 лекцій та від 1 до 10 дій.");
      return;
    }
    const course = {
      id: uid(),
      name,
      result: "Завершити всі лекції та дії курсу.",
      minutes,
      done: false,
      kind: "course",
      xp: count * perLecture,
      children: Array.from({ length: count }, (_, i) => ({
        id: uid(),
        name: template.includes("{n}")
          ? template.replaceAll("{n}", String(i + 1))
          : template + " " + (i + 1),
        result: "Виконати дії лекції.",
        minutes,
        done: false,
        collapsed: true,
        xp: perLecture,
        children: actions.map((action) => ({
          id: uid(),
          name: action,
          result: action,
          minutes,
          done: false,
          xp: 0,
        })),
      })),
    };
    Q.distribute(course);
    mission().steps.push(course);
    finishEdit();
    toast(`Створено ${count} лекцій і ${count * actions.length} дій. Бали — після виконання.`);
  };
}

function missionEditor(isNew = false) {
  const m = isNew ? {} : mission();
  modal(
    Templates.missionForm({
      title: isNew ? "Нова місія" : "Налаштування місії",
      name: esc(m.name || ""),
      goal: esc(m.goal || ""),
      deadline: esc(m.deadline || ""),
    }),
  );
  $("#missionForm").onsubmit = (e) => {
    e.preventDefault();
    const v = {
      name: $("#missionName").value.trim(),
      goal: $("#missionGoal").value.trim(),
      deadline: $("#missionDeadline").value,
    };
    if (!v.name || !v.goal) return;
    if (isNew) {
      const id = uid();
      state.missions.push({ ...v, id, steps: [] });
      state.active = id;
    } else Object.assign(m, v);
    finishEdit();
  };
}

function transferEditor(sourceId) {
  const whole = state.missions.find((m) => m.id === sourceId),
    from = whole || state.missions.find((m) => Q.find(m.steps, sourceId));
  const match = whole ? null : Q.find(from.steps, sourceId),
    node = whole || match.node;
  const excluded = new Set(
    whole ? Q.allSteps(whole.steps).map((n) => n.id) : Q.allSteps([node]).map((n) => n.id),
  );
  const options = [];
  for (const m of state.missions.filter((m) => !m.archived)) {
    if (whole && m.id === whole.id) continue;
    if (whole || m !== from || match.parent)
      options.push({ mid: m.id, pid: null, label: m.name + " → основний список" });
    function visit(nodes, path = []) {
      for (const n of nodes) {
        const next = [...path, n.name];
        if (!excluded.has(n.id) && !(n.done && !n.children?.length) && match?.parent?.id !== n.id)
          options.push({ mid: m.id, pid: n.id, label: [m.name, ...next].join(" → ") });
        if (!excluded.has(n.id)) visit(n.children || [], next);
      }
    }
    visit(m.steps);
  }
  modal(
    Templates.transferForm({
      kind: whole ? "проєкт" : "задачу",
      name: esc(node.name),
      projectNote: whole ? "Проєкт після перенесення стане задачею всередині обраного місця." : "",
      options: options.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join(""),
    }),
  );
  if (!options.length)
    $("#transferPreview").textContent =
      "Немає іншого місця. Спочатку створи проєкт або незавершену задачу.";
  let selection = null;
  $("#transferTarget").onchange = () => {
    selection = null;
    $("#confirmTransfer").disabled = true;
    $("#transferError").textContent = "";
    $("#transferPreview").textContent = "";
    if ($("#transferTarget").value === "") return;
    const o = options[Number($("#transferTarget").value)];
    try {
      Q.transfer(state, sourceId, o.mid, o.pid);
      selection = o;
      $("#confirmTransfer").disabled = false;
      const target = o.pid
        ? Q.find(state.missions.find((m) => m.id === o.mid).steps, o.pid)?.node
        : null;
      $("#transferPreview").textContent =
        target && !target.children?.length
          ? "Обрана дія стане групою. Її винагорода визначатиметься сумою перенесених підкроків; окремих балів за заголовок не буде."
          : "Збережуться бали перенесених дій. Винагорода груп дорівнюватиме сумі їхніх підкроків.";
    } catch (e) {
      $("#transferError").textContent = e.message;
    }
  };
  $("#confirmTransfer").onclick = () => {
    if (!selection) return;
    try {
      if (persistenceBlocked) throw Error(startupError);
      const next = Q.transfer(state, sourceId, selection.mid, selection.pid);
      writeBackup("-before-transfer", JSON.stringify(state));
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      resetTimer();
      $("#modal").close();
      render();
      toast("Перенесено. Виконання та зароблені XP збережено.");
    } catch (e) {
      $("#transferError").textContent = e.message;
    }
  };
}
