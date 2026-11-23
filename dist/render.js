"use strict";
// DOM rendering using Templates; no initialization side effects.

function tools(node, index, length, depth) {
  const focus = !Q.isDone(node)
    ? `<button class="icon copy-step focus-step" data-focus="${esc(node.id)}">Взяти в роботу</button>`
    : "";
  return Templates.taskTools({
    focusButton: focus,
    childButton:
      depth < 6
        ? `<button class="icon copy-step child-step" data-child="${esc(node.id)}">＋ Підкрок</button>`
        : "",
    upId: esc(node.id),
    upDisabled: index === 0 ? "disabled" : "",
    upLabel: esc(node.name),
    downId: esc(node.id),
    downDisabled: index === length - 1 ? "disabled" : "",
    downLabel: esc(node.name),
    menuId: esc(node.id),
    menuLabel: esc(node.name),
    transferId: esc(node.id),
    copyId: esc(node.id),
    editId: esc(node.id),
    editLabel: esc(node.name),
    deleteId: esc(node.id),
    deleteLabel: esc(node.name),
  });
}

function renderSteps(steps, depth = 0) {
  return Q.ordered(steps)
    .map((node) => {
      const index = steps.indexOf(node),
        group = !!node.children?.length,
        items = Q.leaves(node),
        done = items.filter((s) => s.done).length,
        symbol = ["◇", "○", "—"][Math.min(depth, 2)];
      return Templates.taskRow({
        depthClass: Math.min(depth, 3),
        doneClass: Q.isDone(node) ? "done" : "",
        groupClass: group ? "step-group" : "",
        id: esc(node.id),
        depth: depth,
        marker: group
          ? Templates.groupCompletion({
              id: esc(node.id),
              pressed: node.finalized === true,
              label: node.finalized
                ? "Скасувати остаточне завершення"
                : "Остаточно завершити задачу",
              name: esc(node.name),
              symbol: node.finalized ? "✓" : symbol,
            })
          : `<button class="check marker" data-toggle="${esc(node.id)}" aria-pressed="${node.done}" aria-label="${node.done ? "Скасувати виконання" : "Завершити крок"}: ${esc(node.name)}">${node.done ? "✓" : symbol}</button>`,
        collapseButton: group
          ? `<button class="icon" data-collapse="${esc(node.id)}" aria-expanded="${!node.collapsed}" aria-label="${node.collapsed ? "Розгорнути" : "Згорнути"}: ${esc(node.name)}">${node.collapsed ? "▸" : "▾"}</button>`
          : "",
        name: esc(node.name),
        meta: group
          ? `${done} / ${items.length} дій · ${Q.earned(node)} / ${node.xp} XP`
          : `${node.minutes} хв · ${node.xp} XP${node.done ? " · втілено" : ""}`,
        courseAward:
          node.kind === "course" && Q.isDone(node)
            ? '<div class="course-award">✦ Відзнака за завершений курс</div>'
            : "",
        tools: tools(node, index, steps.length, depth),
        children: group
          ? `<div class="group-progress"><div class="meter"><div style="width:${Math.round((done / items.length) * 100)}%"></div></div></div>${node.collapsed ? "" : `<ul class="step-children">${renderSteps(node.children, depth + 1)}</ul>`}`
          : "",
      });
    })
    .join("");
}

