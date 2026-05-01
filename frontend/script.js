function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function apiUrl(path) {
  const base = (typeof window !== "undefined" && window.VENTMASH_API_BASE
    ? String(window.VENTMASH_API_BASE)
    : ""
  ).replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

const FAN_IMAGES_BY_MODEL = {
  // "вкоп-30-160-050-3": "vkop-30-160-050-3.jpg",
};

const FAN_IMAGES_BY_TYPE = {
  ВКОП: "vkop.jpeg",
  ВО: "vo.jpeg",
  ВР: "vr.jpeg",
  ВЦ: "vc.jpeg",
  УВО: "uvo.jpeg",
  Ц: "c.jpeg",
};

const PAGE_SIZE = 48;
let compareChart = null;
let productChart = null;
const COMPARE_STORAGE_KEY = "ventsearch.compare.ids";
const PROJECT_STORAGE_KEY = "ventsearch.project.ids";

function loadCompareIds() {
  try {
    const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function saveCompareIds(ids) {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify([...ids].map(String)));
  } catch {
    // ignore
  }
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

function saveProjectIds(ids) {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify([...ids].map(String)));
  } catch {
    // ignore
  }
}

async function fetchProductsByIds(ids) {
  const unique = [...new Set(ids.map(String))].filter(Boolean);
  const items = await Promise.all(unique.map((id) => fetchJson(apiUrl(`/api/products/${encodeURIComponent(id)}`))));
  return items.filter(Boolean);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU").format(n);
}

