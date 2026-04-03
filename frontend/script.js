// Небольшие утилиты
function $(selector) {
  return document.querySelector(selector);
}

function apiUrl(path) {
  const base = (typeof window !== "undefined" && window.VENTMASH_API_BASE
    ? String(window.VENTMASH_API_BASE)
    : ""
  ).replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU").format(n);
}

function formatPrice(price) {
  if (price === null || price === undefined || Number.isNaN(price)) {
    return "по запросу";
  }
  return `${formatNumber(price)} ₽`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка запроса ${url}: ${res.status} ${text}`);
  }
  return res.json();
}

// ---- Каталог ----

async function initCatalogPage() {
  const alertBox = $("#alertBox");
  const loading = $("#loading");
  const grid = $("#productsGrid");
  const emptyState = $("#emptyState");
  const resultsCount = $("#resultsCount");
  const filtersForm = $("#filtersForm");
  const resetBtn = $("#resetBtn");

  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function hideError() {
    if (!alertBox) return;
    alertBox.classList.add("d-none");
  }

  function setLoading(isLoading) {
    if (!loading) return;
    loading.style.display = isLoading ? "block" : "none";
  }

  function renderProducts(products) {
    if (!grid) return;
    grid.innerHTML = "";

    if (!Array.isArray(products) || products.length === 0) {
      emptyState?.classList.remove("d-none");
      if (resultsCount) resultsCount.textContent = "0";
      return;
    }

    emptyState?.classList.add("d-none");
    if (resultsCount) resultsCount.textContent = String(products.length);

    for (const p of products) {
      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-xl-4";

      const card = document.createElement("div");
      card.className = "card h-100 shadow-sm product-card";

      const imgWrap = document.createElement("div");
      imgWrap.className = "ratio ratio-4x3 bg-light d-flex align-items-center justify-content-center";
      imgWrap.innerHTML = '<span class="text-secondary small">Изображение вентилятора</span>';

      const body = document.createElement("div");
      body.className = "card-body d-flex flex-column";

      const title = document.createElement("h2");
      title.className = "h6 card-title mb-1";
      title.textContent = p.model || "Без названия";

      const subtitle = document.createElement("div");
      subtitle.className = "text-secondary small mb-2";
      subtitle.textContent = [p.type, p.size].filter(Boolean).join(" • ");

      const list = document.createElement("dl");
      list.className = "row small mb-3";

      function addSpec(label, value) {
        const dt = document.createElement("dt");
        dt.className = "col-6 text-secondary";
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.className = "col-6 mb-1";
        dd.textContent = value ?? "—";
        list.appendChild(dt);
        list.appendChild(dd);
      }

      addSpec("Диаметр", p.diameter != null ? `${p.diameter} мм` : "—");
      addSpec("Расход", p.airflow?.raw || "—");
      addSpec("Давление", p.pressure?.raw || "—");
      addSpec("Мощность", p.power != null ? `${p.power} Вт` : "—");
      addSpec("Шум", p.noise_level != null ? `${p.noise_level} дБ` : "—");
      addSpec("Цена", formatPrice(p.price));

      const spacer = document.createElement("div");
      spacer.className = "flex-grow-1";

      const btnWrap = document.createElement("div");
      btnWrap.className = "d-flex justify-content-between align-items-center mt-2";

      const priceEl = document.createElement("span");
      priceEl.className = "fw-semibold";
      priceEl.textContent = formatPrice(p.price);

      const btn = document.createElement("a");
      btn.className = "btn btn-sm btn-dark";
      btn.href = `product.html?id=${encodeURIComponent(p.id)}`;
      btn.textContent = "Подробнее";

      btnWrap.appendChild(priceEl);
      btnWrap.appendChild(btn);

      body.appendChild(title);
      body.appendChild(subtitle);
      body.appendChild(list);
      body.appendChild(spacer);
      body.appendChild(btnWrap);

      card.appendChild(imgWrap);
      card.appendChild(body);
      col.appendChild(card);
      grid.appendChild(col);
    }
  }

  function buildQueryFromForm() {
    const formData = new FormData(filtersForm);
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      const v = String(value).trim();
      if (v) params.set(key, v);
    }
    return params.toString();
  }

  async function loadAndRender(initialParams) {
    hideError();
    setLoading(true);
    try {
      const query = initialParams ?? buildQueryFromForm();
      const path = query ? `/api/products?${query}` : "/api/products";
      const url = apiUrl(path);
      const data = await fetchJson(url);
      renderProducts(data);
      return data;
    } catch (err) {
      console.error(err);
      showError("Не удалось загрузить каталог. Проверьте, что бэкенд запущен и VENTMASH_API_BASE в config.js указан верно.");
    } finally {
      setLoading(false);
    }
  }

  async function initFiltersFromData() {
    const data = await loadAndRender();
    if (!Array.isArray(data)) return;

    const typeSelect = $("#type");
    const diameterSelect = $("#diameter");

    if (typeSelect) {
      const types = Array.from(new Set(data.map((p) => p.type).filter(Boolean))).sort();
      for (const t of types) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
      }
    }

    if (diameterSelect) {
      const diameters = Array.from(
        new Set(data.map((p) => p.diameter).filter((d) => d !== null && d !== undefined)),
      ).sort((a, b) => a - b);

      for (const d of diameters) {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = `${d} мм`;
        diameterSelect.appendChild(opt);
      }
    }
  }

  filtersForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = buildQueryFromForm();
    loadAndRender(query);
  });

  resetBtn?.addEventListener("click", () => {
    filtersForm?.reset();
    loadAndRender("");
  });

  initFiltersFromData();
}

// ---- Страница товара ----

async function initProductPage() {
  const alertBox = $("#alertBox");
  const loading = $("#loading");
  const container = $("#productContainer");

  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function setLoading(isLoading) {
    if (!loading) return;
    loading.style.display = isLoading ? "block" : "none";
  }

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    setLoading(false);
    showError("Не передан идентификатор вентилятора в URL.");
    return;
  }

  try {
    setLoading(true);
    const data = await fetchJson(apiUrl(`/api/products/${encodeURIComponent(id)}`));

    $("#productTitle").textContent = data.model || "Без названия";
    $("#productSubtitle").textContent = [data.type, data.size].filter(Boolean).join(" • ");
    $("#productPrice").textContent = formatPrice(data.price);

    const specBody = $("#specTableBody");
    specBody.innerHTML = "";

    function addRow(label, value) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.className = "w-50 text-secondary";
      th.textContent = label;
      const td = document.createElement("td");
      td.textContent = value ?? "—";
      tr.appendChild(th);
      tr.appendChild(td);
      specBody.appendChild(tr);
    }

    addRow("ID", data.id);
    addRow("Номер в CSV", data.number);
    addRow("Тип", data.type);
    addRow("Модель", data.model);
    addRow("Типоразмер", data.size);
    addRow("Диаметр", data.diameter != null ? `${data.diameter} мм` : "—");
    addRow("Расход воздуха", data.airflow?.raw || "—");
    addRow("Давление", data.pressure?.raw || "—");
    addRow("Мощность", data.power != null ? `${data.power} Вт` : "—");
    addRow("Уровень шума", data.noise_level != null ? `${data.noise_level} дБ` : "—");
    addRow("Цена", formatPrice(data.price));

    if (data._raw) {
      addRow("RAW диаметр", data._raw.diameter || "—");
      addRow("RAW расход", data._raw.efficiency || "—");
      addRow("RAW давление", data._raw.pressure || "—");
      addRow("RAW мощность", data._raw.power || "—");
      addRow("RAW шум", data._raw.noise_level || "—");
      addRow("RAW цена", data._raw.price || "—");
    }

    container.classList.remove("d-none");
    if (alertBox) alertBox.classList.add("d-none");
  } catch (err) {
    console.error(err);
    showError("Не удалось загрузить данные вентилятора. Возможно, он не найден.");
  } finally {
    setLoading(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "catalog") {
    initCatalogPage();
  } else if (page === "product") {
    initProductPage();
  }
});
