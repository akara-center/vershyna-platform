"use strict";

const list = document.getElementById("contract-list");
const detail = document.getElementById("contract-detail");
const status = document.getElementById("coach-status");
const labels = {
  name: "Назва", goal: "Ціль", why: "Сенс", change: "Зміна", criteria: "Критерії",
  result: "Результат", done: "Виконано", archived: "Архів", text: "Текст",
  scale: "Шкала", entries: "Оцінки", "new-step": "Новий підкрок",
};
let profile;
let selected;
let busy = false;

async function api(path, data) {
  const response = await fetch("/api/coach/" + path, {
    cache: "no-store", signal: AbortSignal.timeout(10000),
    ...(data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  if (response.status === 401) location.replace("/account");
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value;
}

async function act(task) {
  if (busy) return;
  busy = true;
  status.textContent = "";
  try {
    await task();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
}

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

function button(parent, name, action) {
  const button = element("button", name, parent);
  button.type = "button";
  button.onclick = () => void act(action);
  return button;
}

function field(form, name, title, type = "text") {
  const label = element("label", title, form);
  const input = element(type === "textarea" ? "textarea" : "input", undefined, label);
  input.name = name;
  if (input.tagName === "INPUT") input.type = type;
  return input;
}

function form(parent, caption, build, send) {
  const node = element("form", undefined, parent);
  node.className = "pilot-card";
  build(node);
  const submit = element("button", caption, node);
  submit.type = "submit";
  node.onsubmit = (event) => {
    event.preventDefault();
    void act(() => send(new FormData(node)));
  };
  return node;
}

function download(value, name) {
  const anchor = element("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshList() {
  const data = await api("contracts");
  const coach = profile.role === "coach";
  list.replaceChildren();
  element("h2", "Контракти", list);
  for (const contract of data.contracts) {
    const name = coach ? contract.client_id : contract.coach_id;
    const text = (contract.status === "active" ? "Активний" : "Завершений") + " · " + name + " · " + contract.started.slice(0, 10);
    button(list, text, async () => { selected = contract; await refreshDetail(); });
  }
  if (!data.contracts.length) element("p", "Контрактів поки немає.", list);
  if (coach || !data.contracts.some((contract) => contract.status === "active")) {
    const hasTracker = !coach && data.hasTracker;
    form(list, "Створити контракт", (node) => {
      field(node, coach ? "client" : "coach", coach ? "Акаунт клієнта" : "Акаунт коуча").required = true;
      if (hasTracker) {
        field(node, "fresh", "Почати з нового трекера та перенести поточний в архів", "checkbox");
        const scope = element("details", undefined, node);
        element("summary", "Обрати блоки поточного трекера", scope);
        for (const item of data.selectable) field(scope, "scope", item.label, "checkbox").value = item.id;
      }
    }, async (values) => {
      const result = await api("contracts", { [coach ? "client" : "coach"]: values.get(coach ? "client" : "coach").trim(),
        fresh: values.has("fresh"), scopes: values.getAll("scope") });
      selected = result;
      await refreshList();
      await refreshDetail();
    });
  }
  if (data.archives.length) {
    element("h2", "Попередні трекери", list);
    for (const archive of data.archives) button(list, "Завантажити копію · " + archive.at.slice(0, 10),
      async () => download(await api("previous/" + archive.id), "vershyna-archive-" + archive.at.slice(0, 10) + ".json"));
  }
}

async function mutate(payload, reloadList = false) {
  await api("contracts/" + selected.id, payload);
  if (reloadList) await refreshList();
  await refreshDetail();
}

function print(value) {
  if (typeof value === "boolean") return value ? "Так" : "Ні";
  if (Array.isArray(value)) return value.map((row) => [row.date || row.day, row.value].filter((item) => item !== undefined).join(" · ")).join("\n");
  return String(value ?? "");
}

function lineDiff(parent, before, after) {
  const pieces = Collaboration.diff(print(before), print(after));
  parent.append(document.createTextNode(pieces.prefix));
  if (pieces.removed) element("del", pieces.removed, parent);
  if (pieces.added) element("ins", pieces.added, parent);
  parent.append(document.createTextNode(pieces.suffix));
}

function proposals(parent, data, coach) {
  element("h3", "Пропозиції", parent);
  for (const proposal of data.proposals) {
    const section = element("section", undefined, parent);
    section.className = "pilot-card";
    if (!coach && proposal.changes.some((row) => row.status === "pending")) {
      form(section, "Застосувати вибране", (node) => {
        for (const row of proposal.changes) {
          const label = element("label", row.label + " · " + (labels[row.field] || row.field), node);
          if (row.status === "pending") {
            const input = element("input", undefined, label);
            input.type = "checkbox"; input.name = "change"; input.value = row.id;
          } else element("span", " · Застосовано", label);
          lineDiff(element("p", undefined, label), row.before, row.after);
        }
      }, (values) => mutate({ action: "accept", id: proposal.id, changes: values.getAll("change") }));
    } else {
      for (const row of proposal.changes) {
        element("strong", row.label + " · " + (labels[row.field] || row.field), section);
        lineDiff(element("p", undefined, section), row.before, row.after);
        if (row.status === "accepted") element("p", "Застосовано", section);
      }
    }
    for (const message of proposal.messages)
      element("p", (message.role === "coach" ? "Коуч" : "Клієнт") + " · " + message.text, section);
    form(section, "Надіслати повідомлення", (node) => {
      field(node, "message", "Повідомлення до пропозиції", "textarea").required = true;
    }, (values) => mutate({ action: "message", id: proposal.id, text: values.get("message") }));
  }
  if (!data.proposals.length) element("p", "Пропозицій поки немає.", parent);
}

async function refreshDetail() {
  const data = await api("contracts/" + selected.id);
  const coach = profile.role === "coach";
  const openPanels = new Set([...detail.querySelectorAll("details[open][data-panel]")]
    .map((node) => node.dataset.panel));
  function panel(parent, id, heading) {
    const node = element("details", undefined, parent);
    node.dataset.panel = id;
    node.open = openPanels.has(id);
    element("summary", heading, node);
    return node;
  }
  detail.hidden = false;
  detail.replaceChildren();
  const heading = element("h2", data.status === "active" ? "Активна співпраця" : "Завершена співпраця", detail);
  heading.tabIndex = -1;
  if (coach) {
    button(detail, data.suspended ? "Відновити доступ до трекера" : "Призупинити доступ до трекера", async () => {
      if (data.suspended || confirm("Призупинити доступ клієнта до трекерів? Дані збережуться."))
        await mutate({ action: "suspend", enabled: !data.suspended });
    });
    const archive = panel(detail, "archive", "Мій робочий архів");
    for (const note of data.notes) {
      element("p", note.at.slice(0, 10) + " · " + note.text, archive);
      button(archive, "Видалити нотатку", async () => {
        if (confirm("Видалити нотатку з архіву?")) await mutate({ action: "delete-note", id: note.id });
      });
    }
    form(archive, "Зберегти нотатку", (node) => {
      field(node, "note", "Приватна нотатка коуча", "textarea").required = true;
    }, (values) => mutate({ action: "archive-note", text: values.get("note") }));
  }
  if (data.status !== "active") return;
  button(detail, "Завершити спільний доступ", async () => {
    if (confirm("Завершити спільний доступ до трекера?")) await mutate({ action: "finish" }, true);
  });
  if (coach && data.phase === "setup") {
    form(detail, "Додати початковий пакет", (node) => {
      field(node, "packet", "JSON-пакет маршруту", "textarea").required = true;
    }, (values) => mutate({ action: "setup", package: values.get("packet") }));
    button(detail, "Передати трекер клієнтові", async () => {
      if (confirm("Передати трекер? Подальші правки оформлюватимуться як пропозиції.")) await mutate({ action: "handoff" }, true);
    });
  }
  if (coach) {
    const feed = panel(detail, "feed", "Стрічка змін · непрочитаних " + data.unread);
    if (data.unread) button(feed, "Позначити видимі зміни переглянутими", () => mutate({ action: "read" }));
    for (const event of data.events) {
      element("h4", (event.viewed ? "" : "• ") + event.label, feed);
      for (const field of new Set([...Object.keys(event.before || {}), ...Object.keys(event.after || {})])) {
        if (JSON.stringify(event.before?.[field]) === JSON.stringify(event.after?.[field])) continue;
        const line = element("p", (labels[field] || field) + " · ", feed);
        lineDiff(line, event.before?.[field], event.after?.[field]);
      }
    }
  }
  const blocks = panel(detail, "blocks", coach ? "Доступні блоки" : "Видимість блоків для коуча");
  const editable = [];
  for (const block of data.blocks) {
    const row = element("section", undefined, blocks);
    element("h4", block.label, row);
    if (block.parent) {
      const parent = data.blocks.find((item) => item.id === block.parent);
      if (parent) element("p", "У блоці «" + parent.label + "»", row);
    }
    if (!coach) {
      const hidden = data.privateIds.includes(block.id);
      button(row, hidden ? "Відкрити блок" : "Закрити блок", async () => {
        await mutate({ action: "visibility", block: block.id, private: !hidden });
      });
    }
    if (coach && /^(project|step):/.test(block.id)) editable.push({ block, field: "new-step" });
    for (const [field, value] of Object.entries(block.fields)) {
      element("p", (labels[field] || field) + " · " + print(value), row);
      if (coach && typeof value === "string" && !block.id.startsWith("indicator:"))
        editable.push({ block, field, value });
    }
  }
  if (coach && data.phase === "shared" && editable.length) {
    form(detail, "Надіслати пропозицію", (node) => {
      const options = panel(node, "proposal", "Обрати поля для пропозиції");
      editable.forEach(({ block, field: key }, index) => {
        field(options, "edit-" + index, block.label + " · " + (labels[key] || key), "textarea");
      });
    }, (values) => mutate({ action: "propose", changes: editable.flatMap(({ block, field }, index) => {
      const text = values.get("edit-" + index).trim();
      return text ? [{ block: block.id, field, text }] : [];
    }) }));
  }
  proposals(detail, data, coach);
}

void act(async () => {
  profile = await api("profile");
  document.getElementById("title").textContent = profile.role === "coach" ? "Кабінет коуча" : "Співпраця з коучем";
  if (profile.suspended) {
    status.textContent = "Доступ до трекера призупинено.";
    return;
  }
  await refreshList();
});