function formatPrice(price) {
  if (price === null || price === undefined || Number.isNaN(price)) return "по запросу";
  return `${formatNumber(price)}\u00A0₽`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\wа-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeType(type) {
  return String(type || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getImageFileName(product) {
  const modelCandidates = [
    product?.id,
    product?.model,
    product?.meta?.model_slug,
    product?._meta?.model_slug,
    slugify(product?.model),
  ].filter(Boolean);
  for (const key of modelCandidates) {
    const normalizedKey = String(key).trim().toLowerCase();
    if (normalizedKey && FAN_IMAGES_BY_MODEL[normalizedKey]) return FAN_IMAGES_BY_MODEL[normalizedKey];
  }
  const typeKey = normalizeType(product?.type);
  return FAN_IMAGES_BY_TYPE[typeKey] || null;
}

function getImageUrlCandidates(product) {
  const fileName = getImageFileName(product);
  if (!fileName) return [];
  const encoded = encodeURIComponent(fileName);
  const candidates = [apiUrl(`/photos/${encoded}`), `/photos/${encoded}`, `photos/${encoded}`];
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    candidates.push(`${window.location.origin}/photos/${encoded}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function renderFanImage(container, product, altText, lazy = true) {
  if (!container) return;
  container.innerHTML = "";
  const imageUrls = getImageUrlCandidates(product);
  if (!imageUrls.length) {
    container.innerHTML = '<span class="text-secondary small">Фото скоро появится</span>';
    return;
  }
  const img = document.createElement("img");
  img.className = "fan-photo";
  img.alt = altText || "Фото вентилятора";
  img.loading = lazy ? "lazy" : "eager";
  img.decoding = "async";
  let currentIndex = 0;
  img.src = imageUrls[currentIndex];
  img.addEventListener("error", () => {
    currentIndex += 1;
    if (currentIndex < imageUrls.length) {
      img.src = imageUrls[currentIndex];
      return;
    }
    container.innerHTML = '<span class="text-secondary small">Фото скоро появится</span>';
  });
  container.appendChild(img);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка запроса ${url}: ${res.status} ${text}`);
  }
  return res.json();
}

function getRangePeak(range) {
  if (!range || typeof range !== "object") return null;
  const max = toNumber(range.max);
  const min = toNumber(range.min);
  return max ?? min;
}

function getRangeNominal(range) {
  if (!range || typeof range !== "object") return null;
  const max = toNumber(range.max);
  const min = toNumber(range.min);
  if (max != null && min != null) return (max + min) / 2;
  return max ?? min;
}

function buildQpDatasetsShared(products) {
  const colors = ["#246bb3", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#16a085"];
  return products.map((p, idx) => {
    const qMax = getRangePeak(p.airflow) || 0;
    const pMax = getRangePeak(p.pressure) || 0;
    const points = [];
    const steps = 300;
    for (let i = 0; i <= steps; i += 1) {
      const q = (qMax / steps) * i;
      const pressure = pMax * (1 - (q / Math.max(qMax, 1)) ** 2);
      points.push({ x: q, y: Math.max(pressure, 0) });
    }
    return {
      label: p.model || p.id,
      data: points,
      borderColor: colors[idx % colors.length],
      backgroundColor: colors[idx % colors.length],
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 18,
      borderWidth: 2.5,
      fill: false,
      tension: 0.42,
    };
  });
}

function renderQpChartShared(canvas, chartRef, products) {
  if (!canvas || typeof Chart === "undefined") return chartRef;
  if (chartRef) chartRef.destroy();
  return new Chart(canvas, {
    type: "line",
    data: { datasets: buildQpDatasetsShared(products) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        axis: "xy",
        intersect: false,
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Расход воздуха, м³/ч" },
          ticks: { callback: (v) => formatNumber(v) },
        },
        y: {
          title: { display: true, text: "Давление, Па" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          enabled: true,
          displayColors: true,
          callbacks: {
            title(items) {
              if (!items?.length) return "";
              if (items.length === 1) {
                const item = items[0];
                return item?.dataset?.label ? `Модель: ${item.dataset.label}` : "";
              }
              return "Пересечение кривых";
            },
            label(context) {
              const model = context?.dataset?.label || "Модель";
              const q = context?.parsed?.x;
              const p = context?.parsed?.y;
              return `${model}: P ${formatNumber(p)} Па (Q ${formatNumber(q)} м³/ч)`;
            },
          },
        },
      },
      onHover(event, _active, chart) {
        const nearest = chart.getElementsAtEventForMode(
          event,
          "nearest",
          { intersect: false, axis: "xy" },
          false,
        );
        if (!nearest.length) {
          chart.setActiveElements([]);
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update("none");
          return;
        }

        const base = nearest[0];
        const sameIndex = chart.getElementsAtEventForMode(
          event,
          "index",
          { intersect: false, axis: "x" },
          false,
        );
        const baseMeta = chart.getDatasetMeta(base.datasetIndex);
        const basePoint = baseMeta?.data?.[base.index];
        const baseY = basePoint?.y;
        const thresholdPx = 8;

        const active = sameIndex.filter((item) => {
          const meta = chart.getDatasetMeta(item.datasetIndex);
          const point = meta?.data?.[item.index];
          if (!point || baseY == null) return false;
          return Math.abs(point.y - baseY) <= thresholdPx;
        });

        const selected = active.length ? active : [base];
        chart.setActiveElements(selected);
        chart.tooltip.setActiveElements(selected, { x: event.x, y: event.y });
        chart.update("none");
      },
    },
  });
}

function describeQuery(filters) {
  const parts = [];
  if (filters.type) parts.push(`Тип: ${filters.type}`);
  if (filters.minAirflow || filters.maxAirflow) parts.push(`Расход: ${filters.minAirflow || "—"}–${filters.maxAirflow || "—"} м³/ч`);
  if (filters.minPressure || filters.maxPressure) parts.push(`Давление: ${filters.minPressure || "—"}–${filters.maxPressure || "—"} Па`);
  if (filters.minPower || filters.maxPower) parts.push(`Мощность: ${filters.minPower || "—"}–${filters.maxPower || "—"} Вт`);
  return parts.length ? parts.join(" · ") : "Параметры запроса: не заданы";
}

function parseFilters(form) {
  const formData = new FormData(form);
  const filters = {};
  for (const [key, value] of formData.entries()) {
    const v = String(value || "").trim();
    if (v) filters[key] = v;
  }
  return filters;
}

function applyClientSort(items, sort) {
  const copy = [...items];
  if (sort === "airflow_desc") {
    copy.sort((a, b) => (getRangePeak(b.airflow) || 0) - (getRangePeak(a.airflow) || 0));
  } else if (sort === "pressure_desc") {
    copy.sort((a, b) => (getRangePeak(b.pressure) || 0) - (getRangePeak(a.pressure) || 0));
  }
  return copy;
}

function scoreAnalog(product, targets) {
  const values = {
    airflow: getRangeNominal(product.airflow),
    pressure: getRangeNominal(product.pressure),
    power: toNumber(product.power),
    price: toNumber(product.price),
    diameter: toNumber(product.diameter),
  };
  const weights = { airflow: 0.35, pressure: 0.3, power: 0.15, price: 0.1, diameter: 0.1 };
  let score = 0;
  let totalW = 0;
  for (const key of Object.keys(weights)) {
    const t = targets[key];
    const v = values[key];
    if (t == null || v == null || t === 0) continue;
    const diff = Math.abs(v - t) / Math.max(Math.abs(t), 1);
    const local = Math.max(0, 1 - diff);
    score += local * weights[key];
    totalW += weights[key];
  }
  if (!totalW) return 0;
  return Math.round((score / totalW) * 100);
}

async function initCatalogPage() {
  const alertBox = $("#alertBox");
  const loading = $("#loading");
  const grid = $("#productsGrid");
  const headerSearchInput = $("#headerSearchInput");
  const headerSearchBtn = $("#headerSearchBtn");
  const resultsCount = $("#resultsCount");
  const querySummary = $("#querySummary");
  const emptyQuerySummary = $("#emptyQuerySummary");
  const filtersForm = $("#filtersForm");
  const resetBtn = $("#resetBtn");
  const paginationNav = $("#paginationNav");
  const prevPageBtn = $("#prevPageBtn");
  const nextPageBtn = $("#nextPageBtn");
  const pageIndicator = $("#pageIndicator");
  const sortSelect = $("#sort");
  const typeSelect = $("#type");
  const diameterSelect = $("#diameter");
  const compareBar = $("#compareBar");
  const selectedCount = $("#selectedCount");
  const openCompareBtn = $("#openCompareBtn");
  const clearCompareBtn = $("#clearCompareBtn");
  const emptySection = $("#emptyStateSection");
  const backToFiltersBtn = $("#backToFiltersBtn");
  const analogsList = $("#analogsList");
  const shareLinkBtn = $("#shareLinkBtn");

  const state = {
    currentPage: 1,
    lastTotal: 0,
    lastLimit: PAGE_SIZE,
    filters: {},
    querySummaryText: "Параметры запроса: не заданы",
    currentItems: [],
    cacheById: new Map(),
    selectedIds: new Set(loadCompareIds()),
    projectIds: new Set(loadProjectIds()),
    analogs: [],
  };

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function hideError() {
    alertBox.classList.add("d-none");
  }

  function setLoading(isLoading) {
    loading.style.display = isLoading ? "block" : "none";
  }

  function showCatalogResults() {
    emptySection.classList.add("d-none");
    grid.parentElement?.classList.remove("d-none");
  }

  function showEmptyState() {
    emptySection.classList.remove("d-none");
    grid.parentElement?.classList.remove("d-none");
  }

  function getSelectedProducts() {
    return [...state.selectedIds].map((id) => state.cacheById.get(id)).filter(Boolean);
  }

  function updateCompareBar() {
    const n = state.selectedIds.size;
    selectedCount.textContent = `${n}`;
    compareBar.classList.toggle("compare-bar-hidden", n === 0);
    openCompareBtn.disabled = n < 2;
  }

  function syncSelectionUi() {
    const toggleButtons = grid.querySelectorAll(".btn-compare-toggle");
    for (const button of toggleButtons) {
      const id = String(button.dataset.id || "");
      const selected = state.selectedIds.has(id);
      button.classList.toggle("active", selected);
      button.textContent = selected ? "✓ В сравнении" : "+ Сравнить";
      button.title = selected ? "Уже добавлен в сравнение" : "Добавить в сравнение";
      const card = button.closest(".product-card");
      if (card) card.classList.toggle("selected", selected);
    }
    const projectButtons = grid.querySelectorAll(".btn-project-toggle");
    for (const button of projectButtons) {
      const id = String(button.dataset.id || "");
      const inProject = state.projectIds.has(id);
      button.classList.toggle("active", inProject);
      button.textContent = inProject ? "✓ В проекте" : "В проект";
      button.title = inProject ? "Уже добавлен в проект" : "Добавить в проект";
    }
  }

  function toggleProjectSelection(id) {
    if (state.projectIds.has(id)) {
      state.projectIds.delete(id);
    } else {
      state.projectIds.add(id);
    }
    saveProjectIds(state.projectIds);
    hideError();
    syncSelectionUi();
  }

  function toggleSelection(id) {
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
    }
    saveCompareIds(state.selectedIds);
    hideError();
    updateCompareBar();
    syncSelectionUi();
  }

  function renderProducts(products, meta) {
    grid.innerHTML = "";
    state.currentItems = Array.isArray(products) ? products : [];
    const total = meta?.total ?? 0;
    const page = meta?.page ?? 1;
    const limit = meta?.limit ?? PAGE_SIZE;
    state.lastTotal = total;
    state.lastLimit = limit;
    state.currentPage = page;

    const from = total > 0 ? (page - 1) * limit + 1 : 0;
    const to = Math.min(page * limit, total);
    resultsCount.textContent = total > 0 ? `${from}-${to} из ${formatNumber(total)}` : "0";
    querySummary.textContent = state.querySummaryText;

    if (!state.currentItems.length) {
      if (paginationNav) paginationNav.classList.add("d-none");
      return;
    }

    for (const p of state.currentItems) {
      state.cacheById.set(p.id, p);
      const col = document.createElement("div");
      col.className = "col-6 col-md-6 col-xl-4";

      const card = document.createElement("article");
      const selected = state.selectedIds.has(p.id);
      const inProject = state.projectIds.has(p.id);
      card.className = `card h-100 shadow-sm product-card${selected ? " selected" : ""}`;

      const imgWrap = document.createElement("div");
      imgWrap.className = "ratio ratio-4x3 bg-light d-flex align-items-center justify-content-center";
      renderFanImage(imgWrap, p, p.model || "Вентилятор");

      const body = document.createElement("div");
      body.className = "card-body d-flex flex-column";
      body.innerHTML = `
        <h2 class="h6 card-title mb-1">${escapeHtml(p.model || "Без названия")}</h2>
        <div class="text-secondary small mb-2">${escapeHtml([p.type, p.size].filter(Boolean).join(" • ") || "—")}</div>
        <dl class="row small mb-2">
          <dt class="col-6 text-secondary">Расход</dt><dd class="col-6 mb-1">${escapeHtml(p.airflow?.raw || "—")}</dd>
          <dt class="col-6 text-secondary">Давление</dt><dd class="col-6 mb-1">${escapeHtml(p.pressure?.raw || "—")}</dd>
          <dt class="col-6 text-secondary">Мощность</dt><dd class="col-6 mb-1">${p.power != null ? `${escapeHtml(p.power)} Вт` : "—"}</dd>
          <dt class="col-6 text-secondary">Шум</dt><dd class="col-6 mb-1">${p.noise_level != null ? `${escapeHtml(p.noise_level)} дБ` : "—"}</dd>
        </dl>
        <div class="d-flex justify-content-between align-items-center mt-auto">
          <span class="product-price">${escapeHtml(formatPrice(p.price))}</span>
          <button type="button" class="btn-compare-toggle ${selected ? "active" : ""}" data-id="${escapeHtml(p.id)}">
            + Сравнить
          </button>
        </div>
        <div class="product-card-actions mt-2 d-flex gap-2">
          <button type="button" class="btn btn-outline-dark btn-sm flex-grow-1 btn-project-toggle ${inProject ? "active" : ""}" data-id="${escapeHtml(
        p.id
      )}">
            В проект
          </button>
          <a class="btn btn-sm btn-dark flex-grow-1 product-open-btn" href="product.html?id=${encodeURIComponent(p.id)}">Открыть</a>
        </div>
      `;

      const detailsLink = body.querySelector("a");
      const projectToggleBtn = body.querySelector(".btn-project-toggle");
      const compareToggleBtn = body.querySelector(".btn-compare-toggle");
      detailsLink?.addEventListener("click", (event) => event.stopPropagation());
      projectToggleBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleProjectSelection(p.id);
      });
      compareToggleBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSelection(p.id);
      });

      card.appendChild(imgWrap);
      card.appendChild(body);
      col.appendChild(card);
      grid.appendChild(col);
    }

    syncSelectionUi();

    if (paginationNav) {
      const totalPages = Math.max(1, Math.ceil(total / limit));
      paginationNav.classList.toggle("d-none", total <= limit);
      pageIndicator.textContent = `Страница ${page} из ${totalPages}`;
      prevPageBtn.disabled = page <= 1;
      nextPageBtn.disabled = page >= totalPages;
    }
  }

  function renderAnalogs(analogs) {
    analogsList.innerHTML = "";
    for (const item of analogs) {
      const card = document.createElement("div");
      card.className = "analog-card";
      card.innerHTML = `
        <span class="analog-match">${escapeHtml(item.score)}% совпадение</span>
        <div class="analog-img"></div>
        <div class="analog-info">
          <div class="analog-model">${escapeHtml(item.model || "Без названия")}</div>
          <div class="analog-params">
            ${escapeHtml(item.type || "—")} · Расход: ${escapeHtml(item.airflow?.raw || "—")} · Давление: ${escapeHtml(item.pressure?.raw || "—")} ·
            Мощность: ${item.power != null ? `${escapeHtml(item.power)} Вт` : "—"} · ${escapeHtml(formatPrice(item.price))}
          </div>
        </div>
        <a class="btn btn-sm btn-dark" href="product.html?id=${encodeURIComponent(item.id)}">Подробнее</a>
      `;
      renderFanImage(card.querySelector(".analog-img"), item, item.model || "Аналог");
      analogsList.appendChild(card);
    }
  }

  function openCompare() {
    const products = getSelectedProducts();
    if (products.length < 2) {
      showError("Выберите минимум 2 модели для сравнения.");
      return;
    }
    window.location.href = "compare.html";
  }

  async function buildAnalogs() {
    const params = new URLSearchParams();
    params.set("limit", "60");
    params.set("offset", "0");
    params.set("sort", "price_asc");
    if (state.filters.type) params.set("type", state.filters.type);
    if (state.filters.diameter) params.set("diameter", state.filters.diameter);
    const data = await fetchJson(apiUrl(`/api/products?${params.toString()}`));
    const items = Array.isArray(data?.items) ? data.items : [];
    const targets = {
      airflow: ((toNumber(state.filters.minAirflow) || 0) + (toNumber(state.filters.maxAirflow) || 0)) / 2 || null,
      pressure: ((toNumber(state.filters.minPressure) || 0) + (toNumber(state.filters.maxPressure) || 0)) / 2 || null,
      power: ((toNumber(state.filters.minPower) || 0) + (toNumber(state.filters.maxPower) || 0)) / 2 || null,
      price: ((toNumber(state.filters.minPrice) || 0) + (toNumber(state.filters.maxPrice) || 0)) / 2 || null,
      diameter: ((toNumber(state.filters.minDiameter) || 0) + (toNumber(state.filters.maxDiameter) || 0)) / 2 || null,
    };
    return items
      .map((p) => ({ ...p, score: scoreAnalog(p, targets) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  async function loadPage(page) {
    hideError();
    setLoading(true);
    state.currentPage = page;
    state.filters = parseFilters(filtersForm);
    state.querySummaryText = describeQuery(state.filters);
    querySummary.textContent = state.querySummaryText;
    emptyQuerySummary.textContent = state.querySummaryText;

    try {
      const requestedSort = sortSelect?.value || "price_asc";
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(state.filters)) {
        if (k !== "sort") params.set(k, String(v));
      }
      params.set("sort", requestedSort.startsWith("price_") ? requestedSort : "price_asc");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));

      const data = await fetchJson(apiUrl(`/api/products?${params.toString()}`));
      const serverItems = Array.isArray(data?.items) ? data.items : [];
      const items = applyClientSort(serverItems, requestedSort);
      const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : items.length;
      const limit = Number.isFinite(Number(data?.limit)) ? Number(data.limit) : PAGE_SIZE;

      if (items.length === 0) {
        state.analogs = await buildAnalogs();
        renderAnalogs(state.analogs);
        showEmptyState();
        if (paginationNav) paginationNav.classList.add("d-none");
        resultsCount.textContent = "0";
      } else {
        showCatalogResults();
        renderProducts(items, { total, page, limit });
      }
    } catch (err) {
      console.error(err);
      showError("Не удалось загрузить каталог. Проверьте, что бэкенд запущен и API доступно.");
    } finally {
      setLoading(false);
    }
  }

  async function loadFacets() {
    const data = await fetchJson(apiUrl("/api/products/facets"));
    if (Array.isArray(data?.types)) {
      for (const t of data.types) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
      }
    }
    if (Array.isArray(data?.diameters)) {
      for (const d of data.diameters) {
        const opt = document.createElement("option");
        opt.value = String(d);
        opt.textContent = `${d} мм`;
        diameterSelect.appendChild(opt);
      }
    }
  }

  // Экспорт PDF перенесён на compare.html

  function validateRangeFilters() {
    const pairs = [
      ["minAirflow", "maxAirflow", "Расход"],
      ["minPressure", "maxPressure", "Давление"],
      ["minPower", "maxPower", "Мощность"],
      ["minPrice", "maxPrice", "Цена"],
    ];
    for (const [minId, maxId, label] of pairs) {
      const minVal = toNumber(filtersForm.elements[minId]?.value);
      const maxVal = toNumber(filtersForm.elements[maxId]?.value);
      if (minVal != null && maxVal != null && minVal > maxVal) {
        showError(`${label}: минимум (${minVal}) больше максимума (${maxVal}). Проверьте значения.`);
        return false;
      }
    }
    return true;
  }

  function closeFiltersOffcanvasIfMobile() {
    const el = document.getElementById("filtersOffcanvas");
    if (!el || typeof bootstrap === "undefined" || !bootstrap.Offcanvas) return;
    const instance = bootstrap.Offcanvas.getInstance(el);
    if (instance) instance.hide();
  }

  filtersForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateRangeFilters()) return;
    loadPage(1);
    closeFiltersOffcanvasIfMobile();
  });

  sortSelect.addEventListener("change", () => loadPage(1));

  resetBtn.addEventListener("click", () => {
    filtersForm.reset();
    state.selectedIds.clear();
    updateCompareBar();
    loadPage(1);
  });

  prevPageBtn.addEventListener("click", () => {
    if (state.currentPage > 1) loadPage(state.currentPage - 1);
  });

  nextPageBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.lastTotal / state.lastLimit));
    if (state.currentPage < totalPages) loadPage(state.currentPage + 1);
  });

  openCompareBtn.addEventListener("click", openCompare);
  clearCompareBtn.addEventListener("click", () => {
    state.selectedIds.clear();
    saveCompareIds(state.selectedIds);
    updateCompareBar();
    syncSelectionUi();
  });
  backToFiltersBtn.addEventListener("click", () => {
    showCatalogResults();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  // Экспорт и график сравнения теперь на compare.html

  headerSearchBtn?.addEventListener("click", () => {
    const qInput = $("#q");
    if (headerSearchInput && qInput) {
      qInput.value = String(headerSearchInput.value || "").trim();
    }
    loadPage(1);
  });

  headerSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      headerSearchBtn?.click();
    }
  });

  shareLinkBtn?.addEventListener("click", async () => {
    try {
      const data = await fetchJson(apiUrl("/api/share-links"));
      const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
      if (!urls.length) {
        showError("Не удалось сгенерировать ссылку для локальной сети.");
        return;
      }
      const first = urls[0];
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(first);
      }
      const text = `Ссылка скопирована в буфер обмена:\n${first}\n\nДополнительно:\n${urls.join("\n")}`;
      window.alert(text);
    } catch (err) {
      console.error(err);
      showError("Не удалось сгенерировать ссылку. Проверьте доступность API.");
    }
  });

  try {
    setLoading(true);
    await loadFacets();
    await loadPage(1);
    showCatalogResults();
    updateCompareBar();
    syncSelectionUi();
  } catch (err) {
    console.error(err);
    showError("Ошибка инициализации каталога.");
  } finally {
    setLoading(false);
  }
}

