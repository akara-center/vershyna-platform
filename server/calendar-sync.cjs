"use strict";

const FIELDS = ["title", "start", "end"];

function eventValues(event) {
  if (!event || event.status === "cancelled") return null;
  if (event.recurrence?.length || event.recurringEventId || !event.start?.dateTime || !event.end?.dateTime)
    throw Error("Для синхронізації потрібна одноразова подія з визначеним часом.");
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start)
    throw Error("Некоректний час події.");
  return { title: event.summary ?? "", start: start.toISOString(), end: end.toISOString() };
}

function merge(base, tracker, calendar, choices = {}) {
  if (!calendar) {
    if (FIELDS.some((field) => base[field] !== tracker[field]) && choices.deleted !== "calendar")
      return { status: "conflict", conflicts: ["deleted"], tracker, calendar: null };
    return { status: "unscheduled" };
  }
  const value = {};
  const conflicts = [];
  for (const field of FIELDS) {
    const editedInTracker = base[field] !== tracker[field];
    const editedInCalendar = base[field] !== calendar[field];
    if (editedInTracker && editedInCalendar && tracker[field] !== calendar[field]) {
      if (!["tracker", "calendar"].includes(choices[field])) conflicts.push(field);
      value[field] = choices[field] === "tracker" ? tracker[field] : calendar[field];
    } else value[field] = editedInTracker ? tracker[field] : calendar[field];
  }
  if (conflicts.length) return { status: "conflict", conflicts, tracker, calendar };
  if (Date.parse(value.start) >= Date.parse(value.end)) {
    if (!["tracker", "calendar"].includes(choices.interval))
      return { status: "conflict", conflicts: ["interval"], tracker, calendar };
    const selected = choices.interval === "tracker" ? tracker : calendar;
    value.start = selected.start;
    value.end = selected.end;
  }
  return { status: "synced", value };
}

function body(value) {
  return { summary: value.title, start: { dateTime: value.start }, end: { dateTime: value.end } };
}

// Expects an authenticated, calendar-scoped connection resolved by the caller.
function googleCalendar({ accessToken, calendarId, fetch: request = globalThis.fetch }) {
  const root = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events";
  async function send(url, method, payload, etag) {
    const response = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      const error = Error(`Google Calendar API: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  const eventUrl = (id) => root + "/" + encodeURIComponent(id);
  return {
    get: (id) => send(eventUrl(id), "GET"),
    changes: ({ pageToken, syncToken }) => {
      const params = new URLSearchParams({ showDeleted: "true", fields: "items(id,status),nextPageToken,nextSyncToken" });
      if (pageToken) params.set("pageToken", pageToken);
      if (syncToken) params.set("syncToken", syncToken);
      return send(root + "?" + params, "GET");
    },
    create: (id, value) => {
      if (!/^[0-9a-v]{5,1024}$/.test(id)) throw Error("Некоректний ідентифікатор події.");
      return send(root, "POST", { id, ...body(value) });
    },
    patch: (id, value, etag) => {
      if (!etag) throw Error("Версія Google-події відсутня.");
      return send(eventUrl(id), "PATCH", body(value), etag);
    },
  };
}

async function reconcile(calendar, { eventId, base, tracker, choices, cancelled }) {
  let event;
  if (cancelled) return merge(base, tracker, null, choices);
  try {
    event = await calendar.get(eventId);
  } catch (error) {
    // Missing and inaccessible events can have the same HTTP response.
    if ([404, 410].includes(error.status)) return { status: "unavailable" };
    throw error;
  }
  const remote = eventValues(event);
  const result = merge(base, tracker, remote, choices);
  if (result.status !== "synced") return result;
  if (FIELDS.every((field) => remote[field] === result.value[field])) return result;
  try {
    const saved = await calendar.patch(eventId, result.value, event.etag);
    return { status: "synced", value: eventValues(saved) };
  } catch (error) {
    if (error.status === 412) return { status: "retry" };
    if ([404, 410].includes(error.status)) return { status: "unavailable" };
    throw error;
  }
}

module.exports = { googleCalendar, reconcile, merge };
