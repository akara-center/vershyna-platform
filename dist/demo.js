"use strict";

// Synthetic workspace for a fresh test profile.
const demoMissionId = "demo-outdoors";
const demoMission = {
  id: demoMissionId,
  name: "Більше руху на свіжому повітрі",
  goal: "Знайти зручний маршрут і вийти на першу прогулянку цього тижня.",
  steps: [
    {
      id: "demo-route", name: "Обрати маршрут для першої прогулянки",
      result: "Збережений маршрут на 20–30 хвилин", minutes: 15, xp: 40, done: false,
    },
    {
      id: "demo-walk", name: "Вийти на першу прогулянку",
      result: "Є маршрут і перший досвід", minutes: 25, xp: 60, done: false,
      children: [
        { id: "demo-time", name: "Вибрати час у календарі", result: "", minutes: 5, xp: 20, done: false },
        { id: "demo-go", name: "Пройти маршрут", result: "", minutes: 25, xp: 40, done: false },
      ],
    },
  ],
};
