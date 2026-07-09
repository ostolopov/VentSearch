(function () {
const PAGE_SIZE = 50;

const state = {
  products: { q: "", offset: 0, total: 0, editingId: null, selectedIds: new Set(), pageIds: [] },
  users: { q: "", offset: 0, total: 0, editingId: null, selectedIds: new Set(), pageIds: [] },
};

let productModal;
let userModal;

function va() {
  if (!window.VentAuth) {
    throw new Error("Не загружен auth.js — обновите страницу (Ctrl+F5)");
  }
  return window.VentAuth;
}

function $(sel) {
  return document.querySelector(sel);
}

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showAdminError(msg) {
  const el = $("#adminAlert");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("d-none");
  $("#adminSuccess")?.classList.add("d-none");
}

function showAdminSuccess(msg) {
  const el = $("#adminSuccess");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("d-none");
  $("#adminAlert")?.classList.add("d-none");
}

function hideAdminMessages() {
  $("#adminAlert")?.classList.add("d-none");
  $("#adminSuccess")?.classList.add("d-none");
}

function updateProductsBulkUi() {
  const n = state.products.selectedIds.size;
  const btn = $("#productsDeleteSelectedBtn");
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `Удалить выбранные (${n})` : "Удалить выбранные";
  }
  const selectAll = $("#productsSelectAll");
  if (selectAll) {
    const pageIds = state.products.pageIds;
    selectAll.checked = pageIds.length > 0 && pageIds.every((id) => state.products.selectedIds.has(id));
    selectAll.indeterminate =
      n > 0 && pageIds.some((id) => state.products.selectedIds.has(id)) && !selectAll.checked;
  }
}

function updateUsersBulkUi() {
  const n = state.users.selectedIds.size;
  const btn = $("#usersDeleteSelectedBtn");
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `Удалить выбранные (${n})` : "Удалить выбранные";
  }
  const selectAll = $("#usersSelectAll");
  if (selectAll) {
    const pageIds = state.users.pageIds;
    selectAll.checked = pageIds.length > 0 && pageIds.every((id) => state.users.selectedIds.has(id));
    selectAll.indeterminate =
      n > 0 && pageIds.some((id) => state.users.selectedIds.has(id)) && !selectAll.checked;
  }
}

function formatBulkErrors(errors) {
  const map = {
    "Cannot delete your own account": "нельзя удалить свой аккаунт",
    "Cannot delete the last admin": "нельзя удалить последнего администратора",
    "Cannot delete protected admin account": "нельзя удалить системного администратора",
    "User not found": "пользователь не найден",
  };
  return errors
    .map((e) => `#${e.id}: ${map[e.error] || e.error}`)
    .join("; ");
}

function formatPrice(price) {
  if (price === null || price === undefined || Number.isNaN(Number(price))) return "по запросу";
  return new Intl.NumberFormat("ru-RU").format(price) + "\u00A0₽";
}

function productToForm(p) {
  return {
    id: p.id || "",
    number: p.number || p.id || "",
    type: p.type || "",
    model: p.model || "",
    size: p.size || "",
    diameter: p.diameter ?? "",
    airflow_min: p.airflow?.min ?? "",
    airflow_max: p.airflow?.max ?? "",
    airflow_raw: p.airflow?.raw || "",
    pressure_min: p.pressure?.min ?? "",
    pressure_max: p.pressure?.max ?? "",
    pressure_raw: p.pressure?.raw || "",
    power: p.power ?? "",
    noise_level: p.noise_level ?? "",
    price: p.price ?? "",
  };
}

function readProductForm(form) {
  const fd = new FormData(form);
  const num = (name) => {
    const v = fd.get(name);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(fd.get("id") || "").trim(),
    number: String(fd.get("number") || fd.get("id") || "").trim(),
    type: String(fd.get("type") || "").trim(),
    model: String(fd.get("model") || "").trim(),
    size: String(fd.get("size") || "").trim(),
    diameter: num("diameter"),
    airflow_min: num("airflow_min"),
    airflow_max: num("airflow_max"),
    airflow_raw: String(fd.get("airflow_raw") || "").trim(),
    pressure_min: num("pressure_min"),
    pressure_max: num("pressure_max"),
    pressure_raw: String(fd.get("pressure_raw") || "").trim(),
    power: num("power"),
    noise_level: num("noise_level"),
    price: num("price"),
  };
}

