"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.VERSHYNA_PLAYWRIGHT || "playwright");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");
const { createServer } = require("../server/start.cjs");

async function run() {
  const db = openWorkspaces(":memory:");
  const clientKey = provision(db, "test-client");
  const coachKey = provision(db, "test-coach", "coach");
  const base = "http://127.0.0.1:18761";
  const server = createServer(db, base);
  await new Promise((resolve) => server.listen(18761, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.VERSHYNA_CHROMIUM });
    const desktop = await browser.newContext();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const coachContext = await browser.newContext();
    const errors = [];
    async function login(context, key) {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await page.locator('[name="key"]').fill(key);
      await page.getByRole("button", { name: "Увійти" }).click();
      await page.waitForURL("**/tracker");
      return page;
    }
    const saved = (page) => page.waitForFunction(() =>
      document.querySelector("#workspace-status").textContent === "Збережено в акаунті");
    const coach = await login(coachContext, coachKey);
    await coach.getByText("Ви увійшли як test-coach").waitFor();
    await coach.getByRole("link", { name: "Кабінет коуча", exact: true }).click();
    await coach.getByRole("heading", { name: "Кабінет коуча", exact: true }).waitFor();
    await coach.getByText("Ви увійшли як test-coach").waitFor();
    await coach.getByRole("textbox", { name: "Акаунт клієнта" }).fill("test-client");
    await coach.getByRole("button", { name: "Створити контракт" }).click();
    await coach.getByRole("heading", { name: "Активна співпраця" }).waitFor();
    coach.once("dialog", (dialog) => dialog.accept());
    await coach.getByRole("button", { name: "Передати трекер клієнтові" }).click();
    await coach.getByText("Стрічка змін", { exact: false }).waitFor();

    const first = await login(desktop, clientKey);
    const second = await login(mobile, clientKey);

    await first.locator("#newMission").click();
    await first.locator("#missionName").fill("Тестовий проєкт");
    await first.locator("#missionGoal").fill("Результат на двох пристроях");
    await first.locator("#missionForm button[type=submit], #missionForm button.primary").click();
    await first.locator("#addStep").click();
    await first.locator("#stepName").fill("Тестовий крок");
    await first.locator("#stepResult").fill("Крок виконано");
    await first.locator("#stepForm button.primary").click();
    await saved(first);
    await second.locator("#completeNext").waitFor();
    await second.locator("#completeNext").click();
    await saved(second);
    await first.waitForFunction(() => state.missions[0].steps[0].done);
    await first.locator("[data-toggle]").click();
    await saved(first);
    await second.waitForFunction(() => state.missions[0].steps[0].done === false);

    await mobile.setOffline(true);
    await second.locator("#theme").click();
    await second.waitForFunction(() => JSON.parse(localStorage.getItem(KEY + "-outbox")).tracker.theme === "light");
    await first.getByRole("button", { name: "Мій шлях", exact: true }).click();
    await first.locator("#vision-form [name=present]").fill("Поточна точка А");
    await first.locator("#vision-form button").click();
    await first.locator("[data-path-graphic=avatar]").setInputFiles(path.resolve(__dirname, "../dist/icon-180.png"));
    await first.locator("#path-graphics img").waitFor();
    await saved(first);
    await mobile.setOffline(false);
    await second.locator("#workspace-review").click();
    second.once("dialog", (dialog) => dialog.accept());
    await second.locator("#sync-use-server").click();
    await second.waitForFunction(() => state.theme === "dark" && state.pilot.vision.present === "Поточна точка А");
    assert.equal(await second.evaluate(() => JSON.parse(localStorage.getItem(KEY + "-before-sync-resolution")).theme), "light");
    await second.reload();
    await second.locator("#hero-avatar").waitFor();
    assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await second.goto(base + "/coach");
    await second.getByRole("button", { name: /Активний · test-coach/ }).click();
    await second.getByRole("heading", { name: "Активна співпраця" }).waitFor();
    await second.getByText("Видимість блоків для коуча").click();
    const project = second.getByRole("heading", { name: "Тестовий проєкт", exact: true }).locator("..");
    await project.getByRole("button", { name: "Закрити блок" }).click();
    await project.getByRole("button", { name: "Відкрити блок" }).waitFor();
    await coach.reload();
    await coach.getByRole("button", { name: /Активний · test-client/ }).click();
    await coach.getByRole("heading", { name: "Активна співпраця" }).waitFor();
    await coach.getByText("Доступні блоки").click();
    assert.equal(await coach.getByRole("heading", { name: "Тестовий проєкт", exact: true }).count(), 0);
    await second.getByText("Ви увійшли як test-client").waitFor();
    await second.getByRole("button", { name: "Вийти", exact: true }).click();
    await second.getByText("Ви не увійшли до Вершини.").waitFor();
    await second.goto(base);
    await second.waitForURL("**/account");

    await coach.getByRole("link", { name: "Мій трекер", exact: true }).click();
    await coach.waitForURL("**/tracker");
    await coach.locator("#newMission").click();
    await coach.locator("#missionName").fill("Особиста ціль коуча");
    await coach.locator("#missionGoal").fill("Особистий результат");
    await coach.locator("#missionForm button.primary").click();
    await saved(coach);
    assert.equal(await first.getByText("Особиста ціль коуча", { exact: true }).count(), 0);
    await coach.getByRole("button", { name: "Вийти", exact: true }).click();
    await coach.getByText("Ви не увійшли до Вершини.").waitFor();
    await coach.locator('[name="key"]').fill(clientKey);
    await coach.getByRole("button", { name: "Увійти" }).click();
    await coach.waitForURL("**/tracker");
    await coach.getByText("Ви увійшли як test-client").waitFor();
    assert.equal(await coach.getByText("Особиста ціль коуча", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("Browser checks passed for synchronization, offline conflict recovery, avatar, coach visibility, account switching, and logout.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
