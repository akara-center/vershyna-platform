"use strict";

const C = Collaboration;
const key = "vershyna-collaboration-demo-v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (text) => String(text ?? "").replace(/[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const format = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short",
});
const now = () => new Date().toISOString();
const sample = () => {
  const data = { trackers: [], trackerId: null, contracts: [], proposals: [], notes: [], seq: 0 };
  C.start(data, { id: "demo-contract", trackerId: "demo-tracker", initial: true });
  for (const entry of [
    { id: "vision", label: "Бачення", text: "Працюю в ритмі, який залишає час на відновлення." },
    { id: "goal", label: "Ціль", text: "Знайти одну паузу на відновлення щотижня." },
    { id: "task", parent: "goal", label: "Задача", text: "Запланувати прогулянку в календарі." },
  ]) C.change(data, "coach", { ...entry, op: "add" }, now());
  C.current(data).phase = "shared";
  C.change(data, "client", { id: "goal", op: "edit", text: "Знайти дві паузи на відновлення щотижня." }, now());
  return data;
};

let store;
try {
  store = JSON.parse(localStorage.getItem(key)) || sample();
} catch {
  store = sample();
}
let role = "coach";

function commit(run, success = "Збережено.") {
  try {
    const draft = structuredClone(store);
    const next = run(draft) ?? draft;
    localStorage.setItem(key, JSON.stringify(next));
    store = next;
    render();
    $("#collab-status").textContent = success;
  } catch (error) {
    $("#collab-status").textContent = error.message || "Не вдалося зберегти зміни.";
  }
}

function highlighted(before, after) {
  const d = C.diff(before, after);
  return `${esc(d.prefix)}${d.removed ? `<del>${esc(d.removed)}</del>` : ""}${d.added ? `<ins>${esc(d.added)}</ins>` : ""}${esc(d.suffix)}`;
}