function fillForm(form, data) {
  for (const [key, value] of Object.entries(data)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    input.value = value === null || value === undefined ? "" : value;
  }
}

function ensureAdminModals() {
  if (typeof bootstrap === "undefined") return;
  const pm = document.getElementById("productModal");
  const um = document.getElementById("userModal");
  if (pm && !productModal) productModal = bootstrap.Modal.getOrCreateInstance(pm);
  if (um && !userModal) userModal = bootstrap.Modal.getOrCreateInstance(um);
}

function bindAdminEvents() {
  const root = document.getElementById("adminAppSection");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";

  // Диагностика: загружаем при первом открытии вкладки и по кнопке «Обновить»
  document.getElementById("debugTabBtn")?.addEventListener("shown.bs.tab", () => {
    loadDebug().catch((err) => showAdminError(err.message));
  });

  root.addEventListener("click", (e) => {
    if (e.target.closest("#debugRefreshBtn")) {
      loadDebug().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#productSearchBtn")) {
      state.products.q = $("#productSearch")?.value.trim() || "";
      state.products.offset = 0;
      state.products.selectedIds.clear();
      loadProducts().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#productsDeleteSelectedBtn")) {
      bulkDeleteProducts().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#usersDeleteSelectedBtn")) {
      bulkDeleteUsers().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#productCreateBtn")) {
      openProductModal(null, true);
      return;
    }
    if (e.target.closest("#productsPrevBtn")) {
      state.products.offset = Math.max(0, state.products.offset - PAGE_SIZE);
      state.products.selectedIds.clear();
      loadProducts().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#productsNextBtn")) {
      state.products.offset += PAGE_SIZE;
      state.products.selectedIds.clear();
      loadProducts().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#userSearchBtn")) {
      state.users.q = $("#userSearch")?.value.trim() || "";
      state.users.offset = 0;
      state.users.selectedIds.clear();
      loadUsers().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#userCreateBtn")) {
      openUserModal(null, true);
      return;
    }
    if (e.target.closest("#usersPrevBtn")) {
      state.users.offset = Math.max(0, state.users.offset - PAGE_SIZE);
      state.users.selectedIds.clear();
      loadUsers().catch((err) => showAdminError(err.message));
      return;
    }
    if (e.target.closest("#usersNextBtn")) {
      state.users.offset += PAGE_SIZE;
      state.users.selectedIds.clear();
      loadUsers().catch((err) => showAdminError(err.message));
      return;
    }

    const btn = e.target.closest("#productsTableBody button[data-action], #usersTableBody button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "edit-product") {
      va()
        .apiAuthFetch(`/api/admin/products/${encodeURIComponent(id)}`)
        .then((p) => openProductModal(p, false))
        .catch((err) => showAdminError(err.message));
    }
    if (btn.dataset.action === "delete-product") {
      if (!window.confirm(`Удалить вентилятор ${id}?`)) return;
      va()
        .apiAuthFetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" })
        .then(async () => {
          state.products.selectedIds.delete(String(id));
          showAdminSuccess("Вентилятор удалён");
          await loadProducts();
        })
        .catch((err) => showAdminError(err.message));
    }
    if (btn.dataset.action === "edit-user") {
      va()
        .apiAuthFetch(`/api/admin/users/${id}`)
        .then((user) => openUserModal(user, false))
        .catch((err) => showAdminError(err.message));
    }
    if (btn.dataset.action === "delete-user") {
      if (!window.confirm(`Удалить пользователя #${id}?`)) return;
      va()
        .apiAuthFetch(`/api/admin/users/${id}`, { method: "DELETE" })
        .then(async () => {
          state.users.selectedIds.delete(String(id));
          showAdminSuccess("Пользователь удалён");
          await loadUsers();
        })
        .catch((err) => showAdminError(err.message));
    }
  });

  root.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;

    if (target.id === "productsSelectAll") {
      for (const id of state.products.pageIds) {
        if (target.checked) state.products.selectedIds.add(id);
        else state.products.selectedIds.delete(id);
      }
      for (const cb of $("#productsTableBody")?.querySelectorAll('input[data-select="product"]') || []) {
        cb.checked = target.checked;
      }
      updateProductsBulkUi();
      return;
    }
    if (target.id === "usersSelectAll") {
      for (const id of state.users.pageIds) {
        if (target.checked) state.users.selectedIds.add(String(id));
        else state.users.selectedIds.delete(String(id));
      }
      for (const cb of $("#usersTableBody")?.querySelectorAll('input[data-select="user"]') || []) {
        cb.checked = target.checked;
      }
      updateUsersBulkUi();
      return;
    }
    if (target.dataset.select === "product") {
      const id = target.dataset.id;
      if (target.checked) state.products.selectedIds.add(id);
      else state.products.selectedIds.delete(id);
      updateProductsBulkUi();
      return;
    }
    if (target.dataset.select === "user") {
      const id = target.dataset.id;
      if (target.checked) state.users.selectedIds.add(id);
      else state.users.selectedIds.delete(id);
      updateUsersBulkUi();
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "productSearch") {
      e.preventDefault();
      state.products.q = e.target.value.trim();
      state.products.offset = 0;
      state.products.selectedIds.clear();
      loadProducts().catch((err) => showAdminError(err.message));
    }
    if (e.target.id === "userSearch") {
      e.preventDefault();
      state.users.q = e.target.value.trim();
      state.users.offset = 0;
      state.users.selectedIds.clear();
      loadUsers().catch((err) => showAdminError(err.message));
    }
  });

  const productForm = document.getElementById("productForm");
  if (productForm && productForm.dataset.bound !== "1") {
    productForm.dataset.bound = "1";
    productForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = readProductForm(e.target);
      try {
        if (state.products.editingId) {
          await va().apiAuthFetch(`/api/admin/products/${encodeURIComponent(state.products.editingId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          showAdminSuccess("Вентилятор обновлён");
        } else {
          await va().apiAuthFetch("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          showAdminSuccess("Вентилятор создан");
        }
        productModal?.hide();
        await loadProducts();
      } catch (err) {
        showAdminError(err.message);
      }
    });
  }

  const userForm = document.getElementById("userForm");
  if (userForm && userForm.dataset.bound !== "1") {
    userForm.dataset.bound = "1";
    userForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const isCreate = !state.users.editingId;
      const body = {
        email: form.elements.email.value.trim(),
        name: form.elements.name.value.trim(),
        company: form.elements.company.value.trim(),
        phone: form.elements.phone.value.trim(),
        role: form.elements.role.value,
        is_active: form.elements.is_active.checked,
      };
      const password = form.elements.password.value;
      if (password) body.password = password;
      try {
        if (isCreate) {
          if (!password || password.length < 6) {
            showAdminError("Укажите пароль не короче 6 символов");
            return;
          }
          await va().apiAuthFetch("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
          showAdminSuccess("Пользователь создан");
        } else {
          await va().apiAuthFetch(`/api/admin/users/${state.users.editingId}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          showAdminSuccess("Пользователь обновлён");
        }
        userModal?.hide();
        await loadUsers();
      } catch (err) {
        showAdminError(err.message);
      }
    });
  }
}

