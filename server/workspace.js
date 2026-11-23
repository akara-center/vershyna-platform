"use strict";

globalThis.Workspace = (() => {
  const bootstrap = JSON.parse(document.getElementById("workspace-data").textContent);
  document.getElementById("workspace-data").remove();
  const account = bootstrap.account;
  const keySuffix = "-account-" + account;
  const outbox = "vershyna-platform-v1" + keySuffix + "-outbox";
  const status = document.getElementById("workspace-status");
  const review = document.getElementById("workspace-review");
  let revision = bootstrap.revision;
  let raw;
  let draft;
  let storageError = false;
  try {
    raw = localStorage.getItem(outbox);
    draft = raw ? JSON.parse(raw) : null;
    if (raw && (!Number.isSafeInteger(draft?.revision) || !Array.isArray(draft.tracker?.missions)))
      throw Error("Некоректна чернетка.");
  } catch {
    storageError = true;
    draft = null;
  }
  let remote = null;
  let running = false;
  let closed = false;
  let timer;
  let writing = false;
  const editedForms = new Set();

  function hasUnsubmittedForm() {
    for (const form of editedForms) if (!form.isConnected) editedForms.delete(form);
    return editedForms.size > 0 || Boolean(document.querySelector("dialog[open]"));
  }

  function setDraft(value) {
    if (localStorage.getItem(outbox) !== raw) throw Error("Цей трекер уже редагується в іншій вкладці.");
    const next = value ? JSON.stringify(value) : null;
    if (next) localStorage.setItem(outbox, next);
    else localStorage.removeItem(outbox);
    raw = next;
    draft = value;
  }

  function show(message = "Збережено в акаунті") {
    status.textContent = storageError ? "Чернетка недоступна. Трекер відкрито для перегляду." : message;
    review.hidden = !remote;
  }

  async function request(method, body, path = "/api/workspace") {
    const response = await fetch(path, {
      method, cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "X-Vershyna-Account": account, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 || response.status === 403) {
      closed = true;
      location.replace("/account");
    }
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error), { status: response.status });
    return result;
  }

  function apply(snapshot) {
    const next = snapshot.tracker ?? structuredClone(initial);
    state = Q.pruneTrash(Q.normalize(migrateState(next)));
    revision = snapshot.revision;
    resetTimer();
    render();
    document.dispatchEvent(new Event("vershyna:imported"));
  }

  function schedule(delay = 350) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  async function sync() {
    if (running || closed || document.visibilityState === "hidden") return;
    running = true;
    try {
      if (draft && !remote) {
        const outgoing = draft;
        writing = true;
        const saved = await request("PUT", outgoing);
        writing = false;
        revision = saved.revision;
        setDraft(draft === outgoing ? null : { ...draft, revision });
      } else {
        const latest = await request("GET");
        if (draft && (remote || draft.revision !== latest.revision)) {
          remote = latest;
        } else if (!draft && latest.revision !== revision && !hasUnsubmittedForm()) {
          apply(latest);
        }
      }
      show(remote ? "Є зміни з іншого пристрою" : draft ? "Зберігаємо зміни…" : undefined);
    } catch (error) {
      if (error.status === 409) {
        remote = { revision: null };
        show("Є зміни з іншого пристрою");
      } else if (!closed) {
        show(draft ? "Зміни на цьому пристрої. Очікуємо синхронізації." : "Синхронізація тимчасово недоступна");
      }
    } finally {
      running = false;
      writing = false;
      if (!closed) schedule(draft && !remote ? 2000 : 5000);
    }
  }

  function save(value) {
    if (closed) throw Error("Сесію завершено.");
    if (storageError) throw Error("Не вдалося відкрити локальне сховище змін.");
    setDraft({ revision: draft?.revision ?? revision, tracker: structuredClone(value) });
    show(remote ? "Є зміни з іншого пристрою" : "Зберігаємо зміни…");
    if (!writing) schedule();
  }

  review.onclick = async () => {
    if (running) return;
    running = true;
    try {
      const latest = await request("GET");
      remote = latest;
      modal(`<h2>Зміни з двох пристроїв</h2>
        <p>На сервері є інша версія трекера. Збережи копію своїх змін перед вибором.</p>
        <div class="dialog-actions"><button id="sync-export">Завантажити мої зміни</button>
        <button id="sync-use-server">Відкрити версію сервера</button>
        <button id="sync-use-device">Зберегти версію цього пристрою</button>
        <button data-close>Закрити</button></div>`);
      document.getElementById("sync-export").onclick = () => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
        link.download = "vershyna-unsynced.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      };
      document.getElementById("sync-use-server").onclick = () => {
        if (!confirm("Відкрити серверну версію? Незбережені зміни лишаться в датованій копії в «Дані».")) return;
        try {
          writeBackup("-before-sync-resolution", JSON.stringify(state));
          setDraft(null);
          remote = null;
          apply(latest);
          document.getElementById("modal").close();
          show();
        } catch (error) { toast(error.message); }
      };
      document.getElementById("sync-use-device").onclick = () => {
        if (!confirm("Замінити серверну версію? Її копія лишиться в «Дані» на цьому пристрої.")) return;
        try {
          if (latest.tracker) writeBackup("-before-sync-resolution", JSON.stringify(latest.tracker));
          setDraft({ revision: latest.revision, tracker: structuredClone(state) });
          remote = null;
          document.getElementById("modal").close();
          schedule();
        } catch (error) { toast(error.message); }
      };
    } catch {
      if (!closed) show("Не вдалося прочитати версію сервера");
    } finally { running = false; }
  };

  document.addEventListener("input", (event) => {
    const form = event.target.form;
    if (form && !form.closest("dialog")) editedForms.add(form);
  });
  document.addEventListener("submit", (event) => {
    const before = draft;
    queueMicrotask(() => {
      if (before !== draft || !event.target.isConnected) editedForms.delete(event.target);
    });
  }, true);
  addEventListener("online", () => schedule(0));
  addEventListener("pageshow", () => schedule(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(0);
  });
  show(draft ? "Збережені зміни очікують синхронізації" : undefined);
  schedule(0);
  return {
    keySuffix,
    storageError,
    initialTracker: () => {
      const tracker = draft?.tracker ?? bootstrap.tracker;
      return tracker ? JSON.stringify(tracker) : null;
    },
    save,
    calendar: (action, method = "GET", body) => request(method, body, "/api/calendar/" + action),
  };
})();
