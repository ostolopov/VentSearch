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
  ОСЕВОЙ: "vo.jpeg",
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

const POINT_STORAGE_KEY = "ventsearch.point";

function loadWorkingPoint() {
  try {
    const raw = localStorage.getItem(POINT_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && Number(data.q) > 0 && Number(data.p) > 0) {
      const point = { q: Number(data.q), p: Number(data.p) };
      if (Number(data.tol) > 0) point.tol = Number(data.tol);
      return point;
    }
    return null;
  } catch {
    return null;
  }
}

function saveWorkingPoint(point) {
  try {
    if (point && Number(point.q) > 0 && Number(point.p) > 0) {
      const data = { q: Number(point.q), p: Number(point.p) };
      if (Number(point.tol) > 0) data.tol = Number(point.tol);
      localStorage.setItem(POINT_STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(POINT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

const TILE_SIZE_KEY = "ventsearch.tileSize";
const TILE_SIZE_COLS = {
  lg: "col-12 col-md-6 col-xl-6",
  md: "col-6 col-md-6 col-xl-4",
  sm: "col-6 col-md-4 col-xl-3",
};

function loadTileSize() {
  try {
    const v = localStorage.getItem(TILE_SIZE_KEY);
    return v && TILE_SIZE_COLS[v] ? v : "md";
  } catch {
    return "md";
  }
}

function saveTileSize(size) {
  try {
    localStorage.setItem(TILE_SIZE_KEY, size);
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

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
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
  "ВО": 0.18, "ВКОП": 0.15, "УВО": 0.18, "Осевой": 0.18,
  "ВЦ": 0.05, "ВР": 0.05, "Ц": 0.05,
};
const ALPHA_DEFAULT = 0.10;

// Осевые: кривая с седловиной (провал → горб), синхронизировано с qp_service.py
const AXIAL_TYPES = new Set(["во", "вкоп", "уво", "осевой"]);
const AXIAL_DIP_POS = 0.25;
const AXIAL_DIP = 0.45;
const AXIAL_HUMP_POS = 0.60;
const AXIAL_HUMP = 0.50;

function alphaForType(t) {
  if (!t) return ALPHA_DEFAULT;
  return ALPHA_BY_TYPE[String(t).trim()] ?? ALPHA_DEFAULT;
}

function isAxialType(t) {
  if (!t) return false;
  return AXIAL_TYPES.has(String(t).trim().toLowerCase());
}

// Служебные серии (зона допуска, курсорные линии к точке) — не попадают
// в легенду и подсказку графика.
function isServiceSeriesName(name) {
  return typeof name === "string" && (name.startsWith("tol-") || name.startsWith("guide-"));
}

// familyKey: модель без типоразмера в хвосте — «ВО 13-284-4/15°-456A4» → «ВО 13-284-4/15°».
// Один и тот же расчёт, что и в backend/application/use_cases/list_product_families.py.
function familyKey(product) {
  const model = String(product?.model || "").trim();
  const size = String(product?.size || "").trim();
  if (model && size && model.toLowerCase().endsWith(`-${size.toLowerCase()}`)) {
    return model.slice(0, model.length - size.length - 1).trim();
  }
  return model;
}

// Стабильный (по строке) псевдослучайный хэш — 32-бит FNV-1a.
function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Геометрически подобные вентиляторы одной схемы (тот же шаг лопастей и угол,
// только масштаб) по законам подобия дают идеально самоподобную кривую —
// в ряду из 20 типоразмеров это выглядит как один «волосок», отмасштабированный
// много раз. Добавляем небольшую, но стабильную по id вариацию формы седловины
// для соседних (не выделенных) кривых ряда — только визуальный контекст,
// расчёт запаса по выделенной модели эта вариация не затрагивает.
function jitterAxialShape(id) {
  const seed = hashSeed(id);
  const r1 = ((seed % 1000) / 1000) * 2 - 1;
  const r2 = (((seed >>> 8) % 1000) / 1000) * 2 - 1;
  const r3 = (((seed >>> 16) % 1000) / 1000) * 2 - 1;
  return {
    dipPos: AXIAL_DIP_POS + r1 * 0.06,
    humpPos: AXIAL_HUMP_POS + r2 * 0.07,
    dip: Math.max(0.18, AXIAL_DIP + r3 * 0.18),
    hump: Math.max(0.18, AXIAL_HUMP - r1 * 0.15),
  };
}

// opts.primaryId — если задан среди 2+ моделей, остальные рисуются тонкими
// серыми (контекст модельного ряда), а выбранная модель — толстой цветной.
function buildQpDatasetsShared(products, targetRpm = null, targetPoint = null, opts = {}) {
  const { primaryId = null } = opts;
  const colors = ["#246bb3", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12", "#16a085"];
  const familyMode = primaryId != null && products.length > 1;
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

    const pStart = Math.max(pMin, pMax);
    const pEnd = Math.min(pMin, pMax);
    const dQ = qMax - qMin;
    const dP = pStart - pEnd;

    const alpha = alphaForType(p.type);
    const qCtrl = qMin + 0.5 * dQ;
    const pCtrl = pStart + alpha * dP;

    const isPrimary = familyMode ? String(p.id) === String(primaryId) : true;

    // Кубическая Безье с седловиной для осевых (как в бумажных каталогах ВО).
    // У контекстных кривых ряда — слегка вариативная форма (см. jitterAxialShape).
    const axial = isAxialType(p.type);
    const shape = familyMode && !isPrimary && axial
      ? jitterAxialShape(p.id)
      : { dipPos: AXIAL_DIP_POS, humpPos: AXIAL_HUMP_POS, dip: AXIAL_DIP, hump: AXIAL_HUMP };
    const qC1 = qMin + shape.dipPos * dQ;
    const pC1 = pStart - shape.dip * dP;
    const qC2 = qMin + shape.humpPos * dQ;
    const pC2 = pStart + shape.hump * dP;

    const coeffs = p.pressure_coefficients;

    const steps = 200;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      let qNom, pNom;

      if (coeffs && Array.isArray(coeffs) && coeffs.length > 0) {
        qNom = qMin + (qMax - qMin) * t;
        pNom = coeffs.reduce((acc, c, idx) => acc + c * Math.pow(qNom, idx), 0);
      } else if (axial) {
        const omt = 1 - t;
        const omt2 = omt * omt, t2 = t * t;
        qNom = omt * omt2 * qMin + 3 * omt2 * t * qC1 + 3 * omt * t2 * qC2 + t * t2 * qMax;
        pNom = omt * omt2 * pStart + 3 * omt2 * t * pC1 + 3 * omt * t2 * pC2 + t * t2 * pEnd;
      } else {
        const omt = 1 - t;
        qNom = omt * omt * qMin + 2 * t * omt * qCtrl + t * t * qMax;
        pNom = omt * omt * pStart + 2 * t * omt * pCtrl + t * t * pEnd;
      }
      
      const qScaled = qNom * scaleFactor;
      const pScaled = Math.max(pNom * (scaleFactor * scaleFactor), 0);
      points.push([qScaled, pScaled]);
    }

    const color = familyMode ? (isPrimary ? "#0d6efd" : "#c3ccd6") : colors[idx % colors.length];
    const siblingLabel = p.size || p.model || p.id;

    series.push({
      // В модельном ряду соседние типоразмеры подписаны коротко (по размеру) —
      // полное имя модели остаётся только у выделенной кривой
      name: familyMode && !isPrimary ? siblingLabel : (p.model || p.id),
      type: 'line',
      // Точки уже лежат на квадратичной Безье (200 шт.) — дополнительное
      // сглаживание ECharts даёт «сплайн сплайна» и артефакты (QP_MODEL, п. 5.2)
      smooth: false,
      symbol: 'none',
      data: points,
      lineStyle: { width: familyMode ? (isPrimary ? 4 : 1.25) : 3, color, opacity: familyMode && !isPrimary ? 0.85 : 1 },
      itemStyle: { color },
      z: isPrimary ? 5 : 1,
      __hideLegend: familyMode && !isPrimary,
      __familyProductId: familyMode && !isPrimary ? String(p.id) : null,
      // Подпись прямо у конца кривой — иначе непонятно, какой типоразмер
      // за какой серой линией, без наведения курсора на тонкую линию
      endLabel: familyMode && !isPrimary ? {
        show: true,
        formatter: siblingLabel,
        color: '#94a3b8',
        fontSize: 10.5,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif',
      } : undefined,
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

    // Зона допуска по давлению вокруг участка кривой Q ± 15% от точки + процент
    // запаса в подписи точки — считаем по единственной модели, либо (в
    // модельном ряду) по выделенной. При явном сравнении 2+ моделей без
    // primaryId зону не рисуем — непонятно, к какой кривой её привязывать.
    let pointLabel = 'Рабочая точка';
    const primaryIdx = familyMode ? products.findIndex((p) => String(p.id) === String(primaryId)) : 0;
    const primarySeries = products.length === 1 || familyMode ? series[primaryIdx] : null;
    if (primarySeries && primarySeries.data.length >= 2) {
      const fanPts = primarySeries.data;
      const tolPct = Number(targetPoint.tol) > 0 ? Number(targetPoint.tol) : 7.5;
      const TOL_P = tolPct / 100;
      const seg = fanPts.filter(([q]) => q >= targetPoint.q * 0.85 && q <= targetPoint.q * 1.15);
      if (seg.length >= 2) {
        // Полигон через custom-серию: stack у ECharts на двух числовых осях
        // складывает координаты и уводит полосу в сторону — рисуем контур сами
        const upper = seg.map(([q, p]) => [q, p * (1 + TOL_P)]);
        const lower = seg.map(([q, p]) => [q, p * (1 - TOL_P)]);
        const outline = upper.concat(lower.slice().reverse());
        series.push({
          name: 'tol-band',
          type: 'custom',
          silent: true,
          z: 1,
          clip: true,
          renderItem: (params, api) => ({
            type: 'polygon',
            shape: { points: outline.map((pt) => api.coord(pt)) },
            style: { fill: 'rgba(2, 123, 243, 0.16)' }
          }),
          data: [0]
        });
      }

      // Давление на кривой при Q точки — для процента запаса
      let pAvail = null;
      for (let i = 1; i < fanPts.length; i++) {
        const [qa, pa] = fanPts[i - 1];
        const [qb, pb] = fanPts[i];
        if (qa <= targetPoint.q && targetPoint.q <= qb) {
          pAvail = qb === qa ? pa : pa + ((targetPoint.q - qa) / (qb - qa)) * (pb - pa);
          break;
        }
      }
      if (pAvail != null && pAvail > 0) {
        const reservePct = ((pAvail - targetPoint.p) / targetPoint.p) * 100;
        const sign = reservePct >= 0 ? '+' : '';
        pointLabel = `Рабочая точка · запас ${sign}${reservePct.toFixed(1)}%`;
      }
    }

    // Курсорные линии к осям — как в паспортных графиках, чтобы точку было
    // видно без наведения мыши (обычный axisPointer виден только по hover)
    series.push({
      name: 'guide-v',
      type: 'line',
      silent: true,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: '#d62728', width: 1, opacity: 0.5 },
      data: [[targetPoint.q, 0], [targetPoint.q, targetPoint.p]],
      z: 2,
    });
    series.push({
      name: 'guide-h',
      type: 'line',
      silent: true,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: '#d62728', width: 1, opacity: 0.5 },
      data: [[0, targetPoint.p], [targetPoint.q, targetPoint.p]],
      z: 2,
    });

    series.push({
      name: 'Рабочая точка',
      type: 'scatter',
      symbolSize: 13,
      itemStyle: { color: '#fff', borderColor: '#d62728', borderWidth: 3 },
      data: [[targetPoint.q, targetPoint.p]],
      label: { show: true, formatter: pointLabel, position: 'top', color: '#d62728', fontWeight: 'bold' },
      zlevel: 10
    });
  }

  return series;
}

function renderQpChartShared(container, chartRef, products, targetRpm = null, targetPoint = null, opts = {}) {
  if (!container || typeof echarts === "undefined") return chartRef;

  let isNewChart = false;
  if (!chartRef) {
    chartRef = echarts.init(container);
    isNewChart = true;
  } else {
    chartRef.clear();
  }

  const qpChartFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';

  const series = buildQpDatasetsShared(products, targetRpm, targetPoint, opts);

  // Верхнюю границу оси P считаем по самим кривым вентиляторов (без хвоста
  // «Кривой сети», который на большом Q улетает высоко и сжимает всё
  // остальное в нижнюю четверть графика) — так провалы/горбы видно отчётливо
  let maxCurveP = 0;
  for (const s of series) {
    if (isServiceSeriesName(s.name) || s.name === 'Кривая сети' || !Array.isArray(s.data)) continue;
    for (const d of s.data) {
      const v = Array.isArray(d) ? d[1] : null;
      if (v != null && v > maxCurveP) maxCurveP = v;
    }
  }
  if (targetPoint?.p > maxCurveP) maxCurveP = targetPoint.p;
  const yMax = maxCurveP > 0 ? maxCurveP * 1.18 : undefined;

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 },
      // Служебные серии (зона допуска, курсорные линии) в подсказку не попадают
      formatter: (params) => {
        const list = (Array.isArray(params) ? params : [params])
          .filter((pr) => pr && pr.seriesName && !isServiceSeriesName(pr.seriesName));
        if (!list.length) return '';
        const first = Array.isArray(list[0].value) ? list[0].value[0] : null;
        const head = first != null ? `Q = ${formatNumber(first)} м³/ч` : '';
        const rows = list.map((pr) => {
          const v = Array.isArray(pr.value) ? pr.value[1] : pr.value;
          return `${pr.marker} ${escapeHtml(pr.seriesName)}: <b>${formatNumber(v)} Па</b>`;
        });
        return [head, ...rows].filter(Boolean).join('<br/>');
      }
    },
    legend: {
      bottom: 0,
      data: series.filter((s) => s.name && !isServiceSeriesName(s.name) && !s.__hideLegend).map((s) => s.name),
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 }
    },
    // Зум по X и Y независим: колесо мыши — по Q (основная ось), а по Y —
    // свой ползунок справа (перетаскивание не задевает масштаб по X)
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseMove: false },
      { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 14, bottom: 26, brushSelect: false },
      { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 14, right: 8, brushSelect: false, showDataShadow: false }
    ],
    toolbox: {
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: 'Лупа', back: 'Сброс лупы' } },
        saveAsImage: { title: 'Скачать PNG', name: 'ventsearch-chart' }
      },
      right: 40,
      top: 0
    },
    graphic: [{
      type: 'text',
      left: 4,
      top: 2,
      silent: true,
      style: {
        text: 'Колесо — зум по Q · ползунок справа — по P',
        fill: '#9aa5b1',
        fontSize: 10.5,
        fontFamily: qpChartFontFamily
      }
    }],
    grid: {
      left: '3%',
      right: 34,
      bottom: 76,
      top: '12%',
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
      min: 0,
      max: yMax,
      splitLine: { show: true, lineStyle: { color: '#e0e0e0' } },
      minorSplitLine: { show: true, lineStyle: { color: '#f5f5f5' } },
      axisLabel: { fontFamily: qpChartFontFamily, formatter: (val) => formatNumber(val) },
      nameTextStyle: { fontFamily: qpChartFontFamily, fontWeight: '600', fontSize: 13 }
    },
    series
  };

  chartRef.setOption(option, true);

  // Клик по серой кривой ряда переключает её в основную (opts.onSelectFamilyMember) —
  // актуальный колбэк держим на самом инстансе графика, обработчик клика
  // навешивается один раз и всегда читает свежее значение
  chartRef._onSelectFamilyMember = typeof opts.onSelectFamilyMember === "function" ? opts.onSelectFamilyMember : null;

  // Подписываемся один раз при создании графика: повторные перерисовки
  // (слайдер оборотов, добавление модели в сравнение) не должны копить обработчики
  if (isNewChart) {
    const chart = chartRef;
    window.addEventListener('resize', () => {
      chart.resize();
    });
    // Контейнер мог быть скрыт (вкладка, d-none) в момент init — тогда canvas
    // получает нулевой размер. Наблюдаем за контейнером и подгоняем график,
    // как только у него появляется реальная ширина/высота.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) chart.resize();
      });
      observer.observe(container);
      chart.on('disposed', () => observer.disconnect());
    }
    chart.on('click', (params) => {
      const cb = chart._onSelectFamilyMember;
      if (!cb || params.seriesIndex == null) return;
      const opt = chart.getOption();
      const s = opt.series && opt.series[params.seriesIndex];
      const pid = s && s.__familyProductId;
      if (pid) cb(pid);
    });
    chart.on('mouseover', (params) => {
      const opt = chart.getOption();
      const s = params.seriesIndex != null && opt.series && opt.series[params.seriesIndex];
      if (chart._onSelectFamilyMember && s && s.__familyProductId) container.style.cursor = 'pointer';
    });
    chart.on('mouseout', (params) => {
      if (params.componentType === 'series') container.style.cursor = 'default';
    });
  }

  return chartRef;
}

