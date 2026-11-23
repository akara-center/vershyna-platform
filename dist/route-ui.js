"use strict";

function renderRoute({ show, data, openProject }) {
  const current = data();
  const { vision } = current;
  const goals = Route.goals(current);
  const completed = new Set(current.completions.filter((row) => row.kind === "milestone" && !row.reversedAt)
    .map((row) => row.id));
  const visibleVision = Object.fromEntries(Object.keys(Route.visionLabels)
    .filter((key) => vision[key]).map((key) => [key, vision[key]]));
  const field = (key, label, value, required = false) =>
    `<label>${label}<textarea name="${key}" rows="${required ? 2 : 3}" maxlength="2000" ${required ? "required" : ""}>${esc(value)}</textarea></label>`;
  const fields = (labels, values) => Object.entries(labels).map(([key, label]) =>
    field(key, label, values[key], key === "name")).join("");
  const descriptions = (labels, values) => Object.entries(labels).filter(([key]) => values[key])
    .map(([key, label]) => `<dt>${label}</dt><dd>${esc(values[key])}</dd>`).join("");
  const byId = new Map(state.missions.map((project) => [project.id, project]));

  function projectList(ids, names) {
    if (!ids.length) return "";
    return `<ul class="route-links">${ids.map((id) => {
      const project = byId.get(id);
      const name = names
        ? (Object.hasOwn(names, id) ? names[id] : "Проєкт зі старої версії")
        : (project?.name || "Недоступний проєкт");
      if (names || !project) return `<li>${esc(name)}</li>`;
      const next = project.archived ? null : Q.nextAction(project);
      return `<li><button type="button" data-route-project="${esc(id)}">${esc(name)}${project.archived ? " · в архіві" : ""}</button>
        ${next ? `<span class="note">Наступний крок: ${esc(next.name)}</span>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  const roadmap = goals.length ? `<section class="card pilot-card" aria-label="Карта маршруту">
    <h2>Карта маршруту</h2>
    ${goals.map((goal) => `<ol class="route-map">
      <li><strong>Точка А</strong><p>${esc(vision.present || "Ще не описана")}</p></li>
      <li><strong>Проміжні результати</strong>
        ${goal.milestones.length ? goal.milestones.map((item) => `<p>${completed.has(item.id) ? "✓ " : ""}${esc(item.name)}</p>`).join("") : "<p>Ще не додані</p>"}</li>
      <li><strong>Ціль</strong><p>${esc(goal.name)}</p></li>
    </ol>`).join("")}
  </section>` : "";

  show("Мій шлях", `${roadmap}<section class="card pilot-card" id="path-graphics"></section><form class="card pilot-card" id="vision-form">
    <h2>Моє бачення</h2><div class="pilot-grid">${fields(Route.visionLabels, vision)}</div>
    <button class="primary">Зберегти бачення</button></form>
    <section class="pilot-card"><div class="route-heading"><h2>Мої цілі</h2>
    <button type="button" id="add-route-goal">Додати ціль</button></div>
    ${goals.map((goal, index) => `<article class="card pilot-card">
      <div class="route-heading"><h3>${esc(goal.name)}</h3><button data-edit-goal="${index}" aria-label="Редагувати ціль: ${esc(goal.name)}">Редагувати</button></div>
      <dl>${descriptions({ why: Route.goalFields.why, change: Route.goalFields.change, criteria: Route.goalFields.criteria }, goal)}</dl>
      ${projectList(goal.projectIds)}
      ${goal.milestones.map((item, subIndex) => `<section class="route-milestone">
        <div class="route-heading"><h4>${esc(item.name)}</h4><button data-edit-result="${index}" data-result="${subIndex}" aria-label="Редагувати результат: ${esc(item.name)}">Редагувати</button></div>
        ${projectList(item.projectIds)}
        <button type="button" data-complete-result="${index}" data-result="${subIndex}"
          aria-pressed="${completed.has(item.id)}">${completed.has(item.id) ? "✓ Досягнуто" : "Позначити досягнутим"}</button></section>`).join("")}
      <button type="button" data-add-result="${index}">Додати проміжний результат</button></article>`).join("")}
    </section><section class="card pilot-card"><h2>Попередні версії</h2>
    ${[...current.revisions].reverse().map((revision) => `<details><summary>${backupStamp(revision.at)}</summary>
      <dl>${descriptions(Route.visionLabels, revision.vision)}</dl>
      ${Route.goals(revision).map((goal) => `<h4>${esc(goal.name)}</h4>
        <dl>${descriptions({ why: Route.goalFields.why, change: Route.goalFields.change, criteria: Route.goalFields.criteria }, goal)}</dl>
        ${projectList(goal.projectIds, revision.projectNames || {})}
        ${goal.milestones.map((item) => `<p>${esc(item.name)}</p>${projectList(item.projectIds, revision.projectNames || {})}`).join("")}`).join("")}</details>`).join("") ||
      "<p>Історія з’явиться після редагування.</p>"}</section>`);

  renderPathGraphics(current);

  function saveRoute(nextVision, nextGoals, focus, keepVisionDraft = false) {
    const draft = keepVisionDraft ? new FormData($("#vision-form")) : null;
    const updated = Route.revise(current, nextVision, nextGoals, new Date().toISOString(), state.missions);
    if (updated === current) return true;
    const previous = state.pilot;
    state.pilot = updated;
    if (!save()) {
      state.pilot = previous;
      return false;
    }
    if ($("#modal").open) $("#modal").close();
    renderRoute({ show, data, openProject });
    if (draft) {
      for (const [key, value] of draft) $("#vision-form").elements.namedItem(key).value = value;
    }
    $(focus)?.focus();
    toast("Зміни збережено.");
    return true;
  }

  function edit(goalIndex, milestoneIndex) {
    const milestone = milestoneIndex !== undefined;
    const item = milestone ? goals[goalIndex].milestones[milestoneIndex] : goals[goalIndex];
    const selected = item?.projectIds || [];
    const projectOptions = [...new Set([...byId.keys(), ...selected])];
    const heading = milestone
      ? (item ? "Редагувати проміжний результат" : "Новий проміжний результат")
      : (item ? "Редагувати ціль" : "Нова ціль");
    const labels = milestone ? { name: "Назва проміжного результату" } : Route.goalFields;
    modal(`<h2>${heading}</h2><form id="route-editor" class="pilot-card">
      ${fields(labels, item || {})}
      <fieldset><legend>Пов’язані проєкти</legend>
        ${projectOptions.map((id) => `<label class="pilot-choice"><input type="checkbox" name="projects" value="${esc(id)}" ${selected.includes(id) ? "checked" : ""}>
          <span>${esc(byId.get(id)?.name || "Недоступний проєкт")}</span></label>`).join("") ||
          "<p>Проєкти можна створити в розділі «Мій день».</p>"}</fieldset>
      <div class="dialog-actions"><button class="primary">Зберегти</button><button type="button" data-close>Скасувати</button>
      ${item ? '<button id="remove-route-item" type="button">Вилучити з маршруту</button>' : ""}</div></form>`);
    const form = $("#route-editor");
    form.onsubmit = (event) => {
      event.preventDefault();
      const submitted = new FormData(form);
      const values = Object.fromEntries(Object.keys(labels).map((key) => [key, submitted.get(key).trim()]));
      if (!values.name) {
        toast("Вкажи назву.");
        return;
      }
      const draft = structuredClone(goals);
      const entry = { ...item, ...values, id: item?.id || uid(), projectIds: submitted.getAll("projects") };
      if (milestone) {
        if (item) draft[goalIndex].milestones[milestoneIndex] = entry;
        else draft[goalIndex].milestones.push(entry);
      } else if (item) draft[goalIndex] = entry;
      else draft.push({ ...entry, milestones: [] });
      if (!Route.valid(draft)) {
        toast("Досягнуто межі кількості записів у маршруті.");
        return;
      }
      if (saveRoute(visibleVision, draft, `[data-edit-goal="${goalIndex < 0 ? draft.length - 1 : goalIndex}"]`, true) &&
          $("#modal").open) $("#modal").close();
    };
    if (item) $("#remove-route-item").onclick = () => {
      modal(`<h2>Вилучити «${esc(item.name)}» з маршруту?</h2>
        <p>Запис залишиться в попередній версії. Пов’язані проєкти збережуться.</p>
        <div class="dialog-actions"><button type="button" data-close>Скасувати</button>
        <button type="button" id="confirm-route-remove">Вилучити</button></div>`);
      $("#confirm-route-remove").onclick = () => {
        const draft = structuredClone(goals);
        if (milestone) draft[goalIndex].milestones.splice(milestoneIndex, 1);
        else draft.splice(goalIndex, 1);
        saveRoute(visibleVision, draft, "#add-route-goal", true);
      };
    };
  }

  $("#vision-form").onsubmit = (event) => {
    event.preventDefault();
    const next = Object.fromEntries([...new FormData(event.target)].map(([key, value]) =>
      [key, value.trim()]).filter(([, value]) => value));
    saveRoute(next, goals, "#vision-form button");
  };
  $$("[data-complete-result]").forEach((button) => button.onclick = () => {
    const goal = goals[Number(button.dataset.completeResult)];
    const item = goal.milestones[Number(button.dataset.result)];
    const at = new Date().toISOString();
    const completions = structuredClone(current.completions);
    const previous = [...completions].reverse().find((row) =>
      row.kind === "milestone" && row.id === item.id && !row.reversedAt);
    if (previous) previous.reversedAt = at;
    else completions.push({ id: item.id, kind: "milestone", project: goal.name, name: item.name, at });
    const original = state.pilot;
    state.pilot = { ...current, completions };
    if (!save()) {
      state.pilot = original;
      return;
    }
    current.completions = completions;
    state.pilot = current;
    button.setAttribute("aria-pressed", String(!previous));
    button.textContent = previous ? "Позначити досягнутим" : "✓ Досягнуто";
    toast(previous ? "Досягнення скасовано." : "Проміжний результат зафіксовано.");
  });
  $("#add-route-goal").onclick = () => edit(-1);
  $$("[data-edit-goal]").forEach((button) => button.onclick = () => edit(Number(button.dataset.editGoal)));
  $$("[data-add-result]").forEach((button) => button.onclick = () => edit(Number(button.dataset.addResult), -1));
  $$("[data-edit-result]").forEach((button) => button.onclick = () =>
    edit(Number(button.dataset.editResult), Number(button.dataset.result)));
  $$("[data-route-project]").forEach((button) => button.onclick = () => openProject(button.dataset.routeProject));
}

function renderPathGraphics(pilot) {
  const panel = $("#path-graphics");
  const labels = { avatar: "Аватар", infographic: "Інфографіка" };
  const graphics = pilot.graphics ?? {};
  panel.innerHTML = `<h2>Мій образ</h2><p class="note">Можна додати PNG або WebP.</p>
    <div class="pilot-grid">${Object.entries(labels).map(([key, label]) => `<div>
      ${graphics[key] ? `<img class="route-graphic route-${key}" src="${esc(graphics[key])}" alt="${label}">
        <button type="button" data-remove-graphic="${key}">Прибрати зображення</button>` : ""}
      <label>${label} <input type="file" accept="image/png,image/webp" data-path-graphic="${key}"></label>
    </div>`).join("")}</div>`;
  function persist(key, value) {
    const previous = pilot.graphics;
    const next = { ...graphics };
    if (value) next[key] = value;
    else delete next[key];
    pilot.graphics = next;
    if (!save()) {
      pilot.graphics = previous;
      return;
    }
    renderPathGraphics(pilot);
  }
  panel.querySelectorAll("[data-remove-graphic]").forEach((button) => {
    button.onclick = () => persist(button.dataset.removeGraphic, null);
  });
  panel.querySelectorAll("[data-path-graphic]").forEach((input) => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const key = input.dataset.pathGraphic;
      try {
        if (file.size > Pilot.graphicLimits[key]) throw Error("Зображення завелике. Межа " + Pilot.graphicLimits[key] / 1024 + " КБ.");
        const reader = new FileReader();
        const value = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        if (!Pilot.validGraphic(key, value)) throw Error("Обери справний PNG або WebP.");
        const image = new Image();
        image.src = value;
        await image.decode();
        if (input.isConnected && state.pilot === pilot) persist(key, value);
      } catch (error) {
        if (input.isConnected) {
          toast(error.message || "Не вдалося прочитати зображення.");
          input.value = "";
        }
      }
    };
  });
}
