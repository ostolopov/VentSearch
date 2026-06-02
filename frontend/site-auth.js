/**

 * Общая авторизация на сайте: навбар, вход на главной.

 */

(function () {

  if (!window.VentAuth) return;



  const { apiAuthFetch, setAuthSession, clearAuthSession, getAuthUser, getAuthToken } = window.VentAuth;



  const ADMIN_URL = "admin.html";



  function $(id) {

    return document.getElementById(id);

  }



  function openAdminInNewTab() {

    window.open(ADMIN_URL, "_blank", "noopener,noreferrer");

  }



  function maybeOpenAdminTab() {
    if (document.body.dataset.page === "admin") return;
    if (sessionStorage.getItem("ventsearch.openAdmin") !== "1") return;
    sessionStorage.removeItem("ventsearch.openAdmin");
    openAdminInNewTab();
  }



  function renderNavGuest() {
    $("navAuthGuest")?.classList.remove("d-none");
    $("navAuthUser")?.classList.add("d-none");
    const shareBtn = $("shareLinkBtn");
    if (shareBtn) shareBtn.style.display = "none";
  }

  function renderNavUser(user) {
    $("navAuthGuest")?.classList.add("d-none");
    const navUser = $("navAuthUser");
    navUser?.classList.remove("d-none");
    const emailEl = $("navAuthEmail");
    if (emailEl) emailEl.textContent = user.email || "";
    const adminItem = $("navAdminMenuItem");
    if (adminItem) adminItem.classList.toggle("d-none", user.role !== "admin");
    const shareBtn = $("shareLinkBtn");
    if (shareBtn) shareBtn.style.display = user.role === "admin" ? "inline-block" : "none";
  }



  function syncProjectProfileFromUser(user) {

    if (document.body.dataset.page !== "project" || !user) return;

    const map = [

      ["profileCompany", user.company],

      ["profileName", user.name],

      ["profileEmail", user.email],

      ["profilePhone", user.phone],

    ];

    for (const [id, value] of map) {

      const el = $(id);

      if (el && value != null) el.value = value;

    }

    try {

      localStorage.setItem(

        "ventsearch.user.profile",

        JSON.stringify({

          company: user.company || "",

          name: user.name || "",

          email: user.email || "",

          phone: user.phone || "",

        }),

      );

    } catch {

      // ignore

    }

  }



  async function applySession(user) {

    renderNavUser(user);

    syncProjectProfileFromUser(user);

    if (user.role === "admin") {

      maybeOpenAdminTab();

    }

  }



  async function refreshSession() {

    const token = getAuthToken();

    if (!token) {

      renderNavGuest();

      return;

    }

    try {

      const me = await apiAuthFetch("/api/auth/me");

      setAuthSession(token, me);

      await applySession(me);

    } catch (err) {

      console.error(err);

      clearAuthSession();

      renderNavGuest();

    }

  }



  function bindAuthModal() {

    const loginForm = $("authModalLoginForm");

    const registerForm = $("authModalRegisterForm");

    const alertEl = $("authModalAlert");



    loginForm?.addEventListener("submit", async (e) => {

      e.preventDefault();

      alertEl?.classList.add("d-none");

      try {

        const data = await apiAuthFetch("/api/auth/login", {

          method: "POST",

          body: JSON.stringify({

            email: $("authModalLoginEmail")?.value.trim(),

            password: $("authModalLoginPassword")?.value,

          }),

        });

        setAuthSession(data.access_token, data.user);

        bootstrap.Modal.getInstance($("authModal"))?.hide();

        if (data.user.role === "admin") {

          sessionStorage.setItem("ventsearch.openAdmin", "1");

        }

        if (document.body.dataset.page === "catalog" || document.body.dataset.page === "delivery") {

          await applySession(data.user);

        } else {

          window.location.href = data.user.role === "admin" ? ADMIN_URL : "index.html";

        }

      } catch (err) {

        if (alertEl) {

          alertEl.textContent = err.message || "Ошибка входа";

          alertEl.classList.remove("d-none");

        }

      }

    });



    registerForm?.addEventListener("submit", async (e) => {

      e.preventDefault();

      alertEl?.classList.add("d-none");

      try {

        const data = await apiAuthFetch("/api/auth/register", {

          method: "POST",

          body: JSON.stringify({

            email: $("authModalRegEmail")?.value.trim(),

            password: $("authModalRegPassword")?.value,

            name: $("authModalRegName")?.value.trim(),

            company: $("authModalRegCompany")?.value.trim(),

            phone: $("authModalRegPhone")?.value.trim(),

          }),

        });

        setAuthSession(data.access_token, data.user);

        bootstrap.Modal.getInstance($("authModal"))?.hide();

        if (document.body.dataset.page === "catalog" || document.body.dataset.page === "delivery") {

          await applySession(data.user);

        } else {

          window.location.href = "index.html";

        }

      } catch (err) {

        if (alertEl) {

          alertEl.textContent = err.message || "Ошибка регистрации";

          alertEl.classList.remove("d-none");

        }

      }

    });

  }



  document.addEventListener("DOMContentLoaded", () => {

    $("navLogoutBtn")?.addEventListener("click", () => {

      clearAuthSession();

      renderNavGuest();

      if (document.body.dataset.page === "auth") window.location.href = "index.html";
      else if (document.body.dataset.page === "admin") window.location.href = "auth.html";
      else window.location.reload();
    });



    bindAuthModal();

    refreshSession().then(() => {

      if (location.hash === "#login" && $("authModal")) {

        new bootstrap.Modal($("authModal")).show();

      }

    });

  });



  window.VentSiteAuth = { refreshSession, openAdminInNewTab };

})();