// Запросить у бэкенда PDF по списку моделей и скачать файл.
// Используется и в сравнении (2+ моделей), и на карточке одиночной модели.
async function requestPdfExport(ids, filename, chart) {
  const chartImageDataUrl = chart ? captureChartPngForPdf(chart) : null;
  const response = await fetch(apiUrl("/api/export/pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, filename, chart_image_data_url: chartImageDataUrl }),
  });
  if (!response.ok) {
    throw new Error(`PDF export failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// PNG для вставки в PDF: офф-скрин рендер с пропорциями блока отчёта (~2.5:1),
// без ползунка зума и тулбокса — прямой снимок экранного canvas (очень широкого
// и низкого) в PDF выглядит мелкой узкой полосой
function captureChartPngForPdf(sourceChart) {
  if (!sourceChart || typeof echarts === 'undefined') return null;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:1400px;height:560px;';
  document.body.appendChild(holder);
  let chart = null;
  try {
    chart = echarts.init(holder);
    const opts = sourceChart.getOption();
    opts.animation = false;
    opts.dataZoom = [];
    opts.toolbox = [];
    chart.setOption(opts);
    return chart.getDataURL({ type: 'png', backgroundColor: '#fff', pixelRatio: 2 });
  } catch (err) {
    console.error(err);
    return sourceChart.getDataURL({ type: 'png', backgroundColor: '#fff', pixelRatio: 2 });
  } finally {
    if (chart) chart.dispose();
    holder.remove();
  }
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
  const tileSizeGroup = $("#tileSizeGroup");

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
    tileSize: loadTileSize(),
  };

  function syncTileSizeUi() {
    if (!tileSizeGroup) return;
    for (const btn of tileSizeGroup.querySelectorAll("[data-tile-size]")) {
      const active = btn.dataset.tileSize === state.tileSize;
      btn.classList.toggle("btn-dark", active);
      btn.classList.toggle("btn-outline-dark", !active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }
  syncTileSizeUi();

  tileSizeGroup?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-tile-size]");
    if (!btn || btn.dataset.tileSize === state.tileSize) return;
    state.tileSize = btn.dataset.tileSize;
    saveTileSize(state.tileSize);
    syncTileSizeUi();
    renderProducts(state.currentItems, { total: state.lastTotal, page: state.currentPage, limit: state.lastLimit });
  });

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

    function buildProductCard(p) {
      state.cacheById.set(p.id, p);
      const col = document.createElement("div");
      col.className = TILE_SIZE_COLS[state.tileSize] || TILE_SIZE_COLS.md;

      const card = document.createElement("article");
      const selected = state.selectedIds.has(p.id);
      const inProject = state.projectIds.has(p.id);
      const sizeClass = state.tileSize === "sm" ? " tile-sm" : state.tileSize === "lg" ? " tile-lg" : "";
      card.className = `card h-100 shadow-sm product-card${sizeClass}${selected ? " selected" : ""}`;

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
        ${p._point ? `<div class="mb-2"><span class="badge ${p._point.reserve_percent < 0 ? "text-bg-warning" : (p._point.reserve_percent <= 15 ? "text-bg-success" : "text-bg-secondary")}">В точке: ${escapeHtml(formatNumber(p._point.p_available))} Па · ${p._point.reserve_percent < 0 ? "дефицит " + escapeHtml(Math.abs(p._point.reserve_percent)) : "запас " + escapeHtml(p._point.reserve_percent)}%</span></div>` : ""}
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
      return col;
    }

    // Группировка по модельному ряду (та же схема, что и на графике Q-P):
    // одинаковые типоразмеры собираются подряд под общим заголовком, вместо
    // того чтобы перемежаться карточками других рядов. Сама сортировка и
    // поиск не меняются — группы просто «стягивают» совпадающие карточки
    // в один блок, сохраняя порядок первого появления ряда в списке.
    const groups = new Map();
    for (const p of state.currentItems) {
      const key = familyKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    for (const [key, items] of groups) {
      if (groups.size > 1) {
        const header = document.createElement("div");
        header.className = "col-12";
        header.innerHTML = `
          <div class="d-flex align-items-baseline gap-2 model-group-header ${groups.size > 1 && grid.childElementCount > 0 ? "mt-2" : ""} mb-1">
            <h3 class="h6 fw-bold mb-0">${escapeHtml(key || "Прочие")}</h3>
            <span class="text-secondary small">${items.length} ${pluralRu(items.length, "модель", "модели", "моделей")}</span>
          </div>
        `;
        grid.appendChild(header);
      }
      for (const p of items) {
        grid.appendChild(buildProductCard(p));
      }
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

  // --- Подбор по рабочей точке (Q, P) ---
  const pointForm = $("#pointForm");
  const pointQInput = $("#pointQ");
  const pointPInput = $("#pointP");
  const pointTolInput = $("#pointTol");
  const pointResetBtn = $("#pointResetBtn");

  async function runPointSearch(pointQ, pointP, pointTol) {
    hideError();
    setLoading(true);
    const tolText = pointTol > 0 ? ` · допуск ±${formatNumber(pointTol)}%` : "";
    state.querySummaryText = `Рабочая точка: Q = ${formatNumber(pointQ)} м³/ч · P = ${formatNumber(pointP)} Па${tolText}`;
    if (querySummary) querySummary.textContent = state.querySummaryText;
    try {
      const params = new URLSearchParams({
        point_q: String(pointQ), point_p: String(pointP), limit: String(PAGE_SIZE),
      });
      if (pointTol > 0) params.set("tolerance", String(pointTol));
      const data = await fetchJson(apiUrl(`/api/products/select-point?${params.toString()}`));
      const items = (Array.isArray(data?.items) ? data.items : []).map((it) => ({
        ...it.product,
        _point: { p_available: it.p_available, reserve_percent: it.reserve_percent },
      }));
      saveWorkingPoint({ q: pointQ, p: pointP, tol: pointTol > 0 ? pointTol : undefined });
      if (!items.length) {
        showEmptyState();
        if (resultsCount) resultsCount.textContent = "0";
        showError(
          `По точке Q=${formatNumber(pointQ)} м³/ч, P=${formatNumber(pointP)} Па ничего не найдено ` +
          `(диапазон расхода покрыли ${data?.total_considered ?? 0} мод., но давления не хватило).`,
        );
      } else {
        showCatalogResults();
        renderProducts(items, { total: items.length, page: 1, limit: Math.max(items.length, 1) });
      }
    } catch (err) {
      console.error(err);
      showError("Не удалось выполнить подбор по точке. Проверьте, что бэкенд запущен.");
    } finally {
      setLoading(false);
    }
  }

  pointForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const pointQ = toNumber(pointQInput?.value);
    const pointP = toNumber(pointPInput?.value);
    const pointTol = Math.min(Math.max(toNumber(pointTolInput?.value) || 0, 0), 50);
    if (!pointQ || pointQ <= 0 || !pointP || pointP <= 0) {
      showError("Укажите расход Q (м³/ч) и давление P (Па) — оба значения должны быть больше нуля.");
      return;
    }
    runPointSearch(pointQ, pointP, pointTol);
    closeFiltersOffcanvasIfMobile();
  });

  pointResetBtn?.addEventListener("click", () => {
    if (pointQInput) pointQInput.value = "";
    if (pointPInput) pointPInput.value = "";
    if (pointTolInput) pointTolInput.value = "";
    saveWorkingPoint(null);
    loadPage(1);
  });

  // Восстановить последнюю рабочую точку в поля (не запуская поиск)
  {
    const storedPoint = loadWorkingPoint();
    if (storedPoint) {
      if (pointQInput) pointQInput.value = String(storedPoint.q);
      if (pointPInput) pointPInput.value = String(storedPoint.p);
      if (pointTolInput && storedPoint.tol) pointTolInput.value = String(storedPoint.tol);
    }
  }

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
  let families = [];

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
    headerRow.innerHTML = `<th style="width:220px;">Параметр</th>${products
      .map((p) => {
        const fam = families.find((f) => (f.variants || []).some((v) => String(v.id) === String(p.id)));
        const siblings = fam ? fam.variants.filter((v) => String(v.id) !== String(p.id)) : [];
        const swapSelect = fam && siblings.length
          ? `<select class="form-select form-select-sm mt-1 compare-swap-size" data-slot="${escapeHtml(p.id)}" title="Заменить типоразмер в этом же ряду">
              <option value="${escapeHtml(p.id)}" selected>${escapeHtml(p.size || p.model)} (текущий)</option>
              ${siblings.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.size || v.model)} · ⌀${v.diameter ?? "—"}мм</option>`).join("")}
            </select>`
          : "";
        return `<th>
        <div class="d-flex justify-content-between align-items-center">
          <span>${escapeHtml(p.model || p.id)}</span>
          <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-2 btn-remove-compare" data-id="${escapeHtml(p.id)}" title="Удалить из сравнения">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
            </svg>
          </button>
        </div>
        ${swapSelect}
      </th>`;
      })
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

    // Смена типоразмера прямо в шапке — без удаления и повторного добавления,
    // как в модельном ряду на карточке товара
    headerRow.querySelectorAll(".compare-swap-size").forEach((select) => {
      select.addEventListener("change", () => {
        const oldId = select.dataset.slot;
        const newId = select.value;
        if (!newId || newId === oldId) return;
        const ordered = loadCompareIds();
        const idx = ordered.indexOf(oldId);
        if (idx === -1) return;
        ordered[idx] = newId;
        saveCompareIds(ordered);
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
    // Если задана рабочая точка (подбор на главной) — рисуем её и кривую сети
    compareChart = renderQpChartShared(qpChartCanvas, compareChart, products, null, loadWorkingPoint());
  }

  async function exportCompareToPdf(products) {
    if (products.length < 1) {
      showError("Для экспорта выберите хотя бы одну модель.");
      return;
    }
    hideError();
    try {
      const ids = products.map((p) => String(p.id)).filter(Boolean);
      await requestPdfExport(ids, "ventsearch-compare.pdf", compareChart);
    } catch (err) {
      console.error(err);
      showError("Не удалось экспортировать PDF. Проверьте доступность API.");
    }
  }

  // Модельные ряды грузим один раз и переиспользуем и в форме добавления,
  // и в свопе типоразмера прямо в шапке таблицы сравнения
  async function loadFamilies() {
    try {
      const data = await fetchJson(apiUrl("/api/products/families"));
      families = Array.isArray(data?.families) ? data.families : [];
    } catch (err) {
      console.error("families fetch failed", err);
      families = [];
    }
  }

  // Каскадный подбор «модельный ряд → типоразмер» — как выбор поколения,
  // затем размера экрана у телефона, вместо плоского списка из 300+ моделей.
  const MAX_COMPARE = 6;
  function initFamilyVariantPicker() {
    const familySelect = $("#familySelect");
    const variantSelect = $("#variantSelect");
    const addForm = $("#addCompareForm");
    if (!familySelect || !variantSelect || !addForm) return;

    if (!families.length) {
      addForm.classList.add("d-none");
      return;
    }

    familySelect.innerHTML = "";
    for (const fam of families) {
      const opt = document.createElement("option");
      opt.value = fam.key;
      const count = (fam.variants || []).length;
      opt.textContent = `${fam.key} (${count} ${pluralRu(count, "типоразмер", "типоразмера", "типоразмеров")})`;
      familySelect.appendChild(opt);
    }

    function fillVariants() {
      const fam = families.find((f) => f.key === familySelect.value) || families[0];
      variantSelect.innerHTML = "";
      for (const v of fam?.variants || []) {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = `${v.size || v.model} · ⌀${v.diameter ?? "—"}мм · ${v.airflow?.raw || "—"} м³/ч · ${formatPrice(v.price)}`;
        variantSelect.appendChild(opt);
      }
    }
    fillVariants();
    familySelect.addEventListener("change", fillVariants);

    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = variantSelect.value;
      if (!id) return;
      const ids = new Set(loadCompareIds());
      if (ids.size >= MAX_COMPARE && !ids.has(id)) {
        showError(`Максимум ${MAX_COMPARE} моделей одновременно — уберите одну, чтобы добавить другую.`);
        return;
      }
      ids.add(id);
      saveCompareIds(ids);
      window.location.reload();
    });
  }

  try {
    hideError();
    await loadFamilies();
    initFamilyVariantPicker();
    const ids = loadCompareIds();
    updateCompareNavBadge();
    if (ids.length < 1) {
      compareMeta.textContent = "Выберите модели в каталоге (или через форму выше) и вернитесь на страницу сравнения.";
      const backBtn = document.createElement("a");
      backBtn.href = "index.html";
      backBtn.className = "btn btn-dark btn-sm mt-2";
      backBtn.textContent = "← Вернуться в каталог";
      compareMeta.appendChild(document.createElement("br"));
      compareMeta.appendChild(backBtn);
      return;
    }
    compareMeta.textContent =
      ids.length === 1
        ? "Выбрана 1 модель. Добавьте ещё, чтобы сравнить, или посмотрите её характеристику ниже."
        : `Выбрано моделей: ${ids.length}`;
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

    // Модельный ряд: та же аэродинамическая схема в разных типоразмерах —
    // показываем всей линейкой на одном графике (текущая модель выделена),
    // как варианты размера одного поколения телефона на одном сравнении.
    let familyVariants = null;
    try {
      const familiesData = await fetchJson(apiUrl("/api/products/families"));
      const families = Array.isArray(familiesData?.families) ? familiesData.families : [];
      const myFamily = families.find((f) => (f.variants || []).some((v) => String(v.id) === String(data.id)));
      if (myFamily && myFamily.variants.length > 1) familyVariants = myFamily.variants;

      // Дропдаун ручного сравнения: группируем по модельному ряду —
      // плоский список из 300+ моделей был бы бесполезен
      for (const fam of families) {
        const items = (fam.variants || []).filter((x) => String(x.id) !== String(data.id));
        if (!items.length) continue;
        const group = document.createElement("optgroup");
        group.label = fam.key || "Прочие";
        for (const item of items) {
          const opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = `${item.size || item.model} · ${formatPrice(item.price)}`;
          group.appendChild(opt);
        }
        compareWithSelect.appendChild(group);
      }
    } catch (err) {
      console.error("families fetch failed", err);
    }

    // Показ ряда с выделенной моделью primaryId — переиспользуется при первой
    // отрисовке и при клике по серой кривой / выборе типоразмера в дропдауне
    function renderFamilyView(primaryId) {
      const focused = familyVariants.find((v) => String(v.id) === String(primaryId)) || currentProduct;
      productChart = renderQpChartShared(chartCanvas, productChart, familyVariants, null, loadWorkingPoint(), {
        primaryId,
        onSelectFamilyMember: (pid) => renderFamilyView(pid),
      });
      const count = familyVariants.length;
      productCompareMeta.textContent =
        `Модельный ряд ${familyKey(currentProduct)}: ${count} ${pluralRu(count, "типоразмер", "типоразмера", "типоразмеров")}. ` +
        `Выделено: ${focused.size || focused.model || focused.id} — кликните по серой линии, чтобы выделить другой типоразмер.`;
    }

    if (familyVariants) {
      renderFamilyView(data.id);
    } else {
      productChart = renderQpChartShared(chartCanvas, productChart, [data], null, loadWorkingPoint());
      productCompareMeta.textContent = `Сейчас показана характеристика модели ${data.model || data.id}.`;
    }

    $("#exportProductPdfBtn")?.addEventListener("click", async () => {
      try {
        const slug = currentProduct?._meta?.model_slug || currentProduct?.meta?.model_slug || currentProduct.id;
        await requestPdfExport([String(currentProduct.id)], `ventsearch-${slug}.pdf`, productChart);
      } catch (err) {
        console.error(err);
        window.alert("Не удалось экспортировать PDF. Проверьте доступность API.");
      }
    });

    compareOnProductBtn?.addEventListener("click", async () => {
      const otherId = compareWithSelect.value;
      if (!otherId) {
        if (familyVariants) {
          renderFamilyView(currentProduct.id);
        } else {
          productChart = renderQpChartShared(chartCanvas, productChart, [currentProduct], null, loadWorkingPoint());
          productCompareMeta.textContent = "Выберите вторую модель для сравнения.";
        }
        return;
      }
      // Тот же модельный ряд — просто переключаем, какой типоразмер выделен,
      // без ухода из режима «весь ряд на одном графике»
      if (familyVariants && familyVariants.some((v) => String(v.id) === String(otherId))) {
        renderFamilyView(otherId);
        return;
      }
      const second = await fetchJson(apiUrl(`/api/products/${encodeURIComponent(otherId)}`));
      productChart = renderQpChartShared(chartCanvas, productChart, [currentProduct, second], null, loadWorkingPoint());
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
