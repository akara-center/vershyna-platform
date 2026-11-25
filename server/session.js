"use strict";

(() => {
  const navigation = document.querySelector(".session-navigation");
  const logout = navigation.querySelector("[data-session-logout]");
  const status = navigation.querySelector("[data-session-status]");

  logout.onclick = async () => {
    logout.disabled = true;
    status.textContent = "";
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        cache: "no-store",
        headers: { "X-Vershyna-Account": navigation.dataset.account },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok && response.status !== 401) throw Error();
      location.replace("/account");
    } catch {
      status.textContent = "Не вдалося вийти. Спробуйте ще раз.";
      logout.disabled = false;
    }
  };

  addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
})();
