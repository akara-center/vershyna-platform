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
      <a id="calendar-open" target="_blank" rel="noopener noreferrer" hidden>Відкрити Google Calendar</a>
      <button type="button" data-close>Закрити</button></div>
    </form>`);
  const form = $("#calendar-form");
  const link = $("#calendar-open");
  const status = $("#calendar-status");
  form.oninput = () => {
    link.hidden = true;
    link.removeAttribute("href");
    status.textContent = "";
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
}
