"use strict";

function calendarEditor(id) {
  const item = Q.find(mission()?.steps || [], id)?.node;
  if (!item) return;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
  modal(`<h2>Додати в Google Calendar</h2>
    <form id="calendar-form" class="pilot-card">
      <p><strong>${esc(item.name)}</strong></p>
      <div class="pilot-inline">
        <label>Дата роботи<input type="date" name="date" required value="${esc(item.plannedDate || today)}"></label>
        <label>Час початку<input type="time" name="time" required></label>
        <label>Тривалість, хв<input type="number" name="minutes" required min="1" max="1440" value="${item.minutes}"></label>
      </div>
      <p class="note">Часовий пояс пристрою: ${esc(zone)}. Подію потрібно зберегти в Google Calendar.</p>
      <p id="calendar-status" role="status"></p>
      <div class="pilot-actions"><button id="calendar-prepare" class="primary">Підготувати подію</button>
      <button type="button" id="calendar-sync" hidden>Синхронізувати з календарем</button>
      <a href="/account" id="calendar-account-link" hidden>Під’єднати Google Calendar</a>
      <a id="calendar-open" target="_blank" rel="noopener noreferrer" hidden>Відкрити Google Calendar</a>
      <button type="button" data-close>Закрити</button></div>
    </form>`);
  const form = $("#calendar-form");
  const link = $("#calendar-open");
  const status = $("#calendar-status");
  form.oninput = () => {
    link.hidden = true;
    link.removeAttribute("href");
    if (!globalThis.Workspace) status.textContent = "";
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const slot = CalendarTools.slot(data.get("date"), data.get("time"), Number(data.get("minutes")));
      link.href = CalendarTools.googleUrl(item.name, slot);
      link.hidden = false;
      link.focus();
    } catch (error) {
      status.textContent = error.message;
    }
  };

  if (globalThis.Workspace) void setupCalendarSync(form, item, status);
}

async function setupCalendarSync(form, item, status) {
  const button = form.querySelector("#calendar-sync");
  const route = "status?task=" + encodeURIComponent(item.id);
  const fields = { title: "Назва", start: "Початок", end: "Кінець", interval: "Інтервал", deleted: "Скасування події" };
  let current;

  function show(link) {
    current = link;
    form.querySelectorAll("[data-calendar-conflict]").forEach((row) => row.remove());
    button.textContent = link?.status === "conflict" ? "Застосувати вибір" : link?.status === "synced" ? "Оновити зв’язок" : "Синхронізувати з календарем";
    const labels = {
      synced: "Задача пов’язана з Google Calendar.",
      unscheduled: "Подію скасовано. Задача збережена.",
      conflict: "Google і Вершина мають різні зміни. Обери, яку версію застосувати.",
      unavailable: "Подія або доступ до календаря тимчасово недоступні.",
      retry: "Подія щойно змінилася. Спробуй ще раз.",
    };
    status.textContent = labels[link?.status] ?? "";
    for (const field of link?.conflict?.conflicts || []) {
      const label = document.createElement("label");
      label.dataset.calendarConflict = field;
      label.textContent = fields[field];
      const select = document.createElement("select");
      select.name = "choice-" + field;
      select.add(new Option("Обери версію", ""));
      if (field !== "deleted") select.add(new Option("Вершина: " + choiceValue(link.conflict.tracker, field), "tracker"));
      select.add(new Option(field === "deleted" ? "Прибрати слот, зберегти задачу" : "Google: " + choiceValue(link.conflict.calendar, field), "calendar"));
      label.append(select);
      status.before(label);
    }
  }

  function choiceValue(value, field) {
    if (field === "title") return value.title;
    const format = (time) => new Date(time).toLocaleString("uk-UA");
    return field === "interval" ? format(value.start) + " — " + format(value.end) : format(value[field]);
  }

  try {
    const result = await Workspace.calendar(route);
    if (result.enabled && !result.connected) form.querySelector("#calendar-account-link").hidden = false;
    if (!result.connected) return;
    button.hidden = false;
    if (result.link?.slot && result.link.status !== "unscheduled") {
      const date = new Date(result.link.slot.start);
      form.elements.date.value = new Intl.DateTimeFormat("sv-SE").format(date);
      form.elements.time.value = date.toTimeString().slice(0, 5);
      form.elements.minutes.value = (Date.parse(result.link.slot.end) - Date.parse(result.link.slot.start)) / 60000;
    }
    show(result.link);
  } catch {
    status.textContent = "Не вдалося перевірити підключення календаря.";
    return;
  }

  button.onclick = async () => {
    button.disabled = true;
    try {
      const body = { task: item.id };
      const data = new FormData(form);
      if (current?.status === "conflict") {
        body.choices = Object.fromEntries(current.conflict.conflicts.map((field) => [field, data.get("choice-" + field)]));
        if (Object.values(body.choices).some((choice) => !choice)) throw Error("Обери версію для кожного поля.");
      } else {
        if (!form.reportValidity()) return;
        body.slot = CalendarTools.slot(data.get("date"), data.get("time"), Number(data.get("minutes")));
      }
      const result = await Workspace.calendar("link", "POST", body);
      show(result.link);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