async function initComparePage() {
  const alertBox = $("#alertBox");
  const compareMeta = $("#compareMeta");
  const clearCompareBtn = $("#clearCompareBtn");
  const exportPdfBtn = $("#exportPdfBtn");
  const qpChartCanvas = $("#qpChart");
  const compareTableHead = $("#compareTableHead");
  const compareTableBody = $("#compareTableBody");

  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function hideError() {
    alertBox?.classList.add("d-none");
  }

  function renderCompareTable(products) {
    compareTableHead.innerHTML = "";
    compareTableBody.innerHTML = "";
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `<th style="width:200px;">Параметр</th>${products
      .map((p) => `<th>${escapeHtml(p.model || p.id)}</th>`)
      .join("")}`;
    compareTableHead.appendChild(headerRow);

    const rows = [
      { label: "Тип", pick: (p) => p.type || "—", best: "none" },
      { label: "Расход, м³/ч", pick: (p) => getRangeNominal(p.airflow), display: (p) => p.airflow?.raw || "—", best: "max" },
      { label: "Давление, Па", pick: (p) => getRangeNominal(p.pressure), display: (p) => p.pressure?.raw || "—", best: "max" },
      { label: "Мощность, Вт", pick: (p) => toNumber(p.power), display: (p) => (p.power != null ? `${p.power}` : "—"), best: "min" },
      { label: "Уровень шума, дБ", pick: (p) => toNumber(p.noise_level), display: (p) => (p.noise_level != null ? `${p.noise_level}` : "—"), best: "min" },
      { label: "Цена, ₽", pick: (p) => toNumber(p.price), display: (p) => formatPrice(p.price), best: "min" },
    ];

    for (const row of rows) {
      const values = products.map((p) => row.pick(p));
      const valid = values.filter((v) => v != null);
      let bestValue = null;
      if (row.best === "max" && valid.length) bestValue = Math.max(...valid);
      if (row.best === "min" && valid.length) bestValue = Math.min(...valid);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="param-name">${escapeHtml(row.label)}</td>${products
        .map((p, idx) => {
          const raw = values[idx];
          const isBest = bestValue != null && raw === bestValue;
          const text = row.display ? row.display(p) : raw ?? "—";
          return `<td class="${isBest ? "best" : ""}">${escapeHtml(text)}</td>`;
        })
        .join("")}`;
      compareTableBody.appendChild(tr);
    }
  }

  function renderCompareChart(products) {
    compareChart = renderQpChartShared(qpChartCanvas, compareChart, products);
  }

  async function exportCompareToPdf(products) {
    if (products.length < 2) {
      showError("Для экспорта выберите минимум 2 модели.");
      return;
    }
    hideError();
    try {
      const ids = products.map((p) => String(p.id)).filter(Boolean);
      const chartImageDataUrl = qpChartCanvas?.toDataURL?.("image/png", 1.0) || null;
      const response = await fetch(apiUrl("/api/export/pdf"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          filename: "ventmash-compare.pdf",
          chart_image_data_url: chartImageDataUrl,
        }),
      });
      if (!response.ok) {
        throw new Error(`PDF export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ventmash-compare.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showError("Не удалось экспортировать PDF. Проверьте доступность API.");
    }
  }

  try {
    hideError();
    const ids = loadCompareIds();
    if (ids.length < 2) {
      compareMeta.textContent = "Выберите минимум 2 модели в каталоге и вернитесь на страницу сравнения.";
      const backBtn = document.createElement("a");
      backBtn.href = "index.html";
      backBtn.className = "btn btn-dark btn-sm mt-2";
      backBtn.textContent = "← Вернуться в каталог";
      compareMeta.appendChild(document.createElement("br"));
      compareMeta.appendChild(backBtn);
      return;
    }
    compareMeta.textContent = `Выбрано моделей: ${ids.length}`;
    const products = await fetchProductsByIds(ids);
    renderCompareTable(products);
    renderCompareChart(products);

    clearCompareBtn?.addEventListener("click", () => {
      saveCompareIds([]);
      window.location.reload();
    });

    exportPdfBtn?.addEventListener("click", () => {
      exportCompareToPdf(products);
    });
  } catch (err) {
    console.error(err);
    showError("Не удалось загрузить сравнение. Проверьте доступность API.");
  }
}

