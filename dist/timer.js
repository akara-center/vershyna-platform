"use strict";
// Page-local timer. startTimerFor receives the selected action.

let interval = null;

let remaining = 600;

let timerStep = null;

function stopTimer() {
  clearInterval(interval);
  interval = null;
}

function resetTimer() {
  stopTimer();
  timerStep = null;
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function startTimerFor(next) {
  if (interval) {
    stopTimer();
    render();
    return;
  }
  if (timerStep !== next.id || remaining <= 0) {
    remaining = next.minutes * 60;
    timerStep = next.id;
  }
  const end = Date.now() + remaining * 1000;
  interval = setInterval(() => {
    remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if ($("#timer")) $("#timer").textContent = formatTime(remaining);
    if (!remaining) {
      stopTimer();
      render();
      toast("Сет завершився. Перевір результат або обери менший крок.");
    }
  }, 250);
  render();
}
