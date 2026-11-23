"use strict";
// Dialogs, backdrop dismissal, menus, notifications and celebration effects.

let backdropPointer = null;

let toastTimeout;

function toast(message) {
  clearTimeout(toastTimeout);
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  toastTimeout = setTimeout(() => $("#toast").classList.add("hidden"), 5000);
}

function modal(html) {
  closeTaskMenus();
  $("#modalContent").innerHTML = html;
  if (!$("#modal").open) $("#modal").showModal();
  $$("[data-close]").forEach((b) => (b.onclick = () => $("#modal").close()));
}

function outsideModal(event) {
  const r = $("#modal").getBoundingClientRect();
  return (
    event.target === $("#modal") &&
    (event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom)
  );
}

function confirmRemoval(message, onConfirm) {
  modal(
    `<h2>Перемістити в кошик?</h2><p>${esc(message)}</p><div class="dialog-actions"><button data-close>Скасувати</button><button class="primary" id="confirmRemoval">Видалити</button></div>`,
  );
  $("#confirmRemoval").onclick = onConfirm;
}

function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.querySelectorAll(".confetti").length) return;
  for (let i = 0; i < 38; i++) {
    const part = document.createElement("i");
    part.className = "confetti";
    const angle = ((-155 + Math.random() * 130) * Math.PI) / 180,
      distance = 150 + Math.random() * 240;
    part.style.left = (i % 2 ? 24 : 76) + "vw";
    part.style.top = "78vh";
    part.style.background = ["#f1ca81", "#b6a0ff", "#67bdaa", "#eb83ba"][i % 4];
    part.style.setProperty("--dx", Math.cos(angle) * distance + "px");
    part.style.setProperty("--dy", Math.sin(angle) * distance + "px");
    document.body.append(part);
    setTimeout(() => part.remove(), 1900);
  }
}

function celebrateProject() {
  document.querySelector(".victory-scene")?.remove();
  const scene = document.createElement("div");
  scene.className = "victory-scene";
  scene.setAttribute("role", "status");
  scene.setAttribute("aria-label", "Святкування завершення проєкту");
  scene.innerHTML = Templates.victoryDancer();
  for (let i = 0; i < 16; i++) {
    const star = document.createElement("span");
    star.className = "victory-star";
    star.textContent = i % 3 ? "✦" : "✧";
    const a = (i * Math.PI) / 8;
    star.style.setProperty("--sx", Math.cos(a) * (100 + (i % 3) * 30) + "px");
    star.style.setProperty("--sy", Math.sin(a) * (110 + (i % 3) * 22) + "px");
    star.style.setProperty("--delay", (i % 4) * 0.18 + "s");
    scene.append(star);
  }
  for (let i = 0; i < 3; i++) {
    const burst = document.createElement("span");
    burst.className = "victory-firework";
    burst.style.setProperty("--fx", [-135, 125, 10][i] + "px");
    burst.style.setProperty("--fy", [-100, -65, 135][i] + "px");
    burst.style.setProperty("--delay", i * 0.35 + "s");
    burst.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M50 8v20m0 44v20M8 50h20m44 0h20M20 20l14 14m32 32 14 14M20 80l14-14m32-32 14-14"/></g></svg>';
    scene.append(burst);
  }
  document.body.append(scene);
  setTimeout(() => scene.remove(), 4600);
}

function closeTaskMenus(except = null) {
  $$(".task-menu").forEach((menu) => {
    if (menu === except) return;
    menu.querySelector(".task-actions").hidden = true;
    menu.querySelector("[data-menu]").setAttribute("aria-expanded", "false");
  });
}

async function copyText(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    toast("Текст скопійовано.");
  } catch {
    input.focus();
    input.select();
    toast("Текст виділено. Скористайся командою «Копіювати».");
  }
}

function bindModalBackdrop() {
  $("#modal").addEventListener?.("pointerdown", (event) => {
    backdropPointer = outsideModal(event) ? event.pointerId : null;
  });
  $("#modal").addEventListener?.("pointerup", (event) => {
    if (backdropPointer === event.pointerId && outsideModal(event)) $("#modal").close();
    backdropPointer = null;
  });
  $("#modal").addEventListener?.("pointercancel", () => {
    backdropPointer = null;
  });
}