function render() {
  state.missions.forEach((m) => {
    if (!Q.missionDone(m)) delete m.finalized;
  });
  document.body.classList.toggle("light", state.theme === "light");
  const m = mission(),
    items = leaves(),
    done = items.filter((s) => s.done).length,
    next = nextStep(),
    xp = totalXP(),
    rewards = Q.rewards(xp);
  $("#tabs").innerHTML =
    Q.ordered(
      state.missions.filter((m) => !m.archived),
      (m) => m.finalized === true && Q.missionDone(m),
    )
      .map((item) => {
        const tasks = leaves(item);
        return Templates.missionTab({
          activeClass: item.id === m?.id ? "active" : "",
          completeClass: Q.missionDone(item) ? "completed-mission" : "",
          id: esc(item.id),
          position: state.missions.indexOf(item) + 1,
          name: esc(item.name),
          done: tasks.filter((s) => s.done).length,
          total: tasks.length,
        });
      })
      .join("") +
    '<button id="newMission" aria-label="Додати місію">＋ Місія</button>' +
    `<button id="openArchive">Архів (${state.missions.filter((m) => m.archived).length})</button><button id="openTrash">Кошик (${(state.trash || []).filter((e) => e.deletedAt + Q.TRASH_TTL > Date.now()).length})</button>`;
  $("#mission").classList.toggle("mission-complete", !!m && Q.missionDone(m));
  $("#mission").innerHTML = m
    ? Templates.missionCard({
        deadlineLabel: m.deadline
          ? "ФІНІШ · " +
            esc(
              new Date(m.deadline + "T12:00:00").toLocaleDateString("uk-UA", {
                day: "numeric",
                month: "long",
              }),
            )
          : "У ВЛАСНОМУ ТЕМПІ",
        pressed: m.finalized === true,
        completionLabel: m.finalized
          ? "Скасувати остаточне завершення"
          : "Остаточно завершити проєкт",
        nameForLabel: esc(m.name),
        completionSymbol: m.finalized ? "✓" : "◇",
        position: state.missions.indexOf(m) + 1,
        name: esc(m.name),
        goal: esc(m.goal),
        moveDisabled: m.steps.length ? "" : "disabled",
        done: done,
        total: items.length,
        progressLabel: items.length ? Math.round((done / items.length) * 100) : 0,
        progressWidth: items.length ? (done / items.length) * 100 : 0,
        nextPanel: next
          ? Templates.nextStepPanel({
              reward: next.children?.length
                ? "Підтвердь результат · XP уже за підкроки"
                : `＋${next.xp} XP · ＋${number(next.xp / 5)} іскор`,
              name: esc(next.name),
              focusStatus:
                m.focusId === next.id
                  ? 'Обрано тобою <button class="ghost small" id="clearFocus">Повернути автовибір</button>'
                  : "Автоматично: перша невиконана дія у списку",
              result: esc(next.result),
              time: timerStep === next.id ? formatTime(remaining) : formatTime(next.minutes * 60),
              durationOptions: [...new Set([5, 10, 15, 20, 25, next.minutes])]
                .sort((a, b) => a - b)
                .map(
                  (n) =>
                    `<option value="${n}" ${n === next.minutes ? "selected" : ""}>${n} хв</option>`,
                )
                .join(""),
              timerLabel: interval && timerStep === next.id ? "Пауза" : "Почати сет",
            })
          : items.length
            ? `<div class="next"><div class="eyebrow">Місію завершено ✧</div><h3>Цю вершину взято!</h3><p>Поміть, що змінилося завдяки твоїм діям.</p><button class="primary" id="celebrate">Відсвяткувати ✨</button></div>`
            : `<div class="next"><h3>Перший крок до нової вершини</h3><p>Додай крок або створи серію лекцій.</p></div>`,
        steps: renderSteps(m.steps),
      })
    : '<h2>Немає активних проєктів</h2><p class="note">Створи місію або поверни проєкт з архіву.</p>';
  $("#level").textContent =
    `Рівень ${Math.floor(xp / 200) + 1} · ${xp < 200 ? "Іскра наміру" : xp < 600 ? "Сила втілення" : "Світло впливу"}`;
  $("#xp").textContent = `${xp % 200} / 200 XP`;
  $("#xpbar").style.width = (xp % 200) / 2 + "%";
  $("#coins").textContent = number(xp / 5);
  $("#wins").textContent = state.missions.flatMap(leaves).filter((s) => s.done).length;
  const courses = state.missions
    .flatMap((item) => Q.allSteps(item.steps))
    .filter((s) => s.kind === "course" && Q.isDone(s));
  const aura = Q.auraState(xp, rewards.unlocked.length + courses.length);
  $("#glow").setAttribute("r", aura.radius);
  $("#auraCenter").setAttribute("stop-opacity", aura.glowOpacity);
  $("#auraRings").setAttribute("opacity", aura.ringOpacity);
  $("#auraRings").setAttribute("stroke-width", aura.ringWidth);
  $("#auraRays").setAttribute("opacity", aura.rayOpacity);
  $("#auraSparks").setAttribute("opacity", aura.sparkOpacity);
  $("#auraCaption").textContent = aura.label;
  const visible = rewards.unlocked.slice(-8);
  $("#artifacts").innerHTML =
    visible
      .map(
        (r) =>
          `<div class="artifact unlocked" title="${r.threshold} XP"><b>${r.icon}</b><span>${esc(r.name)}</span></div>`,
      )
      .join("") +
    courses
      .slice(-3)
      .map(
        (c) =>
          `<div class="artifact unlocked" title="Завершений курс"><b>✦</b><span>${esc(c.name)}</span></div>`,
      )
      .join("") +
    `<div class="artifact locked"><b>?</b><span>Таємний артефакт<br>${rewards.next} XP</span></div>`;
  $("#artifactHint").textContent =
    `Відкрито артефактів: ${rewards.unlocked.length + courses.length}. До наступного — ${rewards.next - xp} XP. Його вигляд і назва поки приховані.`;
  $("#allArtifacts")?.remove();
  if (rewards.unlocked.length > 8 || courses.length > 3) {
    $("#artifactHint").insertAdjacentHTML(
      "afterend",
      '<button class="ghost small" id="allArtifacts">Вся колекція</button>',
    );
    $("#allArtifacts").onclick = () =>
      modal(
        Templates.artifactCollection({
          rewards: rewards.unlocked
            .map(
              (r) =>
                `<div class="artifact unlocked"><b>${r.icon}</b><span>${esc(r.name)}</span></div>`,
            )
            .join(""),
          courses: courses
            .map((c) => `<div class="artifact unlocked"><b>✦</b><span>${esc(c.name)}</span></div>`)
            .join(""),
        }),
      );
  }
  bind();
}