async function initProductPage() {
  const alertBox = $("#alertBox");
  const loading = $("#loading");
  const container = $("#productContainer");
  const chartCanvas = $("#productQpChart");
  const compareWithSelect = $("#compareWithSelect");
  const compareOnProductBtn = $("#compareOnProductBtn");
  const productCompareMeta = $("#productCompareMeta");
  let currentProduct = null;

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function setLoading(isLoading) {
    loading.style.display = isLoading ? "block" : "none";
  }

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    setLoading(false);
    showError("Не передан идентификатор вентилятора в URL.");
    const backBtn = document.createElement("a");
    backBtn.href = "index.html";
    backBtn.className = "btn btn-dark btn-sm mt-2";
    backBtn.textContent = "← Вернуться в каталог";
    alertBox.appendChild(document.createElement("br"));
    alertBox.appendChild(backBtn);
    return;
  }

  try {
    setLoading(true);
    const data = await fetchJson(apiUrl(`/api/products/${encodeURIComponent(id)}`));
    currentProduct = data;
    const crumbLabel = $("#productBreadCrumbLabel");
    if (crumbLabel) crumbLabel.textContent = data.model || "Карточка модели";
    $("#productTitle").textContent = data.model || "Без названия";
    $("#productSubtitle").textContent = [data.type, data.size].filter(Boolean).join(" • ");
    $("#productPrice").textContent = formatPrice(data.price);
    renderFanImage($("#productImage"), data, data.model || "Вентилятор", false);

    const specBody = $("#specTableBody");
    specBody.innerHTML = "";
    const specs = [
      ["ID", data.id],
      ["Номер в CSV", data.number],
      ["Тип", data.type],
      ["Модель", data.model],
      ["Типоразмер", data.size],
      ["Диаметр", data.diameter != null ? `${data.diameter} мм` : "—"],
      ["Расход воздуха", data.airflow?.raw || "—"],
      ["Давление", data.pressure?.raw || "—"],
      ["Мощность", data.power != null ? `${data.power} Вт` : "—"],
      ["Уровень шума", data.noise_level != null ? `${data.noise_level} дБ` : "—"],
      ["Цена", formatPrice(data.price)],
    ];
    for (const [label, value] of specs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row" class="w-50 text-secondary">${escapeHtml(label)}</th><td>${escapeHtml(value ?? "—")}</td>`;
    }
    productChart = renderQpChartShared(chartCanvas, productChart, [data]);
    productCompareMeta.textContent = `Сейчас показана характеристика модели ${data.model || data.id}.`;

    const listData = await fetchJson(
      apiUrl(`/api/products?type=${encodeURIComponent(data.type || "")}&limit=100&offset=0&sort=price_asc`),
    );
    const options = (Array.isArray(listData?.items) ? listData.items : []).filter((x) => x.id !== data.id);
    for (const item of options) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.model || item.id} · ${formatPrice(item.price)}`;
      compareWithSelect.appendChild(opt);
    }

    compareOnProductBtn?.addEventListener("click", async () => {
      const otherId = compareWithSelect.value;
      if (!otherId) {
        productChart = renderQpChartShared(chartCanvas, productChart, [currentProduct]);
        productCompareMeta.textContent = "Выберите вторую модель для сравнения.";
        return;
      }
      const second = await fetchJson(apiUrl(`/api/products/${encodeURIComponent(otherId)}`));
      productChart = renderQpChartShared(chartCanvas, productChart, [currentProduct, second]);
      productCompareMeta.textContent = `Сравнение: ${currentProduct.model || currentProduct.id} vs ${second.model || second.id}`;
    });

    container.classList.remove("d-none");
    alertBox.classList.add("d-none");
  } catch (err) {
    console.error(err);
    showError("Не удалось загрузить данные вентилятора. Возможно, он не найден.");
  } finally {
    setLoading(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "catalog") initCatalogPage();
  if (page === "product") initProductPage();
  if (page === "compare") initComparePage();
});
