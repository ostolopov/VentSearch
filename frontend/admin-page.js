/** Страница admin.html: проверка роли admin, общая шапка, загрузка панели. */
(function () {
  if (document.body.dataset.page !== "admin" || !window.VentAuth) return;

  const { apiUrl, apiAuthFetch, setAuthSession, clearAuthSession, getAuthToken } = window.VentAuth;

  const PROJECT_STORAGE_KEY = "ventsearch.project.ids";

  function $(id) {
    return document.getElementById(id);
  }

  function loadProjectIds() {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }

  function updateProjectNavBadge() {
    const badge = $("navProjectBadge");
    if (!badge) return;
    const count = loadProjectIds().length;
    badge.textContent = String(count);
    badge.classList.toggle("d-none", count === 0);
  }

  function bindSharedNav() {
    const headerSearchInput = $("headerSearchInput");
    const headerSearchBtn = $("headerSearchBtn");

    headerSearchBtn?.addEventListener("click", () => {
      const q = String(headerSearchInput?.value || "").trim();
      window.location.href = q ? `index.html?q=${encodeURIComponent(q)}` : "index.html";
    });

    headerSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        headerSearchBtn?.click();
      }
    });

    $("shareLinkBtn")?.addEventListener("click", async () => {
      try {
        const res = await fetch(apiUrl("/api/share-links"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
        if (!urls.length) {
          window.alert("Не удалось сгенерировать ссылку для локальной сети.");
          return;
        }
        const first = urls[0];
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(first);
        }
        window.alert(`Ссылка скопирована в буфер обмена:\n${first}\n\nДополнительно:\n${urls.join("\n")}`);
      } catch (err) {
        console.error(err);
        window.alert("Не удалось сгенерировать ссылку. Проверьте доступность API.");
      }
    });

    updateProjectNavBadge();
  }

  function showGateError(message) {
    const gate = $("adminGate");
    if (!gate) return;
    gate.replaceChildren();
    gate.className = "py-5 text-center";
    const p = document.createElement("p");
    p.className = "text-danger mb-2";
    p.textContent = message;
    const link = document.createElement("a");
    link.className = "btn btn-dark btn-sm";
    link.href = "auth.html";
    link.textContent = "Войти";
    gate.append(p, link);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindSharedNav();

    const token = getAuthToken();
    if (!token) {
      showGateError("Требуется вход администратора.");
      return;
    }

    try {
      const me = await apiAuthFetch("/api/auth/me");
      setAuthSession(token, me);
      if (me.role !== "admin") {
        showGateError("Доступ только для администраторов.");
        return;
      }
      $("adminGate")?.classList.add("d-none");
      const section = $("adminAppSection");
      section?.classList.remove("d-none");
      if (window.VentAdmin) {
        await window.VentAdmin.boot(me);
      }
    } catch (err) {
      console.error(err);
      clearAuthSession();
      showGateError(err.message || "Сессия недействительна.");
    }
  });
})();