function render() {
  if (role === "client" && !C.clientCanUse(store)) {
    $("#collab-view").innerHTML = `<section class="card pilot-card">
      <h2>Доступ до трекера заблоковано</h2><p>Доступ може відновити коуч.</p></section>`;
    return;
  }
  const contract = C.current(store);
  const t = C.tracker(store, role === "coach" ? contract.trackerId : store.trackerId);
  const active = C.active(store) && contract.trackerId === t.id;
  const view = C.coachView(store);
  const blocks = role === "coach" ? view.blocks : t.blocks;
  const byId = new Map(blocks.map((item) => [item.id, item]));
  const proposals = role === "coach" ? view.proposals :
    store.proposals.filter((item) => active && item.contractId === contract.id);
  const operations = { add: "Додано", edit: "Змінено", delete: "Видалено" };

  const feed = `<section class="card pilot-card"><h2>Зміни клієнта · ${view.unread} нових</h2>
    ${view.events.length ? `<button type="button" id="collab-read" ${view.unread ? "" : "disabled"}>Позначити переглянутими</button>
    ${[...view.events].reverse().map((event) => `<article class="collab-row ${!contract.read.includes(event.seq) ? "collab-unread" : ""}">
      <strong>${!contract.read.includes(event.seq) ? "Нове · " : ""}${operations[event.operation]} · ${esc(event.label)}</strong>
      <time datetime="${esc(event.at)}" class="note">${format.format(new Date(event.at))}</time>
      <div class="collab-diff">${highlighted(event.before, event.after)}</div>
      ${byId.has(event.blockId) ? `<a class="collab-jump" href="#block-${encodeURIComponent(event.blockId)}" data-jump="${esc(event.blockId)}">Відкрити блок</a>` : ""}
    </article>`).join("")}` : "<p>Нових видимих змін поки немає.</p>"}</section>`;

  const blockList = `<section class="card pilot-card"><h2>${role === "client" ? "Мої блоки" : "Відкриті блоки клієнта"}</h2>
    ${role === "client" ? '<p class="note">Приватний блок і його підблоки видно тобі. Коуч не бачить їхнього вмісту та правок, доки ти знову не відкриєш доступ.</p>' : ""}
    ${blocks.map((item) => {
      const hidden = t.private.includes(item.id);
      const inherited = !hidden && role === "client" && C.scope(t, item).some((id) => t.private.includes(id));
      const canEdit = role === "client" || contract.phase === "setup";
      return `<article class="collab-row" id="block-${esc(item.id)}"><h3 tabindex="-1">${esc(item.label)}</h3>
        ${byId.has(item.parent) ? `<p class="note">У блоці «${esc(byId.get(item.parent).label)}»</p>` : ""}
        ${role === "client" && (hidden || inherited) ? `<p class="note">${hidden ? "Приватний блок" : "Приховано разом із батьківським блоком"}</p>` : ""}
        <p class="collab-text">${esc(item.text)}</p>
        ${canEdit ? `<form data-block-form="${esc(item.id)}"><label>Текст блока<textarea name="text" rows="2" required maxlength="2000">${esc(item.text)}</textarea></label>
        <div class="pilot-actions"><button>Зберегти текст</button></div></form>` : ""}
        <div class="pilot-actions">
        ${role === "client" ? `<button type="button" data-visibility="${esc(item.id)}">${hidden ? "Відкрити коучу" : "Зробити приватним"}</button>` : ""}
        ${canEdit && !blocks.some((child) => child.parent === item.id) ? `<button type="button" data-remove-block="${esc(item.id)}">Видалити блок</button>` : ""}
        </div></article>`;
    }).join("") || "<p>Блоків поки немає.</p>"}
    ${role === "client" || (active && contract.phase === "setup") ? `<details><summary>Додати блок</summary>
    <form id="collab-add"><label>Назва<input name="label" maxlength="100" required></label>
    <label>Батьківський блок<select name="parent"><option value="">На верхньому рівні</option>
      ${blocks.map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join("")}</select></label>
    <label>Текст нового блока<textarea name="text" rows="2" required maxlength="2000"></textarea></label>
    <button>Додати запис</button></form></details>` : ""}</section>`;

  const proposalsSection = `<section class="card pilot-card"><h2>Пропозиції змін</h2>
    ${role === "coach" && active && contract.phase === "shared" && blocks.length ? `<details><summary>Підготувати пропозицію</summary>
      <form id="collab-propose">${blocks.map((item) => `<label>${esc(item.label)}<textarea name="edit:${esc(item.id)}" rows="2" maxlength="2000" placeholder="Текст, який пропонуєш замість поточного"></textarea></label>`).join("")}
      <fieldset><legend>Запропонувати новий блок</legend>
        <label>Назва нового блока<input name="new-label" maxlength="100"></label>
        <label>Батьківський блок<select name="new-parent"><option value="">На верхньому рівні</option>
          ${blocks.map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join("")}</select></label>
        <label>Текст нового блока<textarea name="new-text" rows="2" maxlength="2000"></textarea></label></fieldset>
      <button>Надіслати пропозицію в демо</button></form></details>` : ""}
    ${proposals.map((proposal) => `<article class="collab-row"><h3>Корективи до трекера</h3>
      <form data-accept="${esc(proposal.id)}">${proposal.rows.map((row) => `<label class="pilot-choice">
        ${role === "client" && row.status === "pending" ? `<input type="checkbox" name="change" value="${esc(row.id)}">` : ""}
        <span><strong>${esc(row.label)}${row.status === "accepted" ? " · застосовано" : ""}</strong><br>
        <span class="collab-diff">${highlighted(row.before, row.text)}</span></span></label>`).join("")}
      ${role === "client" && proposal.rows.some((row) => row.status === "pending") ? "<button>Застосувати вибране</button>" : ""}</form>
      ${proposal.messages.map((item) => `<p class="collab-text"><strong>${item.role === "coach" ? "Коуч" : "Клієнт"}:</strong> ${esc(item.text)}</p>`).join("")}
      <form data-message="${esc(proposal.id)}"><label>Запитання або відповідь<textarea name="message" rows="2" maxlength="2000" required></textarea></label>
      <button>Додати повідомлення</button></form></article>`).join("") || "<p>Пропозицій поки немає.</p>"}</section>`;

  const notes = `<section class="card pilot-card"><h2>Робочі нотатки коуча</h2>
    ${store.notes.map((row) => `<div class="collab-row"><form data-note="${esc(row.id)}"><label>Приватна нотатка<textarea name="text" rows="2" maxlength="2000" required>${esc(row.text)}</textarea></label>
    <button>Зберегти нотатку</button></form><button type="button" data-remove-note="${esc(row.id)}">Видалити нотатку</button></div>`).join("")}
    <form id="collab-note"><label>Нова приватна нотатка<textarea name="text" rows="2" maxlength="2000" required></textarea></label><button>Додати нотатку</button></form></section>`;

  const clientAccess = role === "coach" ? `<section class="card pilot-card">
    <h2>Доступ клієнта до трекера</h2><p>${C.clientCanUse(store) ? "Доступ дозволено" : "Доступ заблоковано"}</p>
    ${C.clientCanUse(store) ? `<details id="collab-block-client">
      <summary>Заблокувати доступ клієнта</summary>
      <p>Клієнт втратить можливість відкрити й редагувати свої трекери в демо. Дані збережуться. Доступ можна відновити.</p>
      <button type="button" id="collab-confirm-block">Підтвердити блокування</button></details>` :
      '<button type="button" id="collab-unblock-client">Відновити доступ клієнта</button>'}</section>` : "";

  const lifecycle = `<section class="card pilot-card"><h2>Спільний доступ</h2>
    <p>${active ? (contract.phase === "setup" ? "Перше налаштування" : "Співпраця активна") : "Доступ коуча закрито"}</p>
    ${role === "coach" && active && contract.phase === "setup" ? '<button type="button" id="collab-publish">Передати налаштований трекер</button>' : ""}
    ${active ? '<button type="button" id="collab-finish">Закрити спільний доступ</button>' : ""}
    ${!C.active(store) && role === "client" ? `<form id="collab-renew"><fieldset><legend>Відкрити в наявному трекері</legend>
      ${t.blocks.filter((item) => C.scope(t, item).every((id) => !t.private.includes(id))).map((item) =>
        `<label class="pilot-choice"><input type="checkbox" name="scope" value="${esc(item.id)}"> ${esc(item.label)}</label>`).join("")}
      <button>Відкрити вибране для нового контракту</button></fieldset></form>` : ""}
    ${!active && role === "coach" ? '<button type="button" id="collab-fresh">Створити новий трекер</button>' : ""}
    ${role === "client" && store.trackers.length > 1 ? `<label>Збережені трекери<select id="collab-trackers">
      ${store.trackers.map((item, index) => `<option value="${esc(item.id)}" ${t.id === item.id ? "selected" : ""}>Трекер ${index + 1}</option>`).join("")}</select></label>` : ""}</section>`;

  $("#collab-view").innerHTML = role === "coach"
    ? feed + clientAccess + blockList + proposalsSection + notes + lifecycle
    : blockList + proposalsSection + lifecycle;
  bind(t);
}

