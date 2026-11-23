"use strict";
// Archive/trash views, JSON import/export and recovery UI.

let exportURL;

let backupURLs = [];

function showTrash() {
  const entries = (state.trash || []).filter((e) => e.deletedAt + Q.TRASH_TTL > Date.now());
  modal(
    Templates.trashDialog({
      entries: entries.length
        ? entries
            .map((e) =>
              Templates.trashEntry({
                name: esc(e.node.name),
                kind:
                  e.kind === "project"
                    ? "Проєкт"
                    : `Крок · ${esc(e.missionName)}${e.parentName ? " → " + esc(e.parentName) : ""}`,
                deletedAt: new Date(e.deletedAt).toLocaleString("uk-UA"),
                expiresAt: new Date(e.deletedAt + Q.TRASH_TTL).toLocaleString("uk-UA"),
                id: esc(e.id),
              }),
            )
            .join("")
        : "<p>Кошик порожній.</p>",
    }),
  );
  $$("[data-trash-restore]").forEach(
    (b) =>
      (b.onclick = () => {
        try {
          if (storeProjectChange(Q.restoreTrash(state, b.dataset.trashRestore)))
            toast("Елемент відновлено з прогресом і XP.");
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}

function showArchive() {
  const archived = state.missions.filter((m) => m.archived);
  modal(
    Templates.archiveDialog({
      entries: archived.length
        ? archived
            .map((m) =>
              Templates.archiveEntry({
                name: esc(m.name),
                actionsCount: leaves(m).length,
                xp: m.steps.reduce((sum, n) => sum + Q.earned(n), 0),
                viewId: esc(m.id),
                restoreId: esc(m.id),
                deleteId: esc(m.id),
              }),
            )
            .join("")
        : "<p>Архів поки порожній.</p>",
    }),
  );
  $$("[data-view-archive]").forEach((b) => (b.onclick = () => viewArchive(b.dataset.viewArchive)));
  $$("[data-restore]").forEach((b) => (b.onclick = () => restoreProject(b.dataset.restore)));
  $$("[data-delete-project]").forEach(
    (b) => (b.onclick = () => deleteProject(b.dataset.deleteProject)),
  );
}

function viewArchive(id) {
  const m = state.missions.find((m) => m.id === id && m.archived);
  if (!m) return;
  function tree(nodes) {
    return `<ul class="archive-tree">${nodes.map((n) => `<li><span>${Q.isDone(n) ? "✓ " : ""}${esc(n.name)}</span><p class="note">${esc(n.result)} · ${Q.earned(n)} XP</p>${n.children?.length ? tree(n.children) : ""}</li>`).join("")}</ul>`;
  }
  modal(
    `<h2>${esc(m.name)}</h2><p>${esc(m.goal)}</p>${tree(m.steps)}<div class="dialog-actions"><button id="backArchive">До архіву</button><button id="restoreArchive">Повернути в активні</button><button data-close>Закрити</button></div>`,
  );
  $("#backArchive").onclick = showArchive;
  $("#restoreArchive").onclick = () => restoreProject(id);
}

function delegate() {
  const m = mission(),
    s = nextStep();
  if (!s) return;
  const prompt = `Допоможи виконати крок моєї місії «${m.name}».\nЗагальний результат: ${m.goal}\nПоточний крок: ${s.name}\nОчікую отримати: ${s.result}\n\nВізьми на себе максимум підготовчої та виконавчої роботи. Спочатку коротко вкажи, що зробиш сам і яке одне рішення або матеріал потрібні від мене. Не вигадуй факти; використовуй актуальні файли, якщо вони доступні. Працюй до конкретного результату, придатного до перевірки. Мій сет участі — ${s.minutes} хвилин. Якщо задача більша, виділи найменший завершений результат і познач залишок.\n\nМої матеріали / уточнення: `;
  modal(Templates.delegateDialog({ prompt: esc(prompt) }));
  $("#copyPrompt").onclick = () => copyText($("#promptText"));
}

function showData() {
  if (exportURL) URL.revokeObjectURL(exportURL);
  backupURLs.forEach((url) => URL.revokeObjectURL(url));
  backupURLs = [];
  const text = JSON.stringify(state, null, 2);
  exportURL = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  modal(
    Templates.dataDialog({
      filename: backupFilename(new Date().toISOString()).replace("backup", "progress"),
      url: exportURL,
      json: esc(text),
    }),
  );
  $("#export").onclick = () => {
    $("#dataStatus").textContent =
      "Якщо браузер не зберіг файл, розкрий «Скопіювати JSON» та збережи текст вручну.";
  };
  $("#copyJSON").onclick = () => copyText($("#exportText"));
  const copies = BACKUP_LABELS.map(([suffix, label]) => {
    const key = KEY + suffix;
    return {
      key,
      label,
      raw: localStorage.getItem(key),
      createdAt: localStorage.getItem(key + "-created-at"),
    };
  })
    .filter((copy) => copy.raw)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const links = [];
  for (const copy of copies) {
    try {
      const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" }));
      backupURLs.push(url);
      const dated = copy.createdAt && !Number.isNaN(Date.parse(copy.createdAt));
      links.push(
        `<p class="note"><a download="${dated ? backupFilename(copy.createdAt) : "vershyna-backup-date-unknown.json"}" href="${url}">${esc(copy.label)} · ${dated ? backupStamp(copy.createdAt) + " (Київ)" : "дату створення не збережено"} ↓</a></p>`,
      );
    } catch {}
  }
  $("#dataStatus").insertAdjacentHTML("afterend", links.join(""));
  $("#importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showImportError("Файл завеликий: максимум 8 МБ.");
      return;
    }
    try {
      prepareImport(await file.text());
    } catch {
      showImportError("Не вдалося прочитати файл. Спробуй вставити його вміст текстом.");
    }
    e.target.value = "";
  };
  $("#readJSON").onclick = () => prepareImport($("#importText").value);
}

function showImportError(message) {
  $("#importError").textContent = message;
  $("#importPreview").innerHTML = "";
}

function prepareImport(text) {
  try {
    if (text.length > 8 * 1024 * 1024) throw Error("Завеликий JSON: максимум 8 МБ.");
    const imported = Q.normalize(migrateState(Q.validate(JSON.parse(text.replace(/^\uFEFF/, "")))));
    Q.validate(imported);
    Pilot.validate(imported.pilot);
    if (!imported.missions.some((m) => m.id === imported.active))
      imported.active = imported.missions[0]?.id || null;
    const tasks = imported.missions.flatMap(leaves);
    $("#importError").textContent = "";
    $("#importPreview").innerHTML = Templates.importPreview({
      missions: imported.missions.length,
      actions: tasks.length,
      done: tasks.filter((s) => s.done).length,
    });
    $("#confirmImport").onclick = () => {
      try {
        const current = localStorage.getItem(KEY);
        if (current) writeBackup("-before-import", current);
        localStorage.setItem(KEY, JSON.stringify(imported));
      } catch {
        showImportError(
          "Браузер не дозволив зберегти дані. Поточний прогрес не замінено. Звільни місце або відкрий застосунок у звичайному браузері.",
        );
        return;
      }
      state = imported;
      persistenceBlocked = false;
      startupError = "";
      resetTimer();
      $("#modal").close();
      render();
      toast("Прогрес імпортовано й збережено.");
      if (document.getElementById?.("pilot-nav")) document.dispatchEvent(new Event("vershyna:imported"));
    };
  } catch (error) {
    showImportError(
      error instanceof SyntaxError
        ? "Не вдалося прочитати JSON. Обери файл експорту «Вершини» або перевір вставлений текст."
        : error.message,
    );
  }
}