async function bulkDeleteProducts() {
  const ids = [...state.products.selectedIds];
  if (!ids.length) return;
  if (!window.confirm(`Удалить выбранные позиции (${ids.length})? Это действие нельзя отменить.`)) return;
  const data = await va().apiAuthFetch("/api/admin/products/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  state.products.selectedIds.clear();
  showAdminSuccess(`Удалено вентиляторов: ${data.deleted ?? 0}`);
  await loadProducts();
}

async function bulkDeleteUsers() {
  const ids = [...state.users.selectedIds].map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!ids.length) return;
  if (!window.confirm(`Удалить выбранных пользователей (${ids.length})? Это действие нельзя отменить.`)) return;
  const data = await va().apiAuthFetch("/api/admin/users/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  state.users.selectedIds.clear();
  let msg = `Удалено пользователей: ${data.deleted ?? 0}`;
  if (Array.isArray(data.errors) && data.errors.length) {
    msg += `. Не удалено: ${formatBulkErrors(data.errors)}`;
  }
  if ((data.deleted ?? 0) > 0) showAdminSuccess(msg);
  else showAdminError(msg);
  await loadUsers();
}

async function loadProducts() {
  hideAdminMessages();
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(state.products.offset),
  });
  if (state.products.q) params.set("q", state.products.q);
  const data = await va().apiAuthFetch(`/api/admin/products?${params}`);
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Некорректный ответ сервера (каталог)");
  }
  state.products.total = data.total ?? 0;
  state.products.pageIds = data.items.map((p) => String(p.id));
  const tbody = $("#productsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const p of data.items) {
    const id = String(p.id);
    const checked = state.products.selectedIds.has(id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">
        <input class="form-check-input m-0" type="checkbox" data-select="product" data-id="${escapeHtml(id)}"${
      checked ? " checked" : ""
    } aria-label="Выбрать ${escapeHtml(id)}" />
      </td>
      <td><code>${escapeHtml(p.id)}</code></td>
      <td>${escapeHtml(p.model || "—")}</td>
      <td>${escapeHtml(p.type || "—")}</td>
      <td>${escapeHtml(formatPrice(p.price))}</td>
      <td class="text-end">
        <button type="button" class="btn btn-outline-dark btn-sm me-1" data-action="edit-product" data-id="${escapeHtml(p.id)}">Изменить</button>
        <button type="button" class="btn btn-outline-danger btn-sm" data-action="delete-product" data-id="${escapeHtml(p.id)}">Удалить</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  updateProductsBulkUi();
  const page = Math.floor(state.products.offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
  const meta = $("#productsMeta");
  if (meta) meta.textContent = `Найдено: ${data.total ?? 0}`;
  const label = $("#productsPageLabel");
  if (label) label.textContent = `Стр. ${page} / ${pages}`;
  const prev = $("#productsPrevBtn");
  const next = $("#productsNextBtn");
  if (prev) prev.disabled = state.products.offset <= 0;
  if (next) next.disabled = state.products.offset + PAGE_SIZE >= (data.total || 0);
}

async function loadUsers() {
  hideAdminMessages();
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(state.users.offset),
  });
  if (state.users.q) params.set("q", state.users.q);
  const data = await va().apiAuthFetch(`/api/admin/users?${params}`);
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Некорректный ответ сервера (пользователи)");
  }
  state.users.total = data.total ?? 0;
  state.users.pageIds = data.items.filter((u) => !u.is_protected).map((u) => String(u.id));
  const tbody = $("#usersTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const u of data.items) {
    const id = String(u.id);
    if (u.is_protected) state.users.selectedIds.delete(id);
    const checked = !u.is_protected && state.users.selectedIds.has(id);
    const selectCell = u.is_protected
      ? '<span class="text-secondary small" title="Системный аккаунт">—</span>'
      : `<input class="form-check-input m-0" type="checkbox" data-select="user" data-id="${escapeHtml(id)}"${
          checked ? " checked" : ""
        } aria-label="Выбрать пользователя ${escapeHtml(id)}" />`;
    const deleteBtn = u.is_protected
      ? '<span class="text-secondary small">защищён</span>'
      : `<button type="button" class="btn btn-outline-danger btn-sm" data-action="delete-user" data-id="${u.id}">Удалить</button>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">${selectCell}</td>
      <td>${u.id}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.name || "—")}</td>
      <td><span class="badge ${u.role === "admin" ? "text-bg-dark" : "text-bg-secondary"}">${escapeHtml(u.role)}</span></td>
      <td>${u.is_active ? "активен" : "отключён"}</td>
      <td class="text-end">
        <button type="button" class="btn btn-outline-dark btn-sm me-1" data-action="edit-user" data-id="${u.id}">Изменить</button>
        ${deleteBtn}
      </td>
    `;
    tbody.appendChild(tr);
  }
  updateUsersBulkUi();
  const page = Math.floor(state.users.offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
  const meta = $("#usersMeta");
  if (meta) meta.textContent = `Найдено: ${data.total ?? 0}`;
  const label = $("#usersPageLabel");
  if (label) label.textContent = `Стр. ${page} / ${pages}`;
  const prev = $("#usersPrevBtn");
  const next = $("#usersNextBtn");
  if (prev) prev.disabled = state.users.offset <= 0;
  if (next) next.disabled = state.users.offset + PAGE_SIZE >= (data.total || 0);
}

