"use strict";

const $ = (id) => document.getElementById(id);
const login = $("login");
const upload = $("upload");
const status = $("status");
let workspace;
let profile;
let busy = false;

async function api(path, method = "GET", data) {
  const options = { method, cache: "no-store", headers: {} };
  if (profile && !(path === "/api/session" && method === "POST"))
    options.headers["X-Vershyna-Account"] = profile.account;
  if (data !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error), { status: response.status });
  return value;
}

function render() {
  $("sign-in").hidden = Boolean(workspace || profile?.suspended);
  $("tracker-link").hidden = !workspace;
  $("blocked-logout").hidden = !profile?.suspended;
  $("coach-link").textContent = profile?.role === "coach" ? "Кабінет коуча" : "Співпраця з коучем";
  $("workspace").hidden = !workspace;
  if (!workspace) {
    $("calendar-account").hidden = true;
    $("drive-backup").hidden = true;
  }
  $("account-identity").textContent = profile ? "Ви увійшли як " + (profile.email ?? profile.account) : "";
  $("account-info").textContent = workspace
    ? `Акаунт: ${workspace.account}. ${workspace.revision ? "Версія копії " + workspace.revision + "." : "Копій поки немає."}`
    : "";
  $("download").disabled = busy || !workspace?.tracker;
}

async function refresh() {
  try {
    profile = await api("/api/coach/profile");
    workspace = profile.suspended ? undefined : await api("/api/workspace");
    if (profile.suspended) status.textContent = "Доступ до трекерів призупинено.";
  } catch (error) {
    if (error.status !== 401) throw error;
    workspace = undefined;
    profile = undefined;
  }
  render();
  $("calendar-account").hidden = !workspace;
  if (workspace) {
    await refreshDriveBackup();
    const calendar = await api("/api/calendar/status");
    $("calendar-account").hidden = !calendar.enabled;
    $("calendar-connect").hidden = calendar.connected;
    $("calendar-disconnect").hidden = !calendar.connected;
    $("calendar-info").textContent = calendar.connected ? "Календар під’єднано." : "Календар ще не під’єднано.";
    if (["cancelled", "error"].includes(new URLSearchParams(location.search).get("google")))
      $("calendar-info").textContent = "Під’єднання не завершилося. Спробуй ще раз.";
  }
}

async function refreshDriveBackup() {
  const section = $("drive-backup");
  section.hidden = true;
  if (profile?.role !== "coach") return;
  const drive = await api("/api/drive-backup/status");
  if (!drive.enabled) return;
  section.hidden = false;
  const folder = $("drive-backup-folder");
  folder.hidden = !drive.folder;
  if (drive.folder) folder.href = drive.folder;
  $("drive-backup-connect").hidden = drive.connected && drive.error !== "reconnect";
  $("drive-backup-disconnect").hidden = !drive.connected;
  let message = "Під’єднай Google-акаунт, на Диск якого зберігати копії.";
  if (drive.connected) message = drive.lastDate ? "Остання копія: " + drive.lastDate + "." : "Диск під’єднано. Перша копія ще готується.";
  if (drive.error === "retry") message += " Остання спроба запису не вдалася. Сервер повторить її.";
  if (drive.error === "reconnect") message += " Доступ Google завершився. Під’єднай Диск знову.";
  if (new URLSearchParams(location.search).get("driveBackup") === "error") message += " Під’єднання не завершилося.";
  $("drive-backup-info").textContent = message;
}

async function act(task) {
  if (busy) return;
  busy = true;
  status.textContent = "";
  try {
    await task();
  } catch (error) {
    if (error.status === 401) {
      workspace = undefined;
      profile = undefined;
      render();
    }
    status.textContent = error instanceof SyntaxError ? "Файл не вдалося прочитати як JSON." : error.message;
  } finally {
    busy = false;
    render();
  }
}

login.onsubmit = (event) => {
  event.preventDefault();
  void act(async () => {
    const key = new FormData(login).get("key").trim();
    login.reset();
    await api("/api/session", "POST", { key });
    profile = undefined;
    location.assign("/tracker");
  });
};
$("logout").onclick = $("blocked-logout").onclick = () => void act(async () => {
  await api("/api/session", "DELETE");
  workspace = undefined;
  profile = undefined;
  upload.reset();
});
$("reload").onclick = () => void act(refresh);
$("download").onclick = () => {
  if (!workspace?.tracker || busy) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(workspace.tracker, null, 2)], { type: "application/json" }));
  link.download = `vershyna-account-v${workspace.revision}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
upload.onsubmit = (event) => {
  event.preventDefault();
  void act(async () => {
    const file = new FormData(upload).get("file");
    if (file.size > 8 * 1024 * 1024) throw Error("Файл перевищує допустимий розмір.");
    const tracker = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (workspace.revision && !window.confirm("Замінити поточну серверну копію цією версією?")) return;
    await api("/api/workspace", "PUT", { revision: workspace.revision, tracker, account: workspace.account });
    await refresh();
    upload.reset();
    status.textContent = "Копію збережено.";
  });
};
void act(async () => {
  await refresh();
  const loginResult = new URLSearchParams(location.search).get("login");
  if (loginResult === "failed") status.textContent = "Не вдалося увійти через Google. Спробуй ще раз.";
  if (loginResult === "unavailable") status.textContent = "Вхід для цього Google-акаунта поки недоступний.";
});
$("calendar-connect").onclick = () => void act(async () => {
  location.assign((await api("/api/calendar/connect", "POST")).url);
});
$("calendar-disconnect").onclick = () => void act(async () => {
  if (!confirm("Від’єднати календар? Події залишаться в Google Calendar.")) return;
  await api("/api/calendar/connect", "DELETE");
  await refresh();
});

$("drive-backup-connect").onclick = () => void act(async () => {
  location.assign((await api("/api/drive-backup/connect", "POST")).url);
});
$("drive-backup-disconnect").onclick = () => void act(async () => {
  if (!confirm("Від’єднати Google Диск? Створені файли залишаться на Диску.")) return;
  await api("/api/drive-backup/connect", "DELETE");
  await refreshDriveBackup();
});