function bind(t) {
  function form(selector, handler) {
    $$(selector).forEach((element) => element.onsubmit = (event) => {
      event.preventDefault();
      handler(new FormData(element), element.dataset);
    });
  }
  function click(selector, handler) {
    $$(selector).forEach((element) => element.onclick = () => handler(element.dataset));
  }
  click("#collab-read", () => commit((draft) => {
    const contract = C.current(draft);
    contract.read = [...new Set([...contract.read, ...C.coachView(draft).events.map((event) => event.seq)])];
  }, "Видимі зміни позначено переглянутими."));
  $$("[data-jump]").forEach((link) => link.onclick = (event) => {
    const target = document.getElementById("block-" + link.dataset.jump);
    if (!target) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    $(".collab-destination")?.classList.remove("collab-destination");
    target.classList.add("collab-destination");
    target.querySelector("h3").focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
    history.replaceState(null, "", link.hash);
  });
  click("#collab-confirm-block", () => commit((draft) => C.setClientAccess(draft, role, false),
    "Доступ клієнта заблоковано. Записи збережено."));
  click("#collab-unblock-client", () => commit((draft) => C.setClientAccess(draft, role, true),
    "Доступ клієнта відновлено."));
  form("[data-block-form]", (fields, { blockForm }) => commit((draft) => {
    C.change(draft, role, { op: "edit", trackerId: t.id, id: blockForm, text: fields.get("text") }, now());
  }));
  form("#collab-add", (fields) => commit((draft) => {
    C.change(draft, role, { op: "add", trackerId: t.id, id: crypto.randomUUID(),
      label: fields.get("label"), text: fields.get("text"), parent: fields.get("parent") }, now());
  }));
  click("[data-remove-block]", ({ removeBlock }) => {
    if (!window.confirm("Видалити цей блок із демонстраційного трекера?")) return;
    commit((draft) => { C.change(draft, role, { op: "delete", trackerId: t.id, id: removeBlock }, now()); });
  });
  click("[data-visibility]", ({ visibility }) => commit((draft) => {
    const selected = C.tracker(draft, t.id).private;
    if (selected.includes(visibility)) selected.splice(selected.indexOf(visibility), 1);
    else selected.push(visibility);
  }, "Видимість збережено."));
  form("#collab-propose", (fields) => commit((draft) => {
    const changes = [...fields].filter(([name, text]) => name.startsWith("edit:") && text.trim())
      .map(([name, text]) => ({ id: name.slice(5), text }));
    if (fields.get("new-label").trim() || fields.get("new-text").trim()) {
      changes.push({ id: crypto.randomUUID(), operation: "add", label: fields.get("new-label"),
        parent: fields.get("new-parent"), text: fields.get("new-text") });
    }
    C.propose(draft, crypto.randomUUID(), changes);
  }, "Пропозицію підготовлено для клієнта."));
  form("[data-accept]", (fields, { accept }) => commit((draft) => C.decide(draft, accept, fields.getAll("change"), now())));
  form("[data-message]", (fields, { message }) => commit((draft) => {
    C.message(draft, role, message, fields.get("message"));
  }));
  form("#collab-note", (fields) => commit((draft) => {
    const text = fields.get("text").trim();
    if (!text) throw Error("Додай текст нотатки.");
    draft.notes.push({ id: crypto.randomUUID(), text });
  }));
  form("[data-note]", (fields, { note }) => commit((draft) => {
    const text = fields.get("text").trim();
    if (!text) throw Error("Додай текст нотатки.");
    draft.notes.find((item) => item.id === note).text = text;
  }));
  click("[data-remove-note]", ({ removeNote }) => {
    if (!window.confirm("Видалити приватну нотатку?")) return;
    commit((draft) => { draft.notes = draft.notes.filter((item) => item.id !== removeNote); });
  });
  click("#collab-publish", () => commit((draft) => { C.current(draft).phase = "shared"; }));
  click("#collab-finish", () => commit(C.finish, "Спільний доступ закрито. Трекер збережено в клієнта."));
  form("#collab-renew", (fields) => commit((draft) => {
    C.start(draft, { id: crypto.randomUUID(), trackerId: t.id, scopes: fields.getAll("scope") });
  }));
  click("#collab-fresh", () => commit((draft) => {
    C.start(draft, { id: crypto.randomUUID(), trackerId: crypto.randomUUID(), initial: true });
  }));
  if ($("#collab-trackers")) $("#collab-trackers").onchange = (event) => commit((draft) => {
    draft.trackerId = event.target.value;
  });
}

$$("[data-role]").forEach((tab) => tab.onclick = () => {
  role = tab.dataset.role;
  $$("[data-role]").forEach((other) => {
    if (tab === other) other.setAttribute("aria-current", "page");
    else other.removeAttribute("aria-current");
  });
  $("#collab-status").textContent = "";
  render();
});
render();
