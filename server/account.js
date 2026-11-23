"use strict";

const $ = (id) => document.getElementById(id);
const login = $("login");
const upload = $("upload");
const status = $("status");
let workspace;
let busy = false;

async function api(path, method = "GET", data) {
  const options = { method, cache: "no-store" };
  if (data !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error), { status: response.status });
  return value;
}

function render() {
  login.hidden = Boolean(workspace);
  $("workspace").hidden = !workspace;
  $("account-info").textContent = workspace
    ? `Акаунт: ${workspace.account}. ${workspace.revision ? "Версія копії " + workspace.revision + "." : "Копій поки немає."}`
    : "";
  $("download").disabled = busy || !workspace?.tracker;
}

async function refresh() {
  try {
    workspace = await api("/api/workspace");
  } catch (error) {
    if (error.status !== 401) throw error;
    workspace = undefined;
  }
  render();
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
    await refresh();
  });
};
$("logout").onclick = () => void act(async () => {
  await api("/api/session", "DELETE");
  workspace = undefined;
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
    if (file.size > 4 * 1024 * 1024 - 128) throw Error("Файл перевищує допустимий розмір.");
    const tracker = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (workspace.revision && !window.confirm("Замінити поточну серверну копію цією версією?")) return;
    await api("/api/workspace", "PUT", { revision: workspace.revision, tracker });
    await refresh();
    upload.reset();
    status.textContent = "Копію збережено.";
  });
};
void act(refresh);
