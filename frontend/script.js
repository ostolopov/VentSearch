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
const PROFILE_STORAGE_KEY = "ventsearch.user.profile";
const PROJECT_META_STORAGE_KEY = "ventsearch.project.meta";
const VENTSEARCH_TEAM_EMAIL = "ventsearch.team@gmail.com";

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
  updateCompareNavBadge();
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
  updateProjectNavBadge();
}

function loadUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveUserProfile(profile) {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

function loadProjectMeta() {
  try {
    const raw = localStorage.getItem(PROJECT_META_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveProjectMeta(meta) {
  try {
    localStorage.setItem(PROJECT_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

function getProjectIdSet() {
  return new Set(loadProjectIds());
}

function isInProject(id) {
  return getProjectIdSet().has(String(id));
}

function toggleProjectId(id) {
  const key = String(id);
  if (!key) return false;
  const ids = getProjectIdSet();
  const added = !ids.has(key);
  if (added) ids.add(key);
  else ids.delete(key);
  saveProjectIds(ids);
  return added;
}

function updateProjectNavBadge() {
  const badge = document.getElementById("navProjectBadge");
  if (!badge) return;
  const count = loadProjectIds().length;
  badge.textContent = String(count);
  badge.classList.toggle("d-none", count === 0);
}

function updateCompareNavBadge() {
  const badge = document.getElementById("navCompareBadge");
  if (!badge) return;
  const count = loadCompareIds().length;
  badge.textContent = String(count);
  badge.classList.toggle("d-none", count === 0);
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

// Параметры α по типу — синхронизированы с backend/qp_model.py
const ALPHA_BY_TYPE = {
  "ВО": 0.18, "ВКОП": 0.15, "УВО": 0.18,
  "ВЦ": 0.05, "ВР": 0.05, "Ц": 0.05,
};
const ALPHA_DEFAULT = 0.10;

function alphaForType(t) {
  if (!t) return ALPHA_DEFAULT;
  return ALPHA_BY_TYPE[String(t).trim()] ?? ALPHA_DEFAULT;
}

function buildQpDatasetsShared(products, targetRpm = null, targetPoint = null) {
  const colors = ["#246bb3", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#16a085"];
  const series = [];

  products.forEach((p, idx) => {
    let qMin = toNumber(p.airflow?.min) ?? 0;
    let qMax = toNumber(p.airflow?.max) ?? 0;
    let pMin = toNumber(p.pressure?.min) ?? 0;
    let pMax = toNumber(p.pressure?.max) ?? 0;
    
    let scaleFactor = 1.0;
    if (targetRpm && p.nominal_rpm) {
      scaleFactor = targetRpm / p.nominal_rpm;
    }
    
    const alpha = alphaForType(p.type);
    const qCtrl = qMin + 0.5 * (qMax - qMin);
    const pCtrl = Math.max(pMin, pMax) + alpha * (Math.max(pMin, pMax) - Math.min(pMin, pMax));
    const pStart = Math.max(pMin, pMax);
    const pEnd = Math.min(pMin, pMax);
    
    const coeffs = p.pressure_coefficients;
    
    const steps = 200;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      let qNom, pNom;
      
      if (coeffs && Array.isArray(coeffs) && coeffs.length > 0) {
        qNom = qMin + (qMax - qMin) * t;
        pNom = coeffs.reduce((acc, c, idx) => acc + c * Math.pow(qNom, idx), 0);
      } else {
        const omt = 1 - t;
        qNom = omt * omt * qMin + 2 * t * omt * qCtrl + t * t * qMax;
        pNom = omt * omt * pStart + 2 * t * omt * pCtrl + t * t * pEnd;
      }
      
      const qScaled = qNom * scaleFactor;
      const pScaled = Math.max(pNom * (scaleFactor * scaleFactor), 0);
      points.push([qScaled, pScaled]);
    }
    
    series.push({
      name: p.model || p.id,
      type: 'line',
      // Точки уже лежат на квадратичной Безье (200 шт.) — дополнительное
      // сглаживание ECharts даёт «сплайн сплайна» и артефакты (QP_MODEL, п. 5.2)
      smooth: false,
      symbol: 'none',
      data: points,
      lineStyle: { width: 3, color: colors[idx % colors.length] },
      itemStyle: { color: colors[idx % colors.length] }
    });
  });

  if (targetPoint && targetPoint.q > 0 && targetPoint.p > 0) {
    const k = targetPoint.p / Math.pow(targetPoint.q, 2);
    const maxQ = Math.max(...series.map(s => s.data[s.data.length - 1][0]), targetPoint.q * 1.5);
    const systemPoints = [];
    for (let i = 0; i <= 100; i++) {
      const q = (maxQ * i) / 100;
      systemPoints.push([q, k * Math.pow(q, 2)]);
    }

    series.push({
      name: 'Кривая сети',
      type: 'line',
      smooth: false,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: '#7f7f7f', width: 2 },
      itemStyle: { color: '#7f7f7f' },
      data: systemPoints
    });

    series.push({
      name: 'Рабочая точка',
      type: 'scatter',
      symbolSize: 12,
      itemStyle: { color: '#d62728' },
      data: [[targetPoint.q, targetPoint.p]],
      label: { show: true, formatter: 'Рабочая точка', position: 'top', color: '#d62728', fontWeight: 'bold' },
      zlevel: 10
    });
  }

  return series;
}

function renderQpChartShared(container, chartRef, products, targetRpm = null, targetPoint = null) {
  if (!container || typeof echarts === "undefined") return chartRef;

  let isNewChart = false;
  if (!chartRef) {
    chartRef = echarts.init(container);
    isNewChart = true;
  } else {
    chartRef.clear();
  }

  const qpChartFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 },
      valueFormatter: (value) => formatNumber(value)
    },
    legend: {
      bottom: 0,
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 }
    },
    toolbox: {
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: 'Лупа', back: 'Сброс лупы' } },
        saveAsImage: { title: 'Скачать PNG', name: 'ventsearch-chart' }
      },
      right: 20,
      top: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '12%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      name: 'Расход воздуха (Q), м³/ч',
      nameLocation: 'middle',
      nameGap: 30,
      type: 'value',
      splitLine: { show: true, lineStyle: { type: 'dashed', color: '#eee' } },
      minorSplitLine: { show: true, lineStyle: { color: '#f5f5f5' } },
      axisLabel: { fontFamily: qpChartFontFamily, formatter: (val) => formatNumber(val) },
      nameTextStyle: { fontFamily: qpChartFontFamily, fontWeight: '600', fontSize: 13 }
    },
    yAxis: {
      name: 'Давление (P), Па',
      nameLocation: 'end',
      type: 'value',
      splitLine: { show: true, lineStyle: { color: '#e0e0e0' } },
      minorSplitLine: { show: true, lineStyle: { color: '#f5f5f5' } },
      axisLabel: { fontFamily: qpChartFontFamily, formatter: (val) => formatNumber(val) },
      nameTextStyle: { fontFamily: qpChartFontFamily, fontWeight: '600', fontSize: 13 }
    },
    series: buildQpDatasetsShared(products, targetRpm, targetPoint)
  };

  chartRef.setOption(option);

  // Подписываемся один раз при создании графика: повторные перерисовки
  // (слайдер оборотов, добавление модели в сравнение) не должны копить обработчики
  if (isNewChart) {
    const chart = chartRef;
    window.addEventListener('resize', () => {
      chart.resize();
    });
  }

  return chartRef;
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
  if (!form) return {};
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

  function setLoadingSafe(isLoading) {
    if (loading) loading.style.display = isLoading ? "block" : "none";
  }

  function showErrorSafe(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }
  const headerSearchInput = $("#headerSearchInput");
  const headerSearchBtn = $("#headerSearchBtn");
  const resultsCount = $("#resultsCount");
  const querySummary = $("#querySummary");
  const filtersForm = $("#filtersForm");
  const resetBtn = $("#resetBtn");
  const paginationNav = $("#paginationNav");
  const prevPageBtn = $("#prevPageBtn");
  const nextPageBtn = $("#nextPageBtn");
  const pageIndicator = $("#pageIndicator");
  const sortSelect = $("#sort");
  const typeSelect = $("#type");
  const diameterSelect = $("#diameter");
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
    showErrorSafe(message);
  }

  function hideError() {
    alertBox?.classList.add("d-none");
  }

  function setLoading(isLoading) {
    setLoadingSafe(isLoading);
  }

  function showCatalogResults() {
    emptySection?.classList.add("d-none");
  }

  function showEmptyState() {
    if (grid) grid.innerHTML = "";
    if (loading) loading.style.display = "none";
    state.currentItems = [];
    if (paginationNav) paginationNav.classList.add("d-none");
    emptySection?.classList.remove("d-none");
  }

  function getSelectedProducts() {
    return [...state.selectedIds].map((id) => state.cacheById.get(id)).filter(Boolean);
  }

  function syncSelectionUi() {
    if (!grid) return;
    const toggleButtons = grid.querySelectorAll(".btn-compare-toggle");
    for (const button of toggleButtons) {
      const id = String(button.dataset.id || "");
      const selected = state.selectedIds.has(id);
      button.classList.toggle("btn-dark", selected);
      button.classList.toggle("btn-outline-dark", !selected);
      button.textContent = selected ? "В сравнении" : "Сравнить";
      button.title = selected ? "Уже добавлен в сравнение" : "Добавить в сравнение";
      const card = button.closest(".product-card");
      if (card) card.classList.toggle("selected", selected);
    }
    const projectButtons = grid.querySelectorAll(".btn-project-toggle");
    for (const button of projectButtons) {
      const id = String(button.dataset.id || "");
      const inProject = state.projectIds.has(id);
      button.classList.toggle("btn-dark", inProject);
      button.classList.toggle("btn-outline-dark", !inProject);
      button.textContent = inProject ? "В проекте" : "Добавить в проект";
      button.title = inProject ? "Убрать из проекта" : "Добавить в проект";
      const card = button.closest(".product-card");
      if (card) card.classList.toggle("in-project", inProject);
    }
  }

  function toggleProjectSelection(id) {
    const added = toggleProjectId(id);
    state.projectIds = getProjectIdSet();
    hideError();
    syncSelectionUi();
  }

  function toggleSelection(id) {
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
      if (state.selectedIds.size >= 2) {
        showCompareToast();
      }
    }
    saveCompareIds(state.selectedIds);
    hideError();
    syncSelectionUi();
  }

  function showCompareToast() {
    let toastEl = document.getElementById('compareToast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'compareToast';
      toastEl.className = 'toast align-items-center text-bg-primary border-0 position-fixed bottom-0 end-0 m-3';
      toastEl.setAttribute('role', 'alert');
      toastEl.setAttribute('aria-live', 'assertive');
      toastEl.setAttribute('aria-atomic', 'true');
      toastEl.style.zIndex = '1060';
      toastEl.innerHTML = `
        <div class="d-flex">
          <div class="toast-body">
            Добавлено 2 или более моделей. <a href="compare.html" class="text-white fw-bold text-decoration-underline">Перейти к сравнению?</a>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      `;
      document.body.appendChild(toastEl);
    }
    if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
      const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
      toast.show();
    }
  }

  function renderProducts(products, meta) {
    if (!grid) return;
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
    if (resultsCount) resultsCount.textContent = total > 0 ? `${from}-${to} из ${formatNumber(total)}` : "0";
    if (querySummary) querySummary.textContent = state.querySummaryText;

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
          <dt class="col-6 text-secondary">Мощн.</dt><dd class="col-6 mb-1">${p.power != null ? `${escapeHtml(p.power)} Вт` : "—"}</dd>
          <dt class="col-6 text-secondary">Шум</dt><dd class="col-6 mb-1">${p.noise_level != null ? `${escapeHtml(p.noise_level)} дБ` : "—"}</dd>
        </dl>
        <div class="mt-auto">
          <div class="product-price">${escapeHtml(formatPrice(p.price))}</div>
          <a class="btn btn-sm btn-dark product-open-btn mt-2" href="product.html?id=${encodeURIComponent(p.id)}">Открыть</a>
        </div>
        <div class="product-card-actions mt-2 d-flex gap-2">
          <button type="button" class="btn btn-sm flex-grow-1 btn-project-toggle ${inProject ? "btn-dark" : "btn-outline-dark"}" data-id="${escapeHtml(
        p.id
      )}" title="${inProject ? "Убрать из проекта" : "Добавить в проект"}">
            ${inProject ? "В проекте" : "Добавить в проект"}
          </button>
          <button type="button" class="btn btn-sm btn-compare-toggle flex-grow-1 ${selected ? "btn-dark" : "btn-outline-dark"}" data-id="${escapeHtml(p.id)}">
            ${selected ? "В сравнении" : "Сравнить"}
          </button>
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
      if (pageIndicator) pageIndicator.textContent = `Страница ${page} из ${totalPages}`;
      if (prevPageBtn) prevPageBtn.disabled = page <= 1;
      if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;
    }
  }

  function renderAnalogs(analogs) {
    if (!analogsList) return;
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
    if (querySummary) querySummary.textContent = state.querySummaryText;

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
        showEmptyState();
        if (resultsCount) resultsCount.textContent = "0";
        state.analogs = await buildAnalogs();
        renderAnalogs(state.analogs);
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
    if (Array.isArray(data?.types) && typeSelect) {
      for (const t of data.types) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
      }
    }
    if (Array.isArray(data?.diameters) && diameterSelect) {
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

  filtersForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateRangeFilters()) return;
    loadPage(1);
    closeFiltersOffcanvasIfMobile();
  });

  sortSelect?.addEventListener("change", () => loadPage(1));

  resetBtn?.addEventListener("click", () => {
    filtersForm?.reset();
    state.selectedIds.clear();
    saveCompareIds(state.selectedIds);
    loadPage(1);
  });

  prevPageBtn?.addEventListener("click", () => {
    if (state.currentPage > 1) loadPage(state.currentPage - 1);
  });

  nextPageBtn?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.lastTotal / state.lastLimit));
    if (state.currentPage < totalPages) loadPage(state.currentPage + 1);
  });

  backToFiltersBtn?.addEventListener("click", () => {
    emptySection?.classList.add("d-none");
    const filtersEl = document.getElementById("filtersOffcanvas");
    if (filtersEl && typeof bootstrap !== "undefined" && bootstrap.Offcanvas) {
      const instance = bootstrap.Offcanvas.getOrCreateInstance(filtersEl);
      instance.show();
    }
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

  const urlQ = new URLSearchParams(window.location.search).get("q");
  if (urlQ) {
    const trimmed = String(urlQ).trim();
    if (filtersForm?.elements.q) filtersForm.elements.q.value = trimmed;
    if (headerSearchInput) headerSearchInput.value = trimmed;
  }

  try {
    setLoading(true);
    await loadFacets();
    await loadPage(1);
    syncSelectionUi();
    updateProjectNavBadge();
    updateCompareNavBadge();
  } catch (err) {
    console.error(err);
    showErrorSafe(err.message || "Ошибка инициализации каталога. Проверьте, что API запущен.");
  } finally {
    setLoadingSafe(false);
  }
}

async function initComparePage() {
  updateProjectNavBadge();
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
      .map((p) => `<th>
        <div class="d-flex justify-content-between align-items-center">
          <span>${escapeHtml(p.model || p.id)}</span>
          <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-2 btn-remove-compare" data-id="${escapeHtml(p.id)}" title="Удалить из сравнения">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
            </svg>
          </button>
        </div>
      </th>`)
      .join("")}`;
    compareTableHead.appendChild(headerRow);

    headerRow.querySelectorAll(".btn-remove-compare").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const ids = new Set(loadCompareIds());
        ids.delete(id);
        saveCompareIds(ids);
        window.location.reload();
      });
    });

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
      const chartImageDataUrl = compareChart ? compareChart.getDataURL({ type: 'png', backgroundColor: '#fff', pixelRatio: 2 }) : null;
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
    updateCompareNavBadge();
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

function syncProductProjectButton(button, productId) {
  if (!button) return;
  const inProject = isInProject(productId);
  button.classList.toggle("btn-dark", !inProject);
  button.classList.toggle("btn-dark", inProject);
  button.textContent = inProject ? "В проекте" : "В проект";
  button.title = inProject ? "Перейти в личный кабинет" : "Сохранить модель в проект";
}

async function initProductPage() {
  const alertBox = $("#alertBox");
  const loading = $("#loading");
  const container = $("#productContainer");
  const chartCanvas = $("#productQpChart");
  const compareWithSelect = $("#compareWithSelect");
  const compareOnProductBtn = $("#compareOnProductBtn");
  const productCompareMeta = $("#productCompareMeta");
  const addToProjectBtn = $("#addToProjectBtn");
  let currentProduct = null;
  updateProjectNavBadge();

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
      specBody.appendChild(tr);
    }
    
    container.classList.remove("d-none");
    alertBox.classList.add("d-none");

    
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

    syncProductProjectButton(addToProjectBtn, data.id);
    addToProjectBtn?.addEventListener("click", () => {
      if (isInProject(data.id)) {
        window.location.href = "project.html";
        return;
      }
      toggleProjectId(data.id);
      syncProductProjectButton(addToProjectBtn, data.id);
    });

    
    
  } catch (err) {
    console.error(err);
    showError("Не удалось загрузить данные вентилятора. Возможно, он не найден.");
  } finally {
    setLoading(false);
  }
}

function buildProjectQuoteBody(products, profile, meta) {
  const lines = [
    "Запрос коммерческого предложения — VENTSEARCH",
    "",
    `Проект: ${meta.title || "Без названия"}`,
    meta.notes ? `Комментарий: ${meta.notes}` : "",
    "",
    "Контакты:",
    profile.company ? `Компания: ${profile.company}` : "",
    profile.name ? `ФИО: ${profile.name}` : "",
    profile.email ? `E-mail: ${profile.email}` : "",
    profile.phone ? `Телефон: ${profile.phone}` : "",
    "",
    "Состав проекта:",
  ].filter((line) => line !== undefined);
  for (const p of products) {
    lines.push(
      `- ${p.model || p.id} (${p.type || "—"}): расход ${p.airflow?.raw || "—"}, давление ${p.pressure?.raw || "—"}, цена ${formatPrice(p.price)}`,
    );
  }
  return lines.join("\n");
}

async function exportProjectPdf(products) {
  if (!products.length) {
    throw new Error("empty");
  }
  const ids = products.map((p) => String(p.id)).filter(Boolean);
  const response = await fetch(apiUrl("/api/export/pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids,
      filename: "ventsearch-project.pdf",
    }),
  });
  if (!response.ok) {
    throw new Error(`PDF export failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ventsearch-project.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function initProjectPage() {
  if (window.VentSiteAuth) {
    await window.VentSiteAuth.refreshSession();
  }
  const alertBox = $("#alertBox");
  const successBox = $("#successBox");
  const projectMeta = $("#projectMeta");
  const projectLoading = $("#projectLoading");
  const projectEmpty = $("#projectEmpty");
  const projectTableWrap = $("#projectTableWrap");
  const projectTableBody = $("#projectTableBody");
  const projectTotalPrice = $("#projectTotalPrice");
  const profileForm = $("#profileForm");
  const projectTitle = $("#projectTitle");
  const projectNotes = $("#projectNotes");
  const exportProjectPdfBtn = $("#exportProjectPdfBtn");
  const requestQuoteBtn = $("#requestQuoteBtn");
  const clearProjectBtn = $("#clearProjectBtn");

  let currentProducts = [];

  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
    successBox?.classList.add("d-none");
  }

  function showSuccess(message) {
    if (!successBox) return;
    successBox.textContent = message;
    successBox.classList.remove("d-none");
    alertBox?.classList.add("d-none");
  }

  function hideMessages() {
    alertBox?.classList.add("d-none");
    successBox?.classList.add("d-none");
  }

  function fillProfileForm(profile) {
    $("#profileCompany").value = profile.company || "";
    $("#profileName").value = profile.name || "";
    $("#profileEmail").value = profile.email || "";
    $("#profilePhone").value = profile.phone || "";
  }

  function readProfileForm() {
    return {
      company: String($("#profileCompany")?.value || "").trim(),
      name: String($("#profileName")?.value || "").trim(),
      email: String($("#profileEmail")?.value || "").trim(),
      phone: String($("#profilePhone")?.value || "").trim(),
    };
  }

  function readProjectMetaForm() {
    return {
      title: String(projectTitle?.value || "").trim(),
      notes: String(projectNotes?.value || "").trim(),
    };
  }

  function persistProjectMeta() {
    saveProjectMeta(readProjectMetaForm());
  }

  function renderProjectTable(products) {
    currentProducts = products;
    projectTableBody.innerHTML = "";
    let total = 0;
    let pricedCount = 0;

    for (const p of products) {
      const price = toNumber(p.price);
      if (price != null) {
        total += price;
        pricedCount += 1;
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <a href="product.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.model || p.id)}</a>
          <div class="small text-secondary">${escapeHtml(p.size || "")}</div>
        </td>
        <td>${escapeHtml(p.type || "—")}</td>
        <td>${escapeHtml(p.airflow?.raw || "—")}</td>
        <td>${escapeHtml(p.pressure?.raw || "—")}</td>
        <td>${escapeHtml(formatPrice(p.price))}</td>
        <td class="text-end">
          <button type="button" class="btn btn-outline-dark btn-sm btn-remove-project-item" data-id="${escapeHtml(p.id)}">
            Удалить
          </button>
        </td>
      `;
      projectTableBody.appendChild(tr);
    }

    if (pricedCount > 0) {
      projectTotalPrice.textContent = formatPrice(total);
    } else {
      projectTotalPrice.textContent = "по запросу";
    }

    projectTableBody.querySelectorAll(".btn-remove-project-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleProjectId(btn.dataset.id);
        void reloadProject();
      });
    });
  }

  async function reloadProject() {
    hideMessages();
    const ids = loadProjectIds();
    updateProjectNavBadge();
    projectMeta.textContent =
      ids.length > 0 ? `В проекте ${ids.length} ${ids.length === 1 ? "модель" : ids.length < 5 ? "модели" : "моделей"}` : "Добавьте модели из каталога";

    if (!ids.length) {
      projectLoading.classList.add("d-none");
      projectEmpty.classList.remove("d-none");
      projectTableWrap.classList.add("d-none");
      exportProjectPdfBtn.disabled = true;
      requestQuoteBtn.disabled = true;
      currentProducts = [];
      return;
    }

    projectLoading.classList.remove("d-none");
    projectEmpty.classList.add("d-none");
    projectTableWrap.classList.add("d-none");
    exportProjectPdfBtn.disabled = true;
    requestQuoteBtn.disabled = true;

    try {
      const products = await fetchProductsByIds(ids);
      const order = new Map(ids.map((id, index) => [String(id), index]));
      products.sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
      renderProjectTable(products);
      projectLoading.classList.add("d-none");
      projectTableWrap.classList.remove("d-none");
      exportProjectPdfBtn.disabled = false;
      requestQuoteBtn.disabled = false;
    } catch (err) {
      console.error(err);
      projectLoading.classList.add("d-none");
      showError("Не удалось загрузить модели проекта. Проверьте доступность API.");
    }
  }

  const savedProfile = loadUserProfile();
  const savedMeta = loadProjectMeta();
  fillProfileForm(savedProfile);
  if (projectTitle) projectTitle.value = savedMeta.title || "";
  if (projectNotes) projectNotes.value = savedMeta.notes || "";

  profileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveUserProfile(readProfileForm());
    showSuccess("Контактные данные сохранены в этом браузере.");
  });

  projectTitle?.addEventListener("change", persistProjectMeta);
  projectNotes?.addEventListener("change", persistProjectMeta);
  projectTitle?.addEventListener("blur", persistProjectMeta);
  projectNotes?.addEventListener("blur", persistProjectMeta);

  exportProjectPdfBtn?.addEventListener("click", async () => {
    hideMessages();
    try {
      await exportProjectPdf(currentProducts);
      showSuccess("PDF-файл сформирован и загружен.");
    } catch (err) {
      console.error(err);
      showError("Не удалось экспортировать PDF. Проверьте доступность API.");
    }
  });

  requestQuoteBtn?.addEventListener("click", async () => {
    hideMessages();
    saveUserProfile(readProfileForm());
    persistProjectMeta();
    if (!currentProducts.length) {
      showError("Добавьте хотя бы одну модель в проект.");
      return;
    }
    const profile = readProfileForm();
    if (!profile.email && !profile.phone) {
      showError("Укажите e-mail или телефон в профиле, чтобы менеджер мог связаться с вами.");
      return;
    }
    const body = buildProjectQuoteBody(currentProducts, profile, readProjectMetaForm());
    const subject = encodeURIComponent(`Запрос цены — ${readProjectMetaForm().title || "VENTSEARCH"}`);
    const mailto = `mailto:${VENTSEARCH_TEAM_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  });

  clearProjectBtn?.addEventListener("click", () => {
    if (!loadProjectIds().length) return;
    if (!window.confirm("Очистить проект и удалить все сохранённые модели?")) return;
    saveProjectIds(new Set());
    void reloadProject();
    showSuccess("Проект очищен.");
  });

  updateProjectNavBadge();
  await reloadProject();
}

document.addEventListener("DOMContentLoaded", () => {
  updateProjectNavBadge();
  updateCompareNavBadge();

  const cookieBanner = document.getElementById("cookieConsentBanner");
  const acceptCookiesBtn = document.getElementById("acceptCookiesBtn");
  if (cookieBanner && acceptCookiesBtn) {
    if (!localStorage.getItem("ventsearch.cookies.accepted")) {
      cookieBanner.classList.remove("d-none");
    }
    acceptCookiesBtn.addEventListener("click", () => {
      localStorage.setItem("ventsearch.cookies.accepted", "true");
      cookieBanner.classList.add("d-none");
    });
  }

  const page = document.body.dataset.page;
  if (page === "catalog") {
    initCatalogPage().catch((err) => {
      console.error(err);
      const loading = document.getElementById("loading");
      if (loading) loading.style.display = "none";
      const alertBox = document.getElementById("alertBox");
      if (alertBox) {
        alertBox.textContent = err.message || "Ошибка загрузки каталога";
        alertBox.classList.remove("d-none");
      }
    });
  }
  if (page === "product") initProductPage();
  if (page === "compare") initComparePage();
  if (page === "project") initProjectPage();
});
