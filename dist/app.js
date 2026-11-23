"use strict";
// Event binding and application startup. Load last; see index.html for script order.

function bind() {
  $$("[data-menu]").forEach(
    (b) =>
      (b.onclick = () => {
        const actions = b.parentElement.querySelector(".task-actions");
        closeTaskMenus(b.parentElement);
        actions.hidden = !actions.hidden;
        b.setAttribute("aria-expanded", String(!actions.hidden));
      }),
  );
  if ($("#moveMission")) $("#moveMission").onclick = () => transferEditor(mission().id);
  $("#openArchive").onclick = showArchive;
  $("#openTrash").onclick = showTrash;
  if ($("#archiveMission")) $("#archiveMission").onclick = () => archiveProject(mission().id);
  if ($("#deleteMission")) $("#deleteMission").onclick = () => deleteProject(mission().id);
  $$("[data-delete]").forEach((b) => (b.onclick = () => deleteStep(b.dataset.delete)));
  $$("[data-transfer]").forEach((b) => (b.onclick = () => transferEditor(b.dataset.transfer)));
  $$("[data-focus]").forEach((b) => (b.onclick = () => takeInWork(b.dataset.focus)));
  if ($("#clearFocus"))
    $("#clearFocus").onclick = () => {
      delete mission().focusId;
      resetTimer();
      save();
      render();
    };
  $$("[data-mission]").forEach(
    (b) =>
      (b.onclick = () => {
        resetTimer();
        state.active = b.dataset.mission;
        save();
        render();
      }),
  );
  $("#newMission").onclick = () => missionEditor(true);
  if ($("#editMission")) $("#editMission").onclick = () => missionEditor();
  if ($("#addStep")) $("#addStep").onclick = () => stepEditor();
  if ($("#addSeries")) $("#addSeries").onclick = seriesEditor;
  if ($("#finalizeMission")) $("#finalizeMission").onclick = () => finalize(mission().id);
  $$("[data-finalize]").forEach((b) => (b.onclick = () => finalize(b.dataset.finalize)));
  $$("[data-toggle]").forEach((b) => (b.onclick = () => toggle(b.dataset.toggle)));
  $$("[data-edit]").forEach((b) => (b.onclick = () => stepEditor(b.dataset.edit)));
  $$("[data-copy]").forEach(
    (b) => (b.onclick = () => stepEditor(undefined, { copyId: b.dataset.copy })),
  );
  $$("[data-child]").forEach(
    (b) => (b.onclick = () => stepEditor(undefined, { parentId: b.dataset.child })),
  );
  $$("[data-collapse]").forEach(
    (b) =>
      (b.onclick = () => {
        const node = Q.find(mission().steps, b.dataset.collapse).node;
        node.collapsed = !node.collapsed;
        save();
        render();
      }),
  );
  $$("[data-move]").forEach(
    (b) =>
      (b.onclick = () => {
        const match = Q.find(mission().steps, b.dataset.move);
        if (Q.moveStep(match.siblings, b.dataset.move, Number(b.dataset.direction))) {
          resetTimer();
          save();
          render();
          $$("[data-move]")
            .find(
              (x) =>
                x.dataset.move === b.dataset.move && x.dataset.direction === b.dataset.direction,
            )
            ?.focus();
        }
      }),
  );
  const next = nextStep();
  if (next) {
    $("#completeNext").onclick = () => toggle(next.id);
    $("#delegate").onclick = delegate;
    $("#overwhelmed").onclick = () => stepEditor(undefined, { parentId: next.id });
    $("#duration").onchange = (e) => {
      next.minutes = Number(e.target.value);
      resetTimer();
      save();
      render();
    };
    $("#startTimer").onclick = () => startTimerFor(next);
  } else if ($("#celebrate")) $("#celebrate").onclick = celebrateProject;
}

initializeState();
bindModalBackdrop();
document.addEventListener?.("click", (event) => {
  if (!event.target.closest(".task-menu")) closeTaskMenus();
});
document.addEventListener?.("keydown", (event) => {
  if (event.key === "Escape") closeTaskMenus();
});
$("#theme").onclick = () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  save();
  render();
};
$("#settings").onclick = showData;
$("#checkin").onclick = () => {
  modal(Templates.checkinDialog());
  $$("[data-energy]").forEach(
    (b) =>
      (b.onclick = () => {
        const next = nextStep();
        if (next) {
          next.minutes = Number(b.dataset.energy);
          resetTimer();
          save();
          render();
        }
        $("#modal").close();
      }),
  );
};
$("#date").textContent = new Date().toLocaleDateString("uk-UA", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
render();
if (startupError) toast(startupError);
