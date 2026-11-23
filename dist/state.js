"use strict";
// Shared state, selectors, persistence and dated backups. Initialization runs from app.js.

const KEY = "vershyna-platform-v1",
  Q = QuestCore;

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const uid = () => crypto.randomUUID(),
  number = (n) => Number(n).toLocaleString("uk-UA", { maximumFractionDigits: 1 });

let state;

let persistenceBlocked = false;

let startupError = "";

const BACKUP_LABELS = [
  ["-before-coach-import", "Копія перед додаванням пакета коуча"],
  ["-before-github", "Копія перед перенесенням на GitHub"],
  ["-before-import", "Копія перед останнім імпортом"],
  ["-before-v4", "Копія перед оновленням"],
  ["-before-ui-upgrade", "Копія перед зміною інтерфейсу"],
  ["-before-transfer", "Копія перед перенесенням задачі"],
  ["-before-project-change", "Копія перед архівуванням або видаленням проєкту"],
];

function backupStamp(value) {
  return new Date(value).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function backupFilename(value) {
  return "vershyna-backup-" + new Date(value).toISOString().replace(/[:.]/g, "-") + ".json";
}

function writeBackup(suffix, raw) {
  Q.validate(JSON.parse(raw));
  const key = KEY + suffix,
    createdAt = new Date().toISOString();
  localStorage.setItem(key, raw);
  // Store dates separately to keep all existing JSON backups directly importable.
  try {
    localStorage.setItem(key + "-created-at", createdAt);
  } catch {
    localStorage.removeItem(key + "-created-at");
  }
}

function resetMigrationBackups(raw) {
  const marker = KEY + "-github-backup-reset-v1";
  if (localStorage.getItem(marker)) return;
  writeBackup("-before-github", raw);
  // Do not prune without verifying that the new copy and its date were saved.
  if (
    localStorage.getItem(KEY + "-before-github") !== raw ||
    !localStorage.getItem(KEY + "-before-github-created-at")
  )
    throw Error("Не вдалося створити датовану копію перед перенесенням.");
  localStorage.setItem(marker, "1");
  for (const suffix of [
    "-before-import",
    "-before-v4",
    "-before-ui-upgrade",
    "-before-transfer",
    "-before-project-change",
  ]) {
    localStorage.removeItem(KEY + suffix);
    localStorage.removeItem(KEY + suffix + "-created-at");
  }
}

function save() {
  if (persistenceBlocked) {
    toast(startupError);
    return false;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    toast("Не вдалося зберегти. Експортуй прогрес через «Дані».");
    return false;
  }
}

function mission() {
  return (
    state.missions.find((m) => m.id === state.active && !m.archived) ||
    state.missions.find((m) => !m.archived)
  );
}

function leaves(m = mission()) {
  return m?.steps.flatMap(Q.leaves) || [];
}

function nextStep() {
  return mission() ? Q.nextAction(mission()) : null;
}

function totalXP() {
  return state.missions.flatMap((m) => m.steps).reduce((sum, s) => sum + Q.earned(s), 0);
}

function initializeState() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : structuredClone(initial);
    if (!raw && document.getElementById?.("pilot-nav")) {
      state.missions = [structuredClone(demoMission)];
      state.active = demoMissionId;
      state.pilot = Pilot.empty();
      state.pilot.vision = { future: "У моєму тижні є час на рух і відновлення.", goal: "Сформувати звичку гуляти двічі на тиждень.", milestones: "Перша прогулянка → два виходи за тиждень.", project: demoMissionId };
    }
    Pilot.validate(state.pilot);
    Q.validate(state);
    state = Q.pruneTrash(Q.normalize(migrateState(state)));
    if (raw) {
      try {
        resetMigrationBackups(raw);
      } catch {
        startupError =
          "Не вдалося створити датовану копію перед перенесенням. Старі копії не видалено. Збережи JSON через «Дані».";
      }
    }
    if (!state.missions.some((m) => m.id === state.active))
      state.active = state.missions[0]?.id || null;
    try {
      if (!raw) {
        // A fresh profile has no legacy backups to reset on its next visit.
        localStorage.setItem(KEY + "-github-backup-reset-v1", "1");
      }
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      persistenceBlocked = true;
      startupError =
        "Прогрес прочитано, але браузер не дозволяє зберегти оновлення. Експортуй його через «Дані», перш ніж закривати сторінку.";
    }
  } catch (error) {
    state = Q.normalize(structuredClone(initial));
    persistenceBlocked = true;
    startupError =
      "Не вдалося прочитати або зберегти прогрес. Попередні дані не перезаписуються. Відкрий «Дані» та імпортуй свою копію.";
  }
}
