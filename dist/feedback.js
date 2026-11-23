"use strict";

const feedback = document.getElementById?.("report-bug");
if (feedback) feedback.onclick = () => {
  const screen = document.querySelector('#pilot-nav [aria-current="page"]')?.textContent.trim() || "Мій день";
  const version = "2.0 · пілот";
  modal(`<h2>Повідомити про помилку</h2><form id="bug-report" class="pilot-card">
    <p>Опиши, що сталося. Поки адресу підтримки не налаштовано, повідомлення можна скопіювати.</p>
    <label>Що сталося?<textarea id="bug-description" rows="4" required maxlength="2000"></textarea></label>
    <label>Чого ти очікувала або очікував?<textarea id="bug-expected" rows="2" maxlength="1000"></textarea></label>
    <p class="note">${esc(screen)} · ${esc(version)}</p>
    <div class="pilot-actions"><button type="submit" class="primary">Скопіювати повідомлення</button>
    <button type="button" data-close>Закрити</button></div>
    <label id="bug-preview" hidden>Підготовлене повідомлення<textarea id="bug-text" rows="5" readonly></textarea></label>
  </form>`);
  $("#bug-report").onsubmit = (event) => {
    event.preventDefault();
    const description = $("#bug-description").value.trim();
    const expected = $("#bug-expected").value.trim();
    if (!description) return;
    $("#bug-text").value = [`Вершина ${version}`, `Екран: ${screen}`, "", description,
      ...(expected ? ["", `Очікуваний результат: ${expected}`] : [])].join("\n");
    $("#bug-preview").hidden = false;
    copyText($("#bug-text"));
  };
};
