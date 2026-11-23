"use strict";

function renderCoachImports() {
  const imports = state.pilot?.coachImports || [];
  const cards = imports.flatMap((entry) => entry.materials.map((item) =>
    `<details><summary>${esc(CoachPackage.types[item.kind])} · ${esc(item.title)}</summary>
    <p class="pilot-report-entry">${esc(item.text)}</p>
    <p class="note">${esc(entry.author)} · ${esc(entry.source)}</p></details>`));
  return `<section class="card pilot-card"><h2>Від коуча</h2>
    ${cards.join("") || "<p>Тут з’являться матеріали з пакета, який ти додаси.</p>"}
    <button id="open-coach-import" type="button">Додати пакет маршруту</button></section>`;
}

function coachImport(onApplied) {
  modal(`<h2>Додати пакет маршруту</h2>
    <form id="coach-import" class="pilot-card">
      <label>Файл JSON<input type="file" id="coach-import-file" accept=".json,application/json"></label>
      <label>Або встав JSON<textarea id="coach-import-text" rows="4"></textarea></label>
      <div class="pilot-actions"><button type="submit">Переглянути пакет</button>
      <button type="button" id="coach-load-example">Відкрити тестовий пакет</button>
      <button type="button" data-close>Закрити</button></div>
      <p role="status" id="coach-import-status"></p>
      <div id="coach-import-preview"></div>
    </form>`);
  const form = $("#coach-import");
  const input = $("#coach-import-text");
  const status = $("#coach-import-status");
  const preview = $("#coach-import-preview");
  const clear = () => { preview.replaceChildren(); status.textContent = ""; };
  function review(raw) {
    if (!form.isConnected || !$("#modal").open) return;
    clear();
    try {
      const packet = CoachPackage.parse(raw);
      const known = state.pilot?.coachImports?.some((item) => item.id === packet.id);
      const projectNames = new Map(packet.missions.map((item) => [item.id, item.name]));
      const links = (item) => item.projectIds.length
        ? `<p class="note">Проєкти: ${item.projectIds.map((id) => esc(projectNames.get(id))).join(", ")}</p>`
        : "";
      const currentVision = state.pilot?.vision || {};
      function tree(nodes) {
        return `<ul>${nodes.map((node) => `<li>${esc(node.name)}${node.result ? ` · ${esc(node.result)}` : ""} · ${node.minutes} хв · ${node.xp} XP${node.children ? tree(node.children) : ""}</li>`).join("")}</ul>`;
      }
      preview.innerHTML = `<h3>Перегляд пакета</h3><p>${esc(packet.author)} · ${esc(packet.source)}</p>
        ${packet.goals.length ? `<h4>Цілі й проміжні результати</h4><ul>${packet.goals.map((item) =>
          `<li><strong>${esc(item.name)}</strong>
            <dl>${Object.entries(Route.goalFields).filter(([key]) => key !== "name" && item[key])
              .map(([key, label]) => `<dt>${label}</dt><dd>${esc(item[key])}</dd>`).join("")}</dl>
            ${links(item)}
            ${item.milestones.length ? `<ul>${item.milestones.map((entry) =>
              `<li>${esc(entry.name)}${links(entry)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>` : ""}
        ${packet.missions.length ? `<h4>Проєкти й кроки</h4>${packet.missions.map((project) =>
          `<p>${esc(project.name)}${project.goal ? ` · ${esc(project.goal)}` : ""}</p>${tree(project.steps)}`).join("")}` : ""}
        ${Object.keys(packet.vision).length ? `<h4>Бачення</h4><dl>${Object.entries(packet.vision).map(([key, value]) =>
          `<dt>${Route.visionLabels[key]}</dt><dd>${esc(value)}${currentVision[key] ? " · твоє поле збережеться" : ""}</dd>`).join("")}</dl>` : ""}
        ${packet.materials.map((item) => `<details><summary>${esc(item.title)}</summary><p class="pilot-report-entry">${esc(item.text)}</p></details>`).join("")}
        <p>Цілі й проєкти буде додано, заповнені поля бачення й поточний прогрес збережуться.</p>
        ${known ? "<p>Цей пакет уже додано.</p>" : '<button class="primary" type="button" id="coach-apply-package">Додати до мого маршруту</button>'}`;
      if (known) return;
      $("#coach-apply-package").onclick = () => {
        try {
          const draft = CoachPackage.draft(state, packet, uid, new Date().toISOString());
          if (storeProjectChange(draft, "-before-coach-import")) {
            onApplied();
            toast("Пакет додано до маршруту.");
          }
        } catch (error) {
          status.textContent = error.message;
        }
      };
    } catch (error) {
      status.textContent = error instanceof SyntaxError ? "Не вдалося прочитати JSON пакета." : error.message;
    }
  }
  let request = 0;
  input.oninput = () => { request++; clear(); };
  form.onsubmit = (event) => { event.preventDefault(); request++; review(input.value); };
  $("#coach-import-file").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const currentRequest = ++request;
    clear();
    if (file.size > CoachPackage.maxBytes) {
      status.textContent = "Файл перевищує 256 КБ.";
      return;
    }
    try {
      const raw = await file.text();
      if (request === currentRequest) review(raw);
    } catch {
      status.textContent = "Не вдалося прочитати файл.";
    }
  };
  $("#coach-load-example").onclick = async () => {
    const currentRequest = ++request;
    clear();
    try {
      const response = await fetch("./example-coach-route.json");
      if (!response.ok) throw Error();
      const raw = await response.text();
      if (request === currentRequest) review(raw);
    } catch {
      status.textContent = "Тестовий пакет тимчасово недоступний.";
    }
  };
}

function renderCoachSettings() {
  const settings = state.pilot?.coachSettings || {};
  const telegram = settings.telegram ? `https://t.me/${esc(settings.telegram)}` : "";
  const whatsapp = settings.whatsapp ? `https://wa.me/${esc(settings.whatsapp)}` : "";
  return `<section class="card pilot-card"><h2>Зв’язок із коучем</h2>
    ${telegram || whatsapp ? `<div class="pilot-actions">
      ${telegram ? `<a href="${telegram}" target="_blank" rel="noopener noreferrer">Написати в Telegram</a>` : ""}
      ${whatsapp ? `<a href="${whatsapp}" target="_blank" rel="noopener noreferrer">Написати у WhatsApp</a>` : ""}
      </div>` : ""}
    <details id="coach-settings"><summary>Налаштування контактів і супроводу</summary>
      <form id="coach-settings-form">
        <div class="pilot-inline">
        <label>Ім’я користувача в Telegram<input name="telegram" maxlength="33" spellcheck="false" value="${esc(settings.telegram)}" placeholder="@ім’я"></label>
        <label>Номер WhatsApp з кодом країни<input name="whatsapp" type="tel" maxlength="24" value="${esc(settings.whatsapp)}"></label>
        </div>
        <label class="pilot-choice"><input type="checkbox" name="support" ${settings.support ? "checked" : ""}>Є домовленість про міжсесійний супровід</label>
        <label>Домовлений ритм звірок<input name="rhythm" maxlength="200" value="${esc(settings.rhythm)}"></label>
        <div class="pilot-actions"><button type="submit">Зберегти налаштування</button></div>
        <p id="coach-settings-status" role="status"></p>
      </form>
    </details></section>`;
}

function bindCoachSettings() {
  const form = $("#coach-settings-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const settings = {
      telegram: fields.get("telegram").trim().replace(/^@/, ""),
      whatsapp: fields.get("whatsapp").replace(/[+\s()-]/g, ""),
      support: fields.has("support"),
      rhythm: fields.get("rhythm").trim(),
    };
    if (!CoachPackage.validSettings(settings)) {
      $("#coach-settings-status").textContent = "Перевір ім’я Telegram і номер WhatsApp із кодом країни.";
      return;
    }
    const previous = state.pilot;
    state.pilot = { ...(state.pilot || Pilot.empty()), coachSettings: settings };
    if (!save()) {
      state.pilot = previous;
      return;
    }
    // Update only the contact card so the current report draft survives.
    $("#coach-settings").closest("section").outerHTML = renderCoachSettings();
    $("#coach-settings").open = true;
    bindCoachSettings();
    $("#coach-settings-form button").focus();
    $("#coach-settings-status").textContent = "Налаштування збережено.";
  };
}
