/** Страница auth.html: вход/регистрация с переходом на главную после успеха. */
(function () {
  if (document.body.dataset.page !== "auth" || !window.VentAuth) return;

  const { apiAuthFetch, setAuthSession, clearAuthSession, getAuthToken } = window.VentAuth;

  function showAuthError(msg) {
    const el = document.getElementById("authAlert");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("d-none");
    document.getElementById("authSuccess")?.classList.add("d-none");
  }

  function showAuthSuccess(msg) {
    const el = document.getElementById("authSuccess");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("d-none");
    document.getElementById("authAlert")?.classList.add("d-none");
  }

  function afterAuth(user) {
    window.location.replace(user.role === "admin" ? "admin.html" : "index.html");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (getAuthToken()) {
      apiAuthFetch("/api/auth/me")
        .then((me) => {
          window.location.replace(me.role === "admin" ? "admin.html" : "index.html");
        })
        .catch(() => window.location.replace("index.html"));
      return;
    }

    document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const data = await apiAuthFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("loginEmail").value.trim(),
            password: document.getElementById("loginPassword").value,
          }),
        });
        setAuthSession(data.access_token, data.user);
        showAuthSuccess("Переход в каталог…");
        afterAuth(data.user);
      } catch (err) {
        showAuthError(err.message || "Ошибка входа");
      }
    });

    document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const data = await apiAuthFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: document.getElementById("regEmail").value.trim(),
            password: document.getElementById("regPassword").value,
            name: document.getElementById("regName").value.trim(),
            company: document.getElementById("regCompany").value.trim(),
            phone: document.getElementById("regPhone").value.trim(),
          }),
        });
        setAuthSession(data.access_token, data.user);
        showAuthSuccess("Регистрация успешна. Переход в каталог…");
        afterAuth(data.user);
      } catch (err) {
        showAuthError(err.message || "Ошибка регистрации");
      }
    });
  });
})();
