"use strict";

if (document.getElementById?.("pilot-nav")) {
  const panel = $("#pilot-page");
  const data = () => state.pilot ??= Pilot.empty();
  const dateLabel = (value) => value.split("-").reverse().join(".");
  let page = "day";
  const show = (heading, content) => {
    panel.innerHTML = `<div class="pilot-title"><h1>${heading}</h1></div>${content}`;
  };

  function navigate(target, focus = true) {
    page = target;
    $$("#pilot-nav button").forEach((button) => {
      if (button.dataset.page === page) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#pilot-day").hidden = page !== "day";
    panel.hidden = page === "day";
    if (page === "day") {
      showPersona();
      showIndicators();
    }
    if (page === "path") showPath();
    if (page === "progress") showProgress();
    if (page === "coach") showCoach();
    if (focus) {
      const title = page === "day" ? $("#greeting") : $("#pilot-page h1");
      title.tabIndex = -1;
      title.focus();
      title.scrollIntoView({ block: "nearest" });
    }
  }

  function showPath() {
    renderRoute({ show, data, openProject(id) {
      const project = state.missions.find((item) => item.id === id);
      if (!project) return;
      if (project.archived) {
        viewArchive(id);
        return;
      }
      resetTimer();
      state.active = id;
      save();
      render();
      navigate("day");
    } });
  }

  function showPersona() {
    const { persona, image } = data().vision;
    $("#heroName").textContent = persona || "Провідниця світла";
    $("#heroDescription").textContent = image || "Ясність · вплив · втілення";
  }

  function showIndicators() {
    const today = Pilot.kyivDate();
    const indicators = data().indicators;
    $("#pilot-indicators").innerHTML = `<h2>Як я сьогодні?</h2>
      ${indicators.map((indicator, index) => {
        const saved = indicator.entries.find((entry) => entry.date === today);
        return `<form class="pilot-inline" data-indicator="${index}">
          <label>${esc(indicator.name)} · ${indicator.max === 100 ? "0–100%" : "0–10"}
          <input name="value" type="number" inputmode="numeric" min="0" max="${indicator.max}" required value="${saved?.value ?? ""}"></label>
          <button>Зберегти оцінку</button></form>`;
      }).join("") || "<p>Додай власний показник, якщо хочеш відстежувати стан.</p>"}
      <details><summary>Додати показник</summary>
      <form class="pilot-inline" id="new-indicator">
        <label>Назва<input name="name" maxlength="80" required placeholder="Наприклад, енергія"></label>
        <label>Шкала<select name="max"><option value="10">0–10</option><option value="100">0–100%</option></select></label>
        <button class="primary">Додати</button>
      </form></details>`;
    $("#new-indicator").onsubmit = (event) => {
      event.preventDefault();
      const fields = new FormData(event.target);
      const name = fields.get("name").trim();
      if (!name) return;
      indicators.push({ id: uid(), name, max: Number(fields.get("max")), version: 1, entries: [] });
      save();
      showIndicators();
      $$("#pilot-indicators input[name=value]").at(-1)?.focus();
    };
    $$("[data-indicator]").forEach((form) => form.onsubmit = (event) => {
      event.preventDefault();
      const indicator = indicators[Number(form.dataset.indicator)];
      const value = Number(new FormData(form).get("value"));
      const entry = indicator.entries.find((row) => row.date === today);
      if (entry) entry.value = value;
      else indicator.entries.push({ date: today, value });
      if (save()) toast("Оцінку збережено.");
    });
  }

  function showProgress() {
    const today = Pilot.kyivDate();
    show("Мій прогрес", `<section class="card pilot-card"><h2>Результати</h2>
      <label>Період<select id="progress-period"><option value="0">Сьогодні</option>
      <option value="1">Останній місяць</option><option value="3" selected>Останні 3 місяці</option>
      <option value="6">Останні 6 місяців</option><option value="12">Останні 12 місяців</option></select></label>
      <div id="progress-results"></div></section>
      <section class="card pilot-card"><h2>Динаміка стану</h2>
      <div class="pilot-grid">${data().indicators.map((indicator) => {
        const rows = [...indicator.entries].sort((a, b) => b.date.localeCompare(a.date));
        return `<section><h3>${esc(indicator.name)} · ${indicator.max === 100 ? "0–100%" : "0–10"}</h3>
          <p class="note">Вимірів: ${rows.length}</p>
          ${rows.map((entry) => `<div class="pilot-reading"><time datetime="${entry.date}">${dateLabel(entry.date)}</time>
          <meter min="0" max="${indicator.max}" value="${entry.value}" aria-label="${esc(indicator.name)} ${dateLabel(entry.date)}"></meter>
          <strong>${entry.value}${indicator.max === 100 ? "%" : ""}</strong></div>`).join("") || "<p>Ще немає оцінок.</p>"}</section>`;
      }).join("") || "<p>Додай показник у розділі «Мій день».</p>"}</div></section>`);
    const update = () => {
      const results = Pilot.results(data(), Pilot.periodStart(today, Number($("#progress-period").value)), today);
      const dated = new Set(data().completions.filter((row) => !row.reversedAt).map((row) => row.id));
      const all = Pilot.actions(state.missions);
      const open = all.filter((row) => !row.done && !row.archived && !row.kind);
      const unknown = all.filter((row) => row.done && !dated.has(row.id));
      const groups = new Map();
      for (const row of results) {
        if (!groups.has(row.project)) groups.set(row.project, []);
        groups.get(row.project).push(row);
      }
      const list = (rows) => `<ul>${rows.map((row) => `<li>${esc(row.project)} · ${esc(row.name)}</li>`).join("")}</ul>`;
      $("#progress-results").innerHTML = `<h3>Завершено · ${results.length}</h3>
        ${[...groups].map(([project, rows]) => `<h4>${esc(project)}</h4><ul>${rows.map((row) =>
          `<li><time>${dateLabel(Pilot.kyivDate(new Date(row.at)))}</time> · ${esc(row.name)}</li>`).join("")}</ul>`).join("") || "<p>За цей період завершень поки немає.</p>"}
        <details><summary>Залишилося виконати · ${open.length}</summary>${list(open)}</details>
        ${unknown.length ? `<details><summary>Виконано без дати · ${unknown.length}</summary>${list(unknown)}</details>` : ""}`;
    };
    $("#progress-period").onchange = update;
    update();
  }

  function showCoach() {
    const today = Pilot.kyivDate();
    const open = Pilot.actions(state.missions).filter((row) => !row.kind && !row.done && !row.archived);
    let candidates = [];
    let draft;
    show("Співпраця з коучем", `<section class="card pilot-card"><h2>Міжсесійний звіт</h2>
      <p>Вибери задачі, які хочеш показати коучу, і переглянь текст перед передачею.</p>
      <form id="report-form">
        <div class="pilot-inline"><label>Початок<input id="report-from" type="date" required value="${Pilot.periodStart(today, 1)}"></label>
        <label>Кінець<input id="report-to" type="date" required value="${today}"></label></div>
        <fieldset><legend>Що включити</legend><div id="report-choices"></div></fieldset>
        <label>Коментар<textarea id="report-comment" rows="3" maxlength="2000"></textarea></label>
        <button class="primary" id="prepare-report">Підготувати звіт</button>
        <p id="report-message" role="status"></p>
      </form>
      <div id="report-preview" hidden><label>Перегляд звіту<textarea id="report-text" readonly rows="9"></textarea></label>
        <div class="pilot-actions"><button id="report-copy">Копіювати текст</button>
        <button id="report-save">Зберегти в історію</button>
        <button id="report-share" ${navigator.share ? "" : "hidden"}>Поділитися</button>
        <a id="report-telegram" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a id="report-whatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a></div></div></section>
      <section class="card pilot-card"><h2>Історія підготовлених звітів</h2><div id="report-history"></div></section>`);
    const history = () => {
      $("#report-history").innerHTML = [...data().reports].reverse().map((row) =>
        `<details><summary>${backupStamp(row.at)}</summary><p class="pilot-report-entry">${esc(row.text)}</p></details>`).join("") ||
        "<p>Збережених звітів поки немає.</p>";
    };
    const choices = () => {
      const previous = new Set($$("#report-choices input:checked").map((input) => input.dataset.key));
      const from = $("#report-from").value;
      const to = $("#report-to").value;
      $("#report-preview").hidden = true;
      candidates = [...Pilot.results(data(), from, to), ...open];
      $("#report-choices").innerHTML = candidates.map((row, index) => {
        const key = `${row.id}:${row.at ?? "open"}`;
        return `<label class="pilot-choice"><input type="checkbox" value="${index}" data-key="${esc(key)}" ${previous.has(key) ? "checked" : ""}>
          <span>${esc(row.project)} · ${esc(row.name)} <small>(${row.at ? "виконано" : "у роботі"})</small></span></label>`;
      }).join("") || "<p>Немає записів для вибору.</p>";
    };
    $("#report-form").oninput = () => {
      $("#report-preview").hidden = true;
      $("#report-message").textContent = "";
    };
    $("#report-from").onchange = choices;
    $("#report-to").onchange = choices;
    $("#report-form").onsubmit = (event) => {
      event.preventDefault();
      const from = $("#report-from").value;
      const to = $("#report-to").value;
      const selected = $$("#report-choices input:checked").map((input) => candidates[Number(input.value)]);
      if (from > to || !selected.length) {
        $("#report-message").textContent = from > to ? "Початок періоду має передувати кінцю." : "Обери хоча б один запис.";
        return;
      }
      const at = new Date().toISOString();
      draft = { at, text: Pilot.report(at, from, to, selected, $("#report-comment").value.trim()) };
      $("#report-text").value = draft.text;
      $("#report-save").disabled = false;
      const encoded = encodeURIComponent(draft.text);
      $("#report-telegram").href = `https://t.me/share/url?url=&text=${encoded}`;
      $("#report-whatsapp").href = `https://wa.me/?text=${encoded}`;
      $("#report-preview").hidden = false;
    };
    $("#report-copy").onclick = () => copyText($("#report-text"));
    $("#report-save").onclick = () => {
      data().reports.push(draft);
      if (save()) {
        $("#report-save").disabled = true;
        history();
        toast("Підготовлений звіт збережено.");
      } else data().reports.pop();
    };
    $("#report-share").onclick = async () => {
      try {
        await navigator.share({ text: draft.text });
      } catch (error) {
        if (error.name !== "AbortError") toast("Скористайся копіюванням тексту або кнопкою месенджера.");
      }
    };
    choices();
    history();
  }

  $$("#pilot-nav button").forEach((button) => button.onclick = () => navigate(button.dataset.page));
  document.addEventListener("vershyna:imported", () => navigate(page, false));
  navigate("day", false);
}
