"use strict";
// Pure HTML fragments. Values are prepared and escaped by the caller.
// Joining fragments preserves all original text and whitespace exactly.
const Templates = (() => {
  function victoryDancer() {
    return [
      '<div class="victory-aura"></div>',
      '<svg class="victory-dancer" viewBox="0 0 120 160" aria-hidden="true">',
      '<g class="dance-body" fill="currentColor">',
      '<circle cx="60" cy="30" r="14"/>',
      '<path d="M49 49Q60 43 71 49L76 95Q60 104 44 95Z"/>',
      '<g class="dance-left">',
      '<path d="M50 53L30 70 17 44" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></g>',
      '<g class="dance-right">',
      '<path d="M70 53L88 66 103 39" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></g>',
      '<path d="M52 96L41 120 29 137" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" class="dance-leg-left"/>',
      '<path class="dance-leg-right" d="M67 96L78 120 92 137" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></g></svg>',
    ].join("");
  }

  function taskTools({
    focusButton,
    relevanceButton,
    childButton,
    upId,
    upDisabled,
    upLabel,
    downId,
    downDisabled,
    downLabel,
    menuId,
    menuLabel,
    transferId,
    copyId,
    editId,
    editLabel,
    deleteId,
    deleteLabel,
  }) {
    return [
      `<div class="step-tools">${focusButton}${childButton}`,
      `<button class="icon order-step" data-move="${upId}" data-direction="-1" ${upDisabled} aria-label="Підняти крок: ${upLabel}">↑</button>`,
      `<button class="icon order-step" data-move="${downId}" data-direction="1" ${downDisabled} aria-label="Опустити крок: ${downLabel}">↓</button>`,
      '<div class="task-menu">',
      `<button class="ghost small" data-menu="${menuId}" aria-label="Дії з кроком: ${menuLabel}" aria-expanded="false">⋯</button>`,
      '<div class="task-actions" hidden>',
      relevanceButton,
      `<button class="icon copy-step" data-transfer="${transferId}">Перемістити</button>`,
      `<button class="icon copy-step" data-copy="${copyId}">Копія</button>`,
      `<button class="icon copy-step" data-edit="${editId}" aria-label="Редагувати крок: ${editLabel}">Редагувати ✎</button>`,
      `<button class="icon copy-step" data-calendar="${editId}" aria-label="Додати в Google Calendar: ${editLabel}">Додати в Google Calendar</button>`,
      `<button class="icon copy-step" data-delete="${deleteId}" aria-label="Видалити крок: ${deleteLabel}">Видалити</button></div></div></div>`,
    ].join("");
  }

  function taskRow({
    depthClass,
    doneClass,
    groupClass,
    id,
    depth,
    marker,
    collapseButton,
    name,
    meta,
    courseAward,
    tools,
    children,
  }) {
    return [
      `<li class="step depth-${depthClass} ${doneClass} ${groupClass}" data-step-id="${id}" data-depth="${depth}">${marker}`,
      '<div class="step-info">',
      `<div class="step-name">${collapseButton}${name}</div>`,
      `<div class="step-meta">${meta}</div>${courseAward}</div>${tools}${children}</li>`,
    ].join("");
  }

  function groupCompletion({ id, pressed, label, name, symbol }) {
    return [
      `<button class="check marker" data-finalize="${id}" aria-pressed="${pressed}" aria-label="${label}: ${name}">${symbol}</button>`,
    ].join("");
  }

  function missionTab({ activeClass, completeClass, id, position, name, done, total }) {
    return [
      `<button class="${activeClass} ${completeClass}" data-mission="${id}">${position}. ${name}`,
      `<span>${done} / ${total} дій</span></button>`,
    ].join("");
  }

  function missionCard({
    deadlineLabel,
    pressed,
    completionLabel,
    nameForLabel,
    completionSymbol,
    position,
    name,
    goal,
    moveDisabled,
    done,
    total,
    progressLabel,
    progressWidth,
    nextPanel,
    steps,
  }) {
    return [
      '<div class="mission-top">',
      "<div>",
      `<span class="badge">${deadlineLabel}</span>`,
      "<h2>",
      `<button class="check marker" id="finalizeMission" aria-pressed="${pressed}" aria-label="${completionLabel}: ${nameForLabel}">${completionSymbol}</button> ${position}. ${name}</h2>`,
      `<p class="sub" style="font-size:13px">${goal}</p></div>`,
      '<div class="section-actions">',
      '<button class="ghost small" id="archiveMission">В архів</button>',
      '<button class="ghost small" id="deleteMission">Видалити проєкт</button>',
      '<button class="ghost small" id="editMission">Редагувати</button>',
      `<button class="ghost small" id="moveMission" ${moveDisabled}>Перемістити проєкт</button></div></div>`,
      '<div class="progress-label">',
      "<span>Шлях до результату</span>",
      `<span>${done} із ${total} · ${progressLabel}%</span></div>`,
      '<div class="meter">',
      `<div style="width:${progressWidth}%"></div></div>${nextPanel}`,
      '<div class="section-title">',
      "<h3>Маршрут місії</h3>",
      '<div class="section-actions">',
      '<button class="ghost small" id="addStep">＋ Додати крок</button>',
      '<button class="ghost small" id="addSeries">Створити серію</button></div></div>',
      `<ul class="steps">${steps}</ul>`,
    ].join("");
  }

  function nextStepPanel({ reward, name, focusStatus, result, time, durationOptions, timerLabel }) {
    return [
      '<div class="next">',
      '<div class="next-head">',
      '<span class="eyebrow">Твій наступний крок</span>',
      `<span class="reward">${reward}</span></div>`,
      `<h3>${name}</h3>`,
      `<p class="focus-status">${focusStatus}</p>`,
      "<p>",
      `<strong>Результат цього кроку:</strong> ${result}</p>`,
      '<div class="timerline">',
      `<span class="timer" id="timer">${time}</span>`,
      `<select id="duration" aria-label="Тривалість сету">${durationOptions}</select>`,
      `<button class="ghost small" id="startTimer">${timerLabel}</button></div>`,
      '<div class="actions">',
      '<button class="primary" id="completeNext">Крок виконано ✓</button>',
      '<button class="ghost" id="delegate">Передати ChatGPT ↗</button>',
      '<button class="ghost" id="overwhelmed">Крок завеликий</button></div>',
      '<p class="hint">Бали — за результат. Підкроки ділять винагороду задачі; тривалість сету не збільшує бали.</p></div>',
    ].join("");
  }

  function artifactCollection({ rewards, courses }) {
    return [
      "<h2>Твоя колекція</h2>",
      `<div class="artifacts">${rewards}${courses}</div>`,
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button></div>",
    ].join("");
  }

  function stepForm({ title, parentNote, name, result, minutes, rewardField, plannedDate }) {
    return [
      `<h2>${title}</h2>${parentNote}`,
      '<form id="stepForm">',
      '<label for="stepName">Назва дії</label>',
      `<input id="stepName" required maxlength="500" value="${name}">`,
      '<label for="stepResult">Що має бути готово</label>',
      `<textarea id="stepResult" required maxlength="10000">${result}</textarea>`,
      '<label for="stepPlannedDate">Планова дата (необов’язково)</label>',
      `<input id="stepPlannedDate" type="date" value="${plannedDate}">`,
      '<label for="stepMinutes">Сет, хвилин</label>',
      `<input id="stepMinutes" type="number" min="1" max="120" required value="${minutes}">${rewardField}`,
      '<div class="dialog-actions">',
      '<button type="button" data-close>Скасувати</button>',
      '<button class="primary">Зберегти</button></div></form>',
    ].join("");
  }

  function stepRewardField({ disabled, options, lockedNote }) {
    return [
      '<label for="stepXP">Внесок у результат</label>',
      `<select id="stepXP" ${disabled}>${options}</select>`,
      `<p class="note">Початкова шкала: 25 / 50 / 100 / 200 XP. Важливіший результат — більша винагорода.${lockedNote}</p>`,
    ].join("");
  }

  function seriesForm({ xpOptions }) {
    return [
      "<h2>Створити серію</h2>",
      '<p class="note">Курс → лекції → дії. За весь курс — окрема відзнака; XP нараховуються лише за дії.</p>',
      '<form id="seriesForm">',
      '<label for="courseName">Назва курсу або великої задачі</label>',
      '<input id="courseName" required maxlength="500" placeholder="Пройти курс COO">',
      '<div class="form-grid">',
      "<div>",
      '<label for="lectureCount">Кількість лекцій</label>',
      '<input id="lectureCount" type="number" min="1" max="100" value="15" required></div>',
      "<div>",
      '<label for="lectureXP">Винагорода за одну лекцію</label>',
      `<select id="lectureXP">${xpOptions}</select></div></div>`,
      '<label for="lectureTemplate">Шаблон назви: {n} — номер</label>',
      '<input id="lectureTemplate" required value="Лекція {n}" maxlength="500">',
      '<label for="lectureActions">Дії для кожної лекції — по одній у рядку</label>',
      '<textarea id="lectureActions" required>Переглянути\nЗробити нотатки / опрацювати матеріали</textarea>',
      '<label for="seriesMinutes">Сет для дії, хвилин</label>',
      '<input id="seriesMinutes" type="number" min="1" max="120" value="20" required>',
      '<p class="note" id="seriesSummary"></p>',
      '<div class="dialog-actions">',
      '<button type="button" data-close>Скасувати</button>',
      '<button class="primary">Створити серію</button></div></form>',
    ].join("");
  }

  function missionForm({ title, name, goal, deadline }) {
    return [
      `<h2>${title}</h2>`,
      '<form id="missionForm">',
      '<label for="missionName">Назва</label>',
      `<input id="missionName" required maxlength="500" value="${name}">`,
      '<label for="missionGoal">Бажаний результат</label>',
      `<textarea id="missionGoal" required>${goal}</textarea>`,
      '<label for="missionDeadline">Орієнтовний фініш</label>',
      `<input id="missionDeadline" type="date" value="${deadline}">`,
      '<div class="dialog-actions">',
      '<button type="button" data-close>Скасувати</button>',
      '<button class="primary">Зберегти</button></div></form>',
    ].join("");
  }

  function trashDialog({ entries }) {
    return [
      "<h2>Кошик</h2>",
      `<p class="note">Видалені елементи зберігаються 7 днів. Бали повертаються разом із відновленими діями.</p>${entries}`,
      '<p class="note">Елементи, видалені до появи кошика, можуть залишитися в попередніх копіях у розділі «Дані».</p>',
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button></div>",
    ].join("");
  }

  function trashEntry({ name, kind, deletedAt, expiresAt, id }) {
    return [
      '<div class="archive-item">',
      `<h3>${name}</h3>`,
      `<p class="note">${kind}`,
      `<br>Видалено: ${deletedAt}`,
      `<br>Зберігається до: ${expiresAt}</p>`,
      `<button data-trash-restore="${id}">Відновити</button></div>`,
    ].join("");
  }

  function archiveDialog({ entries }) {
    return [
      `<h2>Архів</h2>${entries}`,
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button></div>",
    ].join("");
  }

  function archiveEntry({ name, actionsCount, xp, viewId, restoreId, deleteId }) {
    return [
      '<div class="archive-item">',
      `<h3>${name}</h3>`,
      `<p class="note">${actionsCount} дій · ${xp} XP</p>`,
      '<div class="actions">',
      `<button data-view-archive="${viewId}">Переглянути</button>`,
      `<button data-restore="${restoreId}">Повернути в активні</button>`,
      `<button data-delete-project="${deleteId}">Видалити</button></div></div>`,
    ].join("");
  }

  function delegateDialog({ prompt }) {
    return [
      "<h2>Передати роботу ChatGPT</h2>",
      '<p class="note">Скопіюй запит у чат і додай матеріали. Ця кнопка готує передачу; робота почнеться в чаті.</p>',
      '<label for="promptText">Запит</label>',
      `<textarea id="promptText" style="min-height:260px">${prompt}</textarea>`,
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button>",
      '<button class="primary" id="copyPrompt">Скопіювати запит</button></div>',
    ].join("");
  }

  function transferForm({ kind, name, projectNote, options }) {
    return [
      `<h2>Перемістити ${kind}</h2>`,
      `<p>${name}</p>`,
      `<p class="note">Разом із підкроками та виконанням. Уже зароблені XP не зміняться. ${projectNote}</p>`,
      '<label for="transferTarget">Куди перемістити</label>',
      '<select id="transferTarget">',
      `<option value="">Обери місце</option>${options}</select>`,
      '<p class="note" id="transferPreview"></p>',
      '<p class="inline-error" id="transferError" role="alert"></p>',
      '<div class="dialog-actions">',
      "<button data-close>Скасувати</button>",
      '<button class="primary" id="confirmTransfer" disabled>Перемістити</button></div>',
    ].join("");
  }

  function dataDialog({ filename, url, json }) {
    return [
      "<h2>Твої дані</h2>",
      '<p class="note">Прогрес зберігається в цьому браузері. Для перенесення між пристроями збережи JSON, потім завантаж його на іншому пристрої.</p>',
      "<h3>Зберегти копію</h3>",
      `<a class="file-download" id="export" download="${filename}" href="${url}">Зберегти JSON-файл ↓</a>`,
      "<details>",
      "<summary>Якщо файл не зберігається — скопіювати JSON</summary>",
      `<textarea class="data-text" id="exportText" readonly aria-label="JSON для копіювання">${json}</textarea>`,
      '<button class="small" id="copyJSON">Скопіювати JSON</button></details>',
      "<h3>Завантажити збережений прогрес</h3>",
      '<label for="importFile">Обрати файл прогресу (.json)</label>',
      '<input class="file-input" type="file" id="importFile" aria-describedby="fileHelp">',
      '<p class="note" id="fileHelp">Натисни стандартну кнопку вибору файла вище. Якщо вбудований переглядач не відкриває вікно вибору, відкрий цю адресу у Chrome через меню переглядача або встав JSON текстом нижче. В іншому браузері прогрес зберігається окремо.</p>',
      "<details>",
      "<summary>Або вставити JSON текстом</summary>",
      '<label for="importText">JSON із твоєї копії</label>',
      '<textarea class="data-text" id="importText" placeholder="Встав сюди вміст файла"></textarea>',
      '<button class="small" id="readJSON">Перевірити JSON</button></details>',
      '<p class="inline-error" id="importError" role="alert"></p>',
      '<div id="importPreview"></div>',
      '<p class="note" id="dataStatus"></p>',
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button></div>",
    ].join("");
  }

  function importPreview({ missions, actions, done }) {
    return [
      '<div class="import-preview">',
      "<strong>Файл перевірено</strong>",
      `<p class="note">Місій: ${missions}. Дій: ${actions}. Виконано: ${done}.`,
      "<br>Це замінить поточний прогрес у цьому браузері. Перед заміною буде збережено локальну копію.</p>",
      '<button class="primary small" id="confirmImport">Замінити прогрес цими даними</button></div>',
    ].join("");
  }

  function checkinDialog() {
    return [
      "<h2>Почнемо з посильного.</h2>",
      "<p>Скільки уваги зараз є для одного кроку?</p>",
      '<div class="actions">',
      '<button data-energy="5">5 хв · м’який старт</button>',
      '<button data-energy="10">10 хв · у роботу</button>',
      '<button data-energy="20">20 хв · є ресурс</button></div>',
      '<p class="note">Обери один результат. Підготовку можна передати через «Передати ChatGPT».</p>',
      '<div class="dialog-actions">',
      "<button data-close>Закрити</button></div>",
    ].join("");
  }
  return Object.freeze({
    victoryDancer,
    taskTools,
    taskRow,
    groupCompletion,
    missionTab,
    missionCard,
    nextStepPanel,
    artifactCollection,
    stepForm,
    stepRewardField,
    seriesForm,
    missionForm,
    trashDialog,
    trashEntry,
    archiveDialog,
    archiveEntry,
    delegateDialog,
    transferForm,
    dataDialog,
    importPreview,
    checkinDialog,
  });
})();
