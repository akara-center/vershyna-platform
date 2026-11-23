const assert = require("node:assert/strict");
const test = require("node:test");
const tools = require("../dist/calendar.js");
const { googleCalendar, reconcile, merge } = require("../server/calendar-sync.cjs");

const base = { title: "Задача", start: "2026-12-02T14:00:00.000Z", end: "2026-12-02T14:30:00.000Z" };
const moved = { ...base, start: "2026-12-03T16:00:00.000Z", end: "2026-12-03T16:30:00.000Z" };
const event = ({ title, start, end }) => ({ summary: title, start: { dateTime: start }, end: { dateTime: end }, etag: '"r1"' });

test("Разова подія кодує назву, точний час і тривалість", () => {
  const slot = tools.slot("2026-12-03", "16:00", 45);
  const url = new URL(tools.googleUrl("План & зустріч", slot));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("text"), "План & зустріч");
  assert.match(url.searchParams.get("dates"), /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  assert.equal(Date.parse(slot.end) - Date.parse(slot.start), 45 * 60000);
  assert.throws(() => tools.slot("2026-02-30", "16:00", 45));
  assert.throws(() => tools.slot("2026-12-03", "24:00", 45));
});

test("Перенесення з обох боків, об'єднання полів і розв'язання конфлікту", () => {
  assert.deepEqual(merge(base, base, moved), { status: "synced", value: moved });
  assert.deepEqual(merge(base, moved, base), { status: "synced", value: moved });
  const renamed = { ...base, title: "Нова назва" };
  assert.deepEqual(merge(base, renamed, moved).value, { ...moved, title: renamed.title });
  const competing = { ...moved, title: "Інша назва" };
  assert.deepEqual(merge(base, renamed, competing).conflicts, ["title"]);
  assert.deepEqual(merge(base, renamed, competing, { title: "tracker" }).value,
    { ...moved, title: renamed.title });
  assert.equal(merge(base, base, null).status, "unscheduled");
  assert.deepEqual(merge(base, moved, null).conflicts, ["deleted"]);
});

test("Запис у Google має If-Match, конфлікт ревізії не затирає подію", async () => {
  const calls = [];
  const calendar = googleCalendar({ calendarId: "primary", accessToken: "test",
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (options.method === "PATCH") return Response.json({}, { status: 412 });
      return Response.json(event(base));
    },
  });
  assert.deepEqual(await reconcile(calendar, { eventId: "event", base, tracker: moved }), { status: "retry" });
  assert.equal(calls[1].headers["If-Match"], '"r1"');
  assert.deepEqual(Object.keys(JSON.parse(calls[1].body)).sort(), ["end", "start", "summary"]);
});

test("Скасування прибирає час із розкладу, недоступність API зберігає зв'язок", async () => {
  assert.deepEqual(await reconcile({ get: async () => ({ status: "cancelled" }) },
    { eventId: "event", base, tracker: base }), { status: "unscheduled" });
  assert.deepEqual(await reconcile({ get: async () => { throw Object.assign(Error(), { status: 404 }); } },
    { eventId: "event", base, tracker: base }), { status: "unavailable" });
});
