"use strict";

const CalendarTools = (() => {
  function slot(date, time, minutes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) ||
        !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      throw Error("Вкажи дату, час і тривалість від 1 до 1440 хвилин.");
    const start = new Date(date + "T" + time);
    const pad = (value) => String(value).padStart(2, "0");
    if (!Number.isFinite(+start) || start.getFullYear() !== Number(date.slice(0, 4)) ||
        start.getMonth() + 1 !== Number(date.slice(5, 7)) || start.getDate() !== Number(date.slice(8)) ||
        pad(start.getHours()) + ":" + pad(start.getMinutes()) !== time)
      throw Error("Цей час недоступний у часовому поясі пристрою. Вибери інший.");
    return { start: start.toISOString(), end: new Date(+start + minutes * 60000).toISOString() };
  }

  function googleUrl(title, { start, end }) {
    const compact = (stamp) => stamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const url = new URL("https://calendar.google.com/calendar/render");
    url.search = new URLSearchParams({ action: "TEMPLATE", text: title, dates: compact(start) + "/" + compact(end) });
    return url.toString();
  }

  return { slot, googleUrl };
})();
if (typeof module !== "undefined" && module.exports) module.exports = CalendarTools;