function formatUptime(totalSeconds) {
  const s = Number(totalSeconds) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч ${m} мин`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин ${s % 60} с`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${n} Б`;
}

function debugBoolBadge(value, { trueIsBad = false, trueLabel = "да", falseLabel = "нет" } = {}) {
  const bad = trueIsBad ? value === true : value === false;
  const cls = bad ? "text-bg-danger" : "text-bg-success";
  return `<span class="badge ${cls}">${value ? trueLabel : falseLabel}</span>`;
}

function renderDebugCard(title, rows) {
  const body = rows
    .filter(([, v]) => v !== undefined)
    .map(
      ([label, valueHtml]) =>
        `<tr><th class="text-secondary fw-normal w-50">${escapeHtml(label)}</th><td>${valueHtml}</td></tr>`,
    )
    .join("");
  return `
    <div class="col-12 col-lg-6">
      <div class="card shadow-sm h-100">
        <div class="card-header py-2 fw-semibold">${escapeHtml(title)}</div>
        <table class="table table-sm mb-0"><tbody>${body}</tbody></table>
      </div>
    </div>`;
}

async function loadDebug() {
  hideAdminMessages();
  const content = $("#debugContent");
  if (!content) return;
  content.innerHTML = '<div class="text-secondary small py-4 text-center">Загрузка…</div>';

  const d = await va().apiAuthFetch("/api/admin/debug");
  const cards = [];

  const srv = d.server || {};
  cards.push(renderDebugCard("Сервер", [
    ["Python", escapeHtml(srv.python ?? "—")],
    ["Платформа", escapeHtml(srv.platform ?? "—")],
    ["Порт API", escapeHtml(srv.port ?? "—")],
    ["Аптайм", escapeHtml(formatUptime(srv.uptime_seconds))],
    ["Время сервера (UTC)", escapeHtml(srv.time_utc ?? "—")],
  ]));

  const db = d.database || {};
  cards.push(renderDebugCard("База данных", db.error ? [
    ["Статус", debugBoolBadge(false, { falseLabel: "ошибка" })],
    ["Ошибка", escapeHtml(db.error)],
  ] : [
    ["Статус", debugBoolBadge(true, { trueLabel: "подключена" })],
    ["Версия", escapeHtml(db.version ?? "—")],
    ["Вентиляторов", escapeHtml(db.products_total ?? "—")],
    ["Пользователей", escapeHtml(db.users_total ?? "—")],
    ["Администраторов", escapeHtml(db.admins_total ?? "—")],
  ]));

  const cat = d.catalog || {};
  cards.push(renderDebugCard("Каталог (CSV)", cat.error ? [
    ["Ошибка", escapeHtml(cat.error)],
  ] : [
    ["Файл", `<code class="small">${escapeHtml(cat.csv_path ?? "—")}</code>`],
    ["Файл существует", debugBoolBadge(cat.csv_exists === true)],
    ["Размер", escapeHtml(formatBytes(cat.csv_size_bytes))],
    ["Загружен в БД", debugBoolBadge(cat.synced === true)],
    cat.synced ? ["Синхронизирован", debugBoolBadge(cat.in_sync === true)] : undefined,
    cat.synced ? ["SHA-256 (нач.)", `<code class="small">${escapeHtml(cat.synced_sha256 ?? "—")}</code>`] : undefined,
  ].filter(Boolean)));

  const idx = d.search_index || {};
  cards.push(renderDebugCard("Поисковый индекс", idx.error ? [
    ["Ошибка", escapeHtml(idx.error)],
  ] : [
    ["Построен (Bloom + оси)", debugBoolBadge(idx.built === true)],
    idx.built ? ["Записей", escapeHtml(idx.rows ?? "—")] : undefined,
  ].filter(Boolean)));

  const sec = d.security || {};
  const rl = sec.login_rate_limit || {};
  cards.push(renderDebugCard("Безопасность", sec.error ? [
    ["Ошибка", escapeHtml(sec.error)],
  ] : [
    ["JWT-секрет по умолчанию", debugBoolBadge(sec.jwt_secret_is_default === true, { trueIsBad: true })],
    ["Пароль админа по умолчанию", debugBoolBadge(sec.admin_password_is_default === true, { trueIsBad: true })],
    ["Срок жизни токена", escapeHtml(`${sec.jwt_expire_hours ?? "—"} ч`)],
    ["Лимит попыток входа", escapeHtml(`${rl.max_attempts ?? "—"} за ${Math.round((rl.window_seconds ?? 0) / 60)} мин`)],
    ["CORS origins", `<code class="small">${escapeHtml((sec.cors_origins || []).join(", ") || "—")}</code>`],
  ]));

  content.innerHTML = cards.join("");

  const alertEl = $("#debugSecurityAlert");
  if (alertEl) {
    const problems = [];
    if (sec.jwt_secret_is_default) problems.push("JWT_SECRET не изменён со значения по умолчанию");
    if (sec.admin_password_is_default) problems.push("пароль администратора по умолчанию (admin123)");
    if (problems.length) {
      alertEl.textContent = `⚠ Небезопасная конфигурация: ${problems.join("; ")}. Задайте значения в secrets/.env.local и перезапустите сервер.`;
      alertEl.classList.remove("d-none");
    } else {
      alertEl.classList.add("d-none");
    }
  }

  const meta = $("#debugMeta");
  if (meta) meta.textContent = `Обновлено: ${new Date().toLocaleTimeString("ru-RU")}`;
}

function openProductModal(product, isCreate) {
  ensureAdminModals();
  const form = $("#productForm");
  if (!form || !productModal) {
    showAdminError("Форма редактирования недоступна. Обновите страницу.");
    return;
  }
  state.products.editingId = isCreate ? null : product?.id;
  const title = $("#productModalTitle");
  if (title) title.textContent = isCreate ? "Новый вентилятор" : `Редактирование ${product?.id}`;
  // disabled-поля не попадают в FormData — при сохранении id ушёл бы пустой
  // строкой и упал на валидации бэкенда; readOnly не даёт менять, но отправляется
  form.elements.id.readOnly = !isCreate;
  fillForm(form, product ? productToForm(product) : { id: "", number: "", type: "", model: "", size: "" });
  productModal.show();
}

function openUserModal(user, isCreate) {
  ensureAdminModals();
  const form = $("#userForm");
  if (!form || !userModal) {
    showAdminError("Форма пользователя недоступна. Обновите страницу.");
    return;
  }
  state.users.editingId = isCreate ? null : user?.id;
  const title = $("#userModalTitle");
  if (title) title.textContent = isCreate ? "Новый пользователь" : `Пользователь #${user?.id}`;
  const hint = $("#userPasswordHint");
  if (hint) hint.textContent = isCreate ? "(обязателен, мин. 6 символов)" : "(оставьте пустым, чтобы не менять)";
  form.elements.password.required = Boolean(isCreate);
  form.elements.user_id.value = user?.id || "";
  form.elements.email.value = user?.email || "";
  form.elements.password.value = "";
  form.elements.name.value = user?.name || "";
  form.elements.company.value = user?.company || "";
  form.elements.phone.value = user?.phone || "";
  form.elements.role.value = user?.role || "user";
  form.elements.is_active.checked = user?.is_active !== false;
  userModal.show();
}

async function bootAdmin(user) {
  bindAdminEvents();
  ensureAdminModals();
  const label = $("#adminUserLabel");
  if (label) label.textContent = user?.email || "—";
  if (!document.getElementById("productsTableBody")) {
    return;
  }
  try {
    await loadProducts();
    await loadUsers();
  } catch (err) {
    console.error(err);
    showAdminError(err.message || "Не удалось загрузить данные. Проверьте вход и API.");
  }
}

window.VentAdmin = { boot: bootAdmin, ensureAdminModals, bindAdminEvents };

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page === "admin") {
    bindAdminEvents();
    ensureAdminModals();
  }
});
})();
