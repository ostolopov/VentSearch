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

// navigator.clipboard.writeText требует secure context (HTTPS или localhost) —
// по локальной сети через http://192.168.x.x браузер её не даёт, и copy
// молча ничего не делает. Запасной вариант — document.execCommand('copy')
// через скрытый textarea, он работает и без HTTPS. Возвращает true/false.
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("navigator.clipboard.writeText недоступен, пробуем execCommand", err);
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    console.warn("execCommand('copy') не сработал", err);
    return false;
  }
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

// Значения ячеек таблицы каталога для клиентской сортировки (подбор по точке
// не перезапрашивает сервер, поэтому сортируем прямо в браузере).
const CATALOG_SORT_GETTERS = {
  model: (p) => String(p.model || ""),
  airflow: (p) => getRangePeak(p.airflow),
  pressure: (p) => getRangePeak(p.pressure),
  power: (p) => toNumber(p.power),
  noise: (p) => toNumber(p.noise_level),
  price: (p) => toNumber(p.price),
  diameter: (p) => toNumber(p.diameter),
};

function sortItemsClient(items, sortKey) {
  const m = /^([a-z]+)_(asc|desc)$/.exec(String(sortKey || ""));
  const getter = m ? CATALOG_SORT_GETTERS[m[1]] : null;
  if (!getter) return [...items];
  const dir = m[2] === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") return dir * va.localeCompare(String(vb), "ru");
    return dir * (va - vb);
  });
}

// Фильтры каталога переживают переход на карточку товара и возврат назад
// (sessionStorage — на время вкладки; новая вкладка начинает с чистых фильтров)
const CATALOG_FILTERS_KEY = "ventsearch.catalog.filters";

function saveCatalogFilters(form, sortSelect) {
  if (!form) return;
  try {
    const data = {};
    for (const el of form.elements) {
      if (el.name && String(el.value || "").trim()) data[el.name] = el.value;
    }
    if (sortSelect?.value) data.__sort = sortSelect.value;
    sessionStorage.setItem(CATALOG_FILTERS_KEY, JSON.stringify(data));
  } catch {
    // приватный режим — просто не запоминаем
  }
}

function restoreCatalogFilters(form, sortSelect) {
  if (!form) return;
  try {
    const raw = sessionStorage.getItem(CATALOG_FILTERS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [k, v] of Object.entries(data)) {
      if (k === "__sort") {
        if (sortSelect && !sortSelect.dataset.userSet) sortSelect.value = String(v);
        continue;
      }
      const el = form.elements[k];
      // Только пустые поля — явный ?q= из URL и введённое руками не трогаем
      if (el && !String(el.value || "").trim()) el.value = String(v);
    }
  } catch {
    // повреждённое значение — игнорируем
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
  // Number(null) и Number("") дают 0 — из-за этого отсутствующая цена
  // («по запросу») считалась нулём и попадала в «Итого по проекту» как 0 ₽
  if (value === null || value === undefined || value === "") return null;
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

let _photosVersionCache = null;
let _photosVersionPromise = null;

// Версии файлов photos/ (мтайм) с бэкенда — используются как ?v=... в ссылке
// на фото, чтобы браузер сразу подхватывал заменённый файл на диске: URL без
// этого параметра не меняется при замене файла, и браузер показывает старую
// картинку из своего кэша даже после Docker reset / перезапуска сервера.
async function ensurePhotosVersionLoaded() {
  if (_photosVersionCache) return _photosVersionCache;
  if (!_photosVersionPromise) {
    _photosVersionPromise = fetch(apiUrl("/api/photos-version"))
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then((data) => {
        _photosVersionCache = data && typeof data === "object" ? data : {};
        return _photosVersionCache;
      });
  }
  return _photosVersionPromise;
}

function getImageUrlCandidates(product) {
  const fileName = getImageFileName(product);
  if (!fileName) return [];
  const encoded = encodeURIComponent(fileName);
  const version = _photosVersionCache?.[fileName];
  const suffix = version ? `?v=${version}` : "";
  const candidates = [
    `${apiUrl(`/photos/${encoded}`)}${suffix}`,
    `/photos/${encoded}${suffix}`,
    `photos/${encoded}${suffix}`,
  ];
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    candidates.push(`${window.location.origin}/photos/${encoded}${suffix}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function renderFanImage(container, product, altText, lazy = true) {
  if (!container) return;
  container.innerHTML = "";
  await ensurePhotosVersionLoaded();
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

// Чертёж модели из бумажного каталога. Скрин кладётся в photos/ с именем
// blueprint_<слаг-модели>.png (точное ожидаемое имя показываем в подсказке
// под блоком) — появится на карточке сам, без правок кода. Пока файла нет,
// показываем шаблон-заглушку «синьки» (frontend/img/blueprint-placeholder.svg).
const BLUEPRINT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

async function renderProductBlueprint(product) {
  const card = document.getElementById("blueprintCard");
  const img = document.getElementById("blueprintImage");
  const hint = document.getElementById("blueprintHint");
  if (!card || !img) return;

  const slug = String(
    product?._meta?.model_slug || product?.meta?.model_slug || slugify(product?.model) || product?.id || "",
  ).trim().toLowerCase();
  const expectedName = `blueprint_${slug}.png`;

  const versions = await ensurePhotosVersionLoaded();
  let found = null;
  for (const ext of BLUEPRINT_EXTENSIONS) {
    const name = `blueprint_${slug}.${ext}`;
    if (versions && Object.prototype.hasOwnProperty.call(versions, name)) {
      found = name;
      break;
    }
  }

  if (found) {
    const version = versions[found];
    img.src = `${apiUrl(`/photos/${encodeURIComponent(found)}`)}${version ? `?v=${version}` : ""}`;
    img.alt = `Чертёж ${product?.model || ""}`.trim();
    if (hint) hint.textContent = `Файл: photos/${found}`;
  } else {
    img.src = "img/blueprint-placeholder.svg";
    img.alt = "Чертёж появится позже";
    if (hint) hint.textContent = `Чтобы заменить заглушку реальным чертежом, положите скан в photos/${expectedName}`;
  }
  card.classList.remove("d-none");
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

// Оцифрованные реальные формы кривых (ВО 13-284, каталог производителя) — точки
// (q_frac, p_frac) в [0,1]x[0,1] по числу лопастей/углу установки. Синхронизировано
// с backend/domain/services/qp_shapes_vo13284.json — при обновлении менять оба места.
const QP_DIGITIZED_SHAPES = {"4":{"15":[[0.0,1.0],[0.05,0.9775],[0.1,0.9597],[0.15,0.9377],[0.2,0.9204],[0.25,0.8925],[0.3,0.8629],[0.35,0.8279],[0.4,0.788],[0.45,0.7429],[0.5,0.6935],[0.55,0.6386],[0.6,0.5801],[0.65,0.5124],[0.7,0.4419],[0.75,0.3691],[0.8,0.2889],[0.85,0.2076],[0.9,0.1311],[0.95,0.0596],[1.0,0.0]],"20":[[0.0,1.0],[0.05,0.9768],[0.1,0.9539],[0.15,0.9312],[0.2,0.9032],[0.25,0.8786],[0.3,0.8473],[0.35,0.8105],[0.4,0.7735],[0.45,0.7278],[0.5,0.6845],[0.55,0.6322],[0.6,0.5736],[0.65,0.5141],[0.7,0.4472],[0.75,0.3814],[0.8,0.3045],[0.85,0.2278],[0.9,0.1457],[0.95,0.0658],[1.0,0.0]],"25":[[0.0,1.0],[0.05,0.9833],[0.1,0.9585],[0.15,0.942],[0.2,0.9174],[0.25,0.8978],[0.3,0.8768],[0.35,0.8449],[0.4,0.8108],[0.45,0.7737],[0.5,0.7278],[0.55,0.6764],[0.6,0.6225],[0.65,0.5555],[0.7,0.4784],[0.75,0.3984],[0.8,0.3099],[0.85,0.2265],[0.9,0.1405],[0.95,0.0661],[1.0,0.0]],"30":[[0.0,1.0],[0.05,0.9826],[0.1,0.9652],[0.15,0.9478],[0.2,0.9305],[0.25,0.9133],[0.3,0.9034],[0.35,0.8789],[0.4,0.8447],[0.45,0.8107],[0.5,0.7769],[0.55,0.7097],[0.6,0.6624],[0.65,0.5932],[0.7,0.5101],[0.75,0.4135],[0.8,0.321],[0.85,0.2441],[0.9,0.1659],[0.95,0.0748],[1.0,0.0]]},"6":{"15":[[0.0,1.0],[0.05,0.986],[0.1,0.9721],[0.15,0.9538],[0.2,0.9268],[0.25,0.9046],[0.3,0.8671],[0.35,0.8273],[0.4,0.786],[0.45,0.7357],[0.5,0.6833],[0.55,0.6254],[0.6,0.5663],[0.65,0.5032],[0.7,0.4367],[0.75,0.3668],[0.8,0.2959],[0.85,0.218],[0.9,0.1435],[0.95,0.0671],[1.0,0.0]],"20":[[0.0,1.0],[0.05,0.989],[0.1,0.9836],[0.15,0.9727],[0.2,0.9565],[0.25,0.9399],[0.3,0.9139],[0.35,0.8868],[0.4,0.8563],[0.45,0.8118],[0.5,0.7638],[0.55,0.7154],[0.6,0.6579],[0.65,0.5886],[0.7,0.519],[0.75,0.4394],[0.8,0.3548],[0.85,0.2588],[0.9,0.1533],[0.95,0.0531],[1.0,0.0]],"25":[[0.0,1.0],[0.05,0.8873],[0.1,0.8655],[0.15,0.845],[0.2,0.8272],[0.25,0.8034],[0.3,0.7754],[0.35,0.7503],[0.4,0.7176],[0.45,0.6856],[0.5,0.6461],[0.55,0.5992],[0.6,0.5565],[0.65,0.5059],[0.7,0.4488],[0.75,0.3848],[0.8,0.312],[0.85,0.2361],[0.9,0.1657],[0.95,0.0952],[1.0,0.0]],"30":[[0.0,1.0],[0.05,0.9799],[0.1,0.9599],[0.15,0.94],[0.2,0.9106],[0.25,0.8811],[0.3,0.852],[0.35,0.8137],[0.4,0.7663],[0.45,0.7196],[0.5,0.6682],[0.55,0.6067],[0.6,0.5309],[0.65,0.4711],[0.7,0.3945],[0.75,0.314],[0.8,0.2211],[0.85,0.1475],[0.9,0.0581],[0.95,0.0581],[1.0,0.0]]},"8":{"20":[[0.0,1.0],[0.05,0.9215],[0.1,0.9125],[0.15,0.8932],[0.2,0.8725],[0.25,0.8463],[0.3,0.8205],[0.35,0.785],[0.4,0.7455],[0.45,0.6976],[0.5,0.6573],[0.55,0.6122],[0.6,0.553],[0.65,0.4968],[0.7,0.4305],[0.75,0.3654],[0.8,0.2969],[0.85,0.2254],[0.9,0.1533],[0.95,0.0723],[1.0,0.0]],"25":[[0.0,1.0],[0.05,0.9779],[0.1,0.9571],[0.15,0.936],[0.2,0.9099],[0.25,0.8841],[0.3,0.8536],[0.35,0.8186],[0.4,0.7794],[0.45,0.7353],[0.5,0.6848],[0.55,0.6333],[0.6,0.5849],[0.65,0.5216],[0.7,0.464],[0.75,0.3958],[0.8,0.3332],[0.85,0.2613],[0.9,0.1784],[0.95,0.1021],[1.0,0.0]],"30":[[0.0,1.0],[0.05,0.9771],[0.1,0.961],[0.15,0.9456],[0.2,0.9226],[0.25,0.8997],[0.3,0.862],[0.35,0.8219],[0.4,0.7749],[0.45,0.7201],[0.5,0.6665],[0.55,0.5961],[0.6,0.53],[0.65,0.4618],[0.7,0.3973],[0.75,0.3267],[0.8,0.253],[0.85,0.1853],[0.9,0.1258],[0.95,0.0589],[1.0,0.0]]},"10":{"20":[[0.0,1.0],[0.05,0.9768],[0.1,0.954],[0.15,0.9366],[0.2,0.9069],[0.25,0.8781],[0.3,0.835],[0.35,0.796],[0.4,0.7473],[0.45,0.699],[0.5,0.6365],[0.55,0.5773],[0.6,0.5129],[0.65,0.4365],[0.7,0.3629],[0.75,0.2895],[0.8,0.2093],[0.85,0.1262],[0.9,0.0439],[0.95,0.0324],[1.0,0.0]],"25":[[0.0,1.0],[0.05,0.968],[0.1,0.9365],[0.15,0.9055],[0.2,0.8699],[0.25,0.8312],[0.3,0.7957],[0.35,0.7573],[0.4,0.7149],[0.45,0.667],[0.5,0.6162],[0.55,0.5609],[0.6,0.5035],[0.65,0.4439],[0.7,0.3782],[0.75,0.3069],[0.8,0.2337],[0.85,0.1554],[0.9,0.0809],[0.95,0.0517],[1.0,0.0]],"30":[[0.0,1.0],[0.05,0.8671],[0.1,0.8484],[0.15,0.8254],[0.2,0.8018],[0.25,0.7684],[0.3,0.7372],[0.35,0.6965],[0.4,0.656],[0.45,0.6151],[0.5,0.5604],[0.55,0.5061],[0.6,0.4446],[0.65,0.3909],[0.7,0.3345],[0.75,0.2764],[0.8,0.2223],[0.85,0.1672],[0.9,0.1161],[0.95,0.0523],[1.0,0.0]]},"12к":{"25":[[0.0,1.0],[0.05,0.9904],[0.1,0.9856],[0.15,0.9808],[0.2,0.9713],[0.25,0.9619],[0.3,0.941],[0.35,0.9114],[0.4,0.8747],[0.45,0.8352],[0.5,0.784],[0.55,0.7275],[0.6,0.6711],[0.65,0.6041],[0.7,0.5356],[0.75,0.4596],[0.8,0.381],[0.85,0.2937],[0.9,0.1999],[0.95,0.1003],[1.0,0.0]],"30":[[0.0,1.0],[0.05,0.9819],[0.1,0.9759],[0.15,0.964],[0.2,0.9462],[0.25,0.9281],[0.3,0.9004],[0.35,0.8595],[0.4,0.8188],[0.45,0.7712],[0.5,0.7123],[0.55,0.6544],[0.6,0.5866],[0.65,0.5164],[0.7,0.4428],[0.75,0.3656],[0.8,0.2894],[0.85,0.2109],[0.9,0.1358],[0.95,0.0602],[1.0,0.0]],"35":[[0.0,1.0],[0.05,0.9806],[0.1,0.9608],[0.15,0.9424],[0.2,0.9236],[0.25,0.8987],[0.3,0.8679],[0.35,0.8249],[0.4,0.7842],[0.45,0.7379],[0.5,0.69],[0.55,0.6316],[0.6,0.5768],[0.65,0.5183],[0.7,0.4573],[0.75,0.3884],[0.8,0.3105],[0.85,0.2245],[0.9,0.1364],[0.95,0.0777],[1.0,0.0]],"40":[[0.0,1.0],[0.05,0.791],[0.1,0.7602],[0.15,0.745],[0.2,0.7298],[0.25,0.7222],[0.3,0.6997],[0.35,0.6804],[0.4,0.6552],[0.45,0.6311],[0.5,0.5982],[0.55,0.5671],[0.6,0.5237],[0.65,0.4779],[0.7,0.4212],[0.75,0.3579],[0.8,0.2828],[0.85,0.2104],[0.9,0.136],[0.95,0.0662],[1.0,0.0]],"45":[[0.0,1.0],[0.05,0.9857],[0.1,0.9857],[0.15,0.9572],[0.2,0.9572],[0.25,0.9289],[0.3,0.894],[0.35,0.8589],[0.4,0.8174],[0.45,0.7584],[0.5,0.6949],[0.55,0.6282],[0.6,0.5621],[0.65,0.4929],[0.7,0.4211],[0.75,0.349],[0.8,0.2772],[0.85,0.1992],[0.9,0.1329],[0.95,0.0654],[1.0,0.0]]}};
const QP_MODEL_BLADE_ANGLE_RE = /(\d+к?)\/(\d+)°/;

// Гарантирует, что p_frac не возрастает по мере роста q_frac (см.
// _enforce_monotonic_decreasing в qp_service.py) — прижимает случайные
// всплески трассировки к предыдущему значению вместо колебания на графике.
function enforceMonotonicDecreasing(points) {
  const cleaned = points.map((p) => [p[0], p[1]]);
  for (let i = 1; i < cleaned.length; i += 1) {
    if (cleaned[i][1] > cleaned[i - 1][1]) cleaned[i][1] = cleaned[i - 1][1];
  }
  return cleaned;
}

// Найти оцифрованную форму кривой по модели («ВО 13-284-6/20°-...» → лопасти
// «6», угол «20»). null — если данных нет (используется параметрическая кривая).
function shapePointsForModel(model) {
  if (!model) return null;
  const m = QP_MODEL_BLADE_ANGLE_RE.exec(String(model));
  if (!m) return null;
  const bladeGroup = QP_DIGITIZED_SHAPES[m[1]];
  if (!bladeGroup) return null;
  const points = bladeGroup[m[2]];
  return points ? enforceMonotonicDecreasing(points) : null;
}

// Кусочно-линейная интерполяция по возрастающей сетке xs.
function linearInterp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i += 1) {
    if (x <= xs[i]) {
      const x0 = xs[i - 1], x1 = xs[i];
      const y0 = ys[i - 1], y1 = ys[i];
      if (x1 === x0) return y0;
      const k = (x - x0) / (x1 - x0);
      return y0 + k * (y1 - y0);
    }
  }
  return ys[ys.length - 1];
}

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
// Новый формат имён «ВО 13-284-4/15°-4-56A4» (типоразмер 56A4) даёт после
// среза суффикса «ВО 13-284-4/15°-4» — число после угла (номер вентилятора /
// количество двигателей) тоже срезаем, чтобы ряд не дробился на подгруппы.
// Один и тот же расчёт, что и в backend/application/use_cases/list_product_families.py.
function familyKey(product) {
  const model = String(product?.model || "").trim();
  const size = String(product?.size || "").trim();
  if (model && size && model.toLowerCase().endsWith(`-${size.toLowerCase()}`)) {
    const head = model.slice(0, model.length - size.length - 1).trim();
    return head.replace(/°-\d+(?:[.,]\d+)?$/, "°").trim();
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
  // Кривые вентиляторов отдельно от служебных серий (зоны допуска — custom-серии
  // с data:[0], их нельзя использовать для расчёта maxQ/поиска кривой по индексу)
  const productCurves = [];

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
    const digitizedShape = (coeffs && Array.isArray(coeffs) && coeffs.length > 0)
      ? null
      : shapePointsForModel(p.model);
    const shapeQs = digitizedShape ? digitizedShape.map((pt) => pt[0]) : null;
    const shapePs = digitizedShape ? digitizedShape.map((pt) => pt[1]) : null;

    const steps = 200;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      let qNom, pNom;

      if (shapeQs) {
        // Оцифрованная реальная форма кривой (см. QP_DIGITIZED_SHAPES) — приоритетнее
        // параметрической Безье, без искусственного провала/горба.
        qNom = qMin + dQ * t;
        pNom = pEnd + linearInterp(t, shapeQs, shapePs) * dP;
      } else if (coeffs && Array.isArray(coeffs) && coeffs.length > 0) {
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
      // Метки для расчёта фокуса осей: значимые кривые (выделенная модель или
      // все сравниваемые) задают стартовое окно зума, серые контекстные — нет
      __isProductCurve: true,
      __isPrimary: isPrimary,
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
    productCurves.push({ id: String(p.id), points, isPrimary, color });

    // Зона допуска ВДОЛЬ ВСЕЙ кривой: те же точки, сдвинутые на ±tol% по
    // давлению (параллельные кривые), заливка цветом самой модели. Рисуем у
    // каждой сравниваемой кривой; у серых контекстных кривых модельного ряда
    // не рисуем — полосы бы слились в нечитаемую кашу.
    if ((!familyMode || isPrimary) && points.length >= 2) {
      const tolPct = targetPoint && Number(targetPoint.tol) > 0 ? Number(targetPoint.tol) : 7.5;
      const TOL_P = tolPct / 100;
      const upper = points.map(([q, pv]) => [q, pv * (1 + TOL_P)]);
      const lower = points.map(([q, pv]) => [q, Math.max(0, pv * (1 - TOL_P))]).reverse();
      const outline = upper.concat(lower);
      series.push({
        name: `tol-band-${idx}`,
        type: 'custom',
        silent: true,
        z: 0,
        clip: true,
        renderItem: (params, api) => ({
          type: 'polygon',
          shape: { points: outline.map((pt) => api.coord(pt)) },
          style: { fill: color, opacity: 0.10 }
        }),
        data: [0]
      });
    }
  });

  if (targetPoint && targetPoint.q > 0 && targetPoint.p > 0) {
    const k = targetPoint.p / Math.pow(targetPoint.q, 2);
    const maxQ = Math.max(
      ...productCurves.map((c) => c.points[c.points.length - 1][0]),
      targetPoint.q * 1.5,
    );
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

    // Процент запаса в подписи точки — по единственной модели, либо (в
    // модельном ряду) по выделенной. При сравнении 2+ моделей без primaryId
    // запас не считаем — непонятно, к какой кривой его привязывать.
    let pointLabel = 'Рабочая точка';
    const primaryCurve = products.length === 1
      ? productCurves[0]
      : productCurves.find((c) => c.isPrimary && familyMode) || null;
    if (primaryCurve && primaryCurve.points.length >= 2) {
      const fanPts = primaryCurve.points;
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

  // Пределы осей считаем по самим кривым вентиляторов (без хвоста «Кривой
  // сети», который на большом Q улетает высоко и сжимает всё остальное).
  // Отдельно считаем «фокус» — пределы по значимым кривым: выделенной модели
  // в модельном ряду или всем сравниваемым. Ось Q заканчивается на максимуме
  // выбранных кривых +15% (а не на всём ряду), чтобы маленький вентилятор не
  // терялся в пустом поле; гигантские соседи ряда доступны ползунком зума.
  let dataMaxQ = 0;
  let dataMaxP = 0;
  let focusMaxQ = 0;
  let focusMaxP = 0;
  for (const s of series) {
    if (!s.__isProductCurve || !Array.isArray(s.data)) continue;
    for (const d of s.data) {
      if (!Array.isArray(d)) continue;
      const q = d[0];
      const pv = d[1];
      if (q != null && q > dataMaxQ) dataMaxQ = q;
      if (pv != null && pv > dataMaxP) dataMaxP = pv;
      if (s.__isPrimary) {
        if (q != null && q > focusMaxQ) focusMaxQ = q;
        if (pv != null && pv > focusMaxP) focusMaxP = pv;
      }
    }
  }
  if (!focusMaxQ) focusMaxQ = dataMaxQ;
  if (!focusMaxP) focusMaxP = dataMaxP;
  if (targetPoint?.q > focusMaxQ) focusMaxQ = targetPoint.q;
  if (targetPoint?.p > focusMaxP) focusMaxP = targetPoint.p;
  if (targetPoint?.q > dataMaxQ) dataMaxQ = targetPoint.q;
  if (targetPoint?.p > dataMaxP) dataMaxP = targetPoint.p;
  const xMax = dataMaxQ > 0 ? Math.ceil(dataMaxQ * 1.15) : undefined;
  const yMax = dataMaxP > 0 ? Math.ceil(dataMaxP * 1.18) : undefined;
  const xFocusEnd = focusMaxQ > 0 ? Math.ceil(focusMaxQ * 1.15) : undefined;
  const yFocusEnd = focusMaxP > 0 ? Math.ceil(focusMaxP * 1.18) : undefined;

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
    // Стартовое окно зума — «фокус» по значимым кривым (см. расчёт выше):
    // выбранная модель занимает весь график, а не зажата в углу полной шкалы
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true, startValue: 0, endValue: xFocusEnd },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseMove: false, startValue: 0, endValue: yFocusEnd },
      { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 14, bottom: 26, brushSelect: false, startValue: 0, endValue: xFocusEnd },
      { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 14, right: 8, brushSelect: false, showDataShadow: false, startValue: 0, endValue: yFocusEnd }
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
      min: 0,
      max: xMax,
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

// Запросить у бэкенда PDF по списку моделей: с графиком (если передан),
// своим заголовком шапки и водяным знаком. Единая точка для сравнения,
// карточки товара и страницы проекта (см. openPdfMaker ниже).
async function fetchClientPdfBlob(ids, options = {}) {
  const chartImageDataUrl = options.chart ? captureChartPngForPdf(options.chart) : null;
  const response = await fetch(apiUrl("/api/export/pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids,
      filename: options.filename || "ventsearch.pdf",
      chart_image_data_url: chartImageDataUrl,
      header_text: options.headerText || undefined,
      watermark: options.watermark || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`PDF export failed: ${response.status}`);
  }
  return response.blob();
}

function downloadBlob(blob, filename) {
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

// ============================================================
// «Документ для клиента» — общее модальное окно PDF-мейкера.
// Открывается с любой страницы (сравнение, карточка товара, проект):
// свой заголовок шапки, водяной знак из photos/, предпросмотр и скачивание.
// ============================================================

let _pdfMakerContext = null;
let _pdfMakerBlobUrl = null;

function ensurePdfMakerModal() {
  let modalEl = document.getElementById("pdfMakerModal");
  if (modalEl) return modalEl;

  modalEl = document.createElement("div");
  modalEl.className = "modal fade";
  modalEl.id = "pdfMakerModal";
  modalEl.tabIndex = -1;
  modalEl.setAttribute("aria-hidden", "true");
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h6">Документ для клиента (PDF)</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Закрыть"></button>
        </div>
        <div class="modal-body">
          <div id="pdfMakerAlert" class="alert alert-danger d-none" role="alert"></div>
          <div class="row g-3 align-items-end">
            <div class="col-md-6">
              <label for="pdfMakerHeaderText" class="form-label text-secondary small mb-1">
                Заголовок документа (пусто — текст по умолчанию)
              </label>
              <input id="pdfMakerHeaderText" class="form-control" maxlength="120"
                placeholder="Например: Коммерческое предложение" />
            </div>
            <div class="col-md-6">
              <label for="pdfMakerWatermark" class="form-label text-secondary small mb-1">
                Водяной знак компании (файл из папки photos/)
              </label>
              <select id="pdfMakerWatermark" class="form-select">
                <option value="">Без водяного знака</option>
              </select>
            </div>
          </div>
          <div class="d-flex gap-2 mt-3">
            <button id="pdfMakerPreviewBtn" class="btn btn-outline-primary btn-sm" type="button">Предпросмотр</button>
            <button id="pdfMakerDownloadBtn" class="btn btn-dark btn-sm" type="button">Скачать PDF</button>
            <span id="pdfMakerStatus" class="text-secondary small align-self-center"></span>
          </div>
          <div id="pdfMakerPreviewWrap" class="mt-3 d-none">
            <iframe id="pdfMakerFrame" style="width: 100%; height: 60vh; border: 1px solid var(--vs-border, #e8e8e8); border-radius: 8px;"
              title="Предпросмотр PDF"></iframe>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  const alertBox = modalEl.querySelector("#pdfMakerAlert");
  const statusEl = modalEl.querySelector("#pdfMakerStatus");
  const previewBtn = modalEl.querySelector("#pdfMakerPreviewBtn");
  const downloadBtn = modalEl.querySelector("#pdfMakerDownloadBtn");
  const previewWrap = modalEl.querySelector("#pdfMakerPreviewWrap");
  const frame = modalEl.querySelector("#pdfMakerFrame");

  function showModalError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }

  function readOptions() {
    const ctx = _pdfMakerContext || {};
    return {
      filename: ctx.filename || "ventsearch.pdf",
      chart: typeof ctx.getChart === "function" ? ctx.getChart() : null,
      headerText: String(modalEl.querySelector("#pdfMakerHeaderText")?.value || "").trim(),
      watermark: String(modalEl.querySelector("#pdfMakerWatermark")?.value || "").trim(),
    };
  }

  async function buildBlob() {
    alertBox.classList.add("d-none");
    const ctx = _pdfMakerContext || {};
    const ids = (typeof ctx.getIds === "function" ? ctx.getIds() : []).map(String).filter(Boolean);
    if (!ids.length) {
      showModalError("Нет выбранных моделей для документа.");
      return null;
    }
    statusEl.textContent = "Формируем PDF…";
    try {
      return await fetchClientPdfBlob(ids, readOptions());
    } catch (err) {
      console.error(err);
      showModalError("Не удалось сформировать PDF. Проверьте доступность API.");
      return null;
    } finally {
      statusEl.textContent = "";
    }
  }

  previewBtn.addEventListener("click", async () => {
    previewBtn.disabled = true;
    try {
      const blob = await buildBlob();
      if (!blob) return;
      if (_pdfMakerBlobUrl) URL.revokeObjectURL(_pdfMakerBlobUrl);
      _pdfMakerBlobUrl = URL.createObjectURL(blob);
      frame.src = _pdfMakerBlobUrl;
      previewWrap.classList.remove("d-none");
    } finally {
      previewBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    try {
      const blob = await buildBlob();
      if (blob) downloadBlob(blob, readOptions().filename);
    } finally {
      downloadBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    // Освобождаем blob-URL предпросмотра; настройки (заголовок, водяной
    // знак) намеренно сохраняются до перезагрузки страницы
    if (_pdfMakerBlobUrl) {
      URL.revokeObjectURL(_pdfMakerBlobUrl);
      _pdfMakerBlobUrl = null;
    }
    frame.src = "about:blank";
    previewWrap.classList.add("d-none");
  });

  void populateWatermarkOptions(modalEl.querySelector("#pdfMakerWatermark"));
  return modalEl;
}

// context: { getIds: () => string[], getChart?: () => EChartsInstance|null, filename?: string }
function openPdfMaker(context) {
  const modalEl = ensurePdfMakerModal();
  _pdfMakerContext = context || {};
  modalEl.querySelector("#pdfMakerAlert")?.classList.add("d-none");
  if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
}

function describeQuery(filters) {
  const parts = [];
  if (filters.q) parts.push(`поиск: «${filters.q}»`);
  if (filters.type) parts.push(`Тип: ${filters.type}`);
  if (filters.series) parts.push(`Типоразмер: ${filters.series}`);
  if (filters.diameter) parts.push(`Диаметр: ${filters.diameter} мм`);
  if (filters.minAirflow || filters.maxAirflow) parts.push(`Расход: ${filters.minAirflow || "—"}–${filters.maxAirflow || "—"} м³/ч`);
  if (filters.minPressure || filters.maxPressure) parts.push(`Давление: ${filters.minPressure || "—"}–${filters.maxPressure || "—"} Па`);
  if (filters.minPower || filters.maxPower) parts.push(`Мощность: ${filters.minPower || "—"}–${filters.maxPower || "—"} Вт`);
  if (filters.minPrice || filters.maxPrice) parts.push(`Цена: ${filters.minPrice || "—"}–${filters.maxPrice || "—"} ₽`);
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
    // 'catalog' — обычный список (сортировка на сервере, есть пагинация);
    // 'point' — подбор по рабочей точке (все результаты уже в браузере,
    // клик по заголовку колонки сортирует их без запроса к серверу)
    mode: "catalog",
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
      const row = button.closest("tr");
      if (row) row.classList.toggle("catalog-row-selected", selected);
    }
    const projectButtons = grid.querySelectorAll(".btn-project-toggle");
    for (const button of projectButtons) {
      const id = String(button.dataset.id || "");
      const inProject = state.projectIds.has(id);
      button.classList.toggle("btn-dark", inProject);
      button.classList.toggle("btn-outline-dark", !inProject);
      button.textContent = inProject ? "В проекте" : "В проект";
      button.title = inProject ? "Убрать из проекта" : "Добавить в проект";
      const row = button.closest("tr");
      if (row) row.classList.toggle("catalog-row-in-project", inProject);
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

    // Таблица каталога: клик по заголовку колонки сортирует по этому
    // параметру (повторный клик — в обратную сторону), строки сгруппированы
    // по модельному ряду. Один экран вмещает десятки моделей вместо 1-2
    // высоких карточек.
    const currentSort = String(sortSelect?.value || "");
    const COLUMNS = [
      { key: "model", label: "Модель", sortable: true },
      { key: "size", label: "Типоразмер", sortable: false },
      { key: "diameter", label: "⌀, мм", sortable: true, numeric: true },
      { key: "airflow", label: "Расход Q, м³/ч", sortable: true, numeric: true },
      { key: "pressure", label: "Давление P, Па", sortable: true, numeric: true },
      { key: "power", label: "Мощность, Вт", sortable: true, numeric: true },
      { key: "noise", label: "Шум, дБ", sortable: true, numeric: true },
      { key: "price", label: "Цена", sortable: true, numeric: true },
      { key: "_actions", label: "", sortable: false },
    ];

    const wrap = document.createElement("div");
    wrap.className = "table-responsive catalog-table-wrap";
    const table = document.createElement("table");
    table.className = "table table-hover align-middle catalog-table mb-0";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of COLUMNS) {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.numeric) th.classList.add("text-end");
      if (col.sortable) {
        th.classList.add("catalog-sortable");
        th.tabIndex = 0;
        th.setAttribute("role", "button");
        const active = currentSort === `${col.key}_asc` ? "asc" : currentSort === `${col.key}_desc` ? "desc" : "";
        if (active) th.dataset.sortDir = active;
        th.title = "Сортировать по этой колонке";
        const applySort = () => {
          const next = active === "asc" ? `${col.key}_desc` : `${col.key}_asc`;
          if (sortSelect) sortSelect.value = next;
          saveCatalogFilters(filtersForm, sortSelect);
          if (state.mode === "point") {
            renderProducts(sortItemsClient(state.currentItems, next), {
              total: state.lastTotal, page: 1, limit: state.lastLimit,
            });
          } else {
            loadPage(1);
          }
        };
        th.addEventListener("click", applySort);
        th.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            applySort();
          }
        });
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    function buildProductRow(p) {
      state.cacheById.set(p.id, p);
      const selected = state.selectedIds.has(p.id);
      const inProject = state.projectIds.has(p.id);
      const tr = document.createElement("tr");
      tr.className = `catalog-row${selected ? " catalog-row-selected" : ""}${inProject ? " catalog-row-in-project" : ""}`;

      const pointBadge = p._point
        ? `<div class="mt-1"><span class="badge ${p._point.reserve_percent < 0 ? "text-bg-warning" : (p._point.reserve_percent <= 15 ? "text-bg-success" : "text-bg-secondary")}">В точке: ${escapeHtml(formatNumber(p._point.p_available))} Па · ${p._point.reserve_percent < 0 ? "дефицит " + escapeHtml(Math.abs(p._point.reserve_percent)) : "запас " + escapeHtml(p._point.reserve_percent)}%</span></div>`
        : "";

      tr.innerHTML = `
        <td class="catalog-cell-model">
          <a href="product.html?id=${encodeURIComponent(p.id)}" class="fw-semibold">${escapeHtml(p.model || "Без названия")}</a>
          ${pointBadge}
        </td>
        <td class="text-secondary">${escapeHtml(p.size || "—")}</td>
        <td class="text-end">${p.diameter != null ? escapeHtml(formatNumber(p.diameter)) : "—"}</td>
        <td class="text-end text-nowrap">${escapeHtml(p.airflow?.raw || "—")}</td>
        <td class="text-end text-nowrap">${escapeHtml(p.pressure?.raw || "—")}</td>
        <td class="text-end">${p.power != null ? escapeHtml(formatNumber(p.power)) : "—"}</td>
        <td class="text-end">${p.noise_level != null ? escapeHtml(p.noise_level) : "—"}</td>
        <td class="text-end text-nowrap fw-semibold">${escapeHtml(formatPrice(p.price))}</td>
        <td class="text-end">
          <div class="d-flex gap-1 justify-content-end">
            <button type="button" class="btn btn-sm btn-project-toggle ${inProject ? "btn-dark" : "btn-outline-dark"}" data-id="${escapeHtml(p.id)}" title="${inProject ? "Убрать из проекта" : "Добавить в проект"}">
              ${inProject ? "В проекте" : "В проект"}
            </button>
            <button type="button" class="btn btn-sm btn-compare-toggle ${selected ? "btn-dark" : "btn-outline-dark"}" data-id="${escapeHtml(p.id)}">
              ${selected ? "В сравнении" : "Сравнить"}
            </button>
          </div>
        </td>
      `;

      tr.querySelector(".btn-project-toggle")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleProjectSelection(p.id);
      });
      tr.querySelector(".btn-compare-toggle")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSelection(p.id);
      });
      // Вся строка кликабельна (кроме кнопок) — открывает карточку модели
      tr.addEventListener("click", (event) => {
        if (event.target.closest("button, a, select, input")) return;
        window.location.href = `product.html?id=${encodeURIComponent(p.id)}`;
      });
      return tr;
    }

    // Группировка по модельному ряду: строки одного ряда собираются подряд
    // под общей строкой-заголовком, сохраняя порядок первого появления ряда.
    const groups = new Map();
    for (const p of state.currentItems) {
      const key = familyKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    for (const [key, items] of groups) {
      if (groups.size > 1) {
        const groupRow = document.createElement("tr");
        groupRow.className = "catalog-group-row";
        groupRow.innerHTML = `
          <td colspan="${COLUMNS.length}">
            <span class="fw-bold">${escapeHtml(key || "Прочие")}</span>
            <span class="text-secondary small ms-2">${items.length} ${pluralRu(items.length, "модель", "модели", "моделей")}</span>
          </td>
        `;
        tbody.appendChild(groupRow);
      }
      for (const p of items) {
        tbody.appendChild(buildProductRow(p));
      }
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    grid.appendChild(wrap);

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
    state.mode = "catalog";
    state.currentPage = page;
    state.filters = parseFilters(filtersForm);
    saveCatalogFilters(filtersForm, sortSelect);
    state.querySummaryText = describeQuery(state.filters);
    if (querySummary) querySummary.textContent = state.querySummaryText;

    try {
      // Все ключи сортировки таблицы понимает сервер (см. SORT_STRATEGIES
      // в product_repository.py) — сортируется весь каталог, а не страница
      const requestedSort = /^[a-z]+_(asc|desc)$/.test(String(sortSelect?.value || ""))
        ? sortSelect.value
        : "price_asc";
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(state.filters)) {
        if (k !== "sort") params.set(k, String(v));
      }
      params.set("sort", requestedSort);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));

      const data = await fetchJson(apiUrl(`/api/products?${params.toString()}`));
      const items = Array.isArray(data?.items) ? data.items : [];
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
    // Если задана рабочая точка — фильтры не заменяют подбор, а сужают его:
    // «по точке И по названию/типу/цене» работают вместе
    const pq = toNumber(pointQInput?.value);
    const pp = toNumber(pointPInput?.value);
    if (pq > 0 && pp > 0) {
      const tol = Math.min(Math.max(toNumber(pointTolInput?.value) || 0, 0), 50);
      runPointSearch(pq, pp, tol);
    } else {
      loadPage(1);
    }
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
    // Обычные фильтры каталога сужают подбор по точке (совместный поиск).
    // Диапазоны расхода/давления не передаём: расход задан самой точкой Q.
    const POINT_COMPATIBLE_FILTERS = [
      "q", "type", "series", "diameter",
      "minPrice", "maxPrice", "minPower", "maxPower", "minNoise", "maxNoise",
    ];
    const extraFilters = parseFilters(filtersForm);
    saveCatalogFilters(filtersForm, sortSelect);
    const activeExtra = POINT_COMPATIBLE_FILTERS.filter((k) => extraFilters[k] != null);
    const tolText = pointTol > 0 ? ` · допуск ±${formatNumber(pointTol)}%` : "";
    const extraText = activeExtra.length ? ` · фильтры: ${describeQuery(
      Object.fromEntries(activeExtra.map((k) => [k, extraFilters[k]])),
    )}` : "";
    state.querySummaryText = `Рабочая точка: Q = ${formatNumber(pointQ)} м³/ч · P = ${formatNumber(pointP)} Па${tolText}${extraText}`;
    if (querySummary) querySummary.textContent = state.querySummaryText;
    try {
      const params = new URLSearchParams({
        point_q: String(pointQ), point_p: String(pointP), limit: String(PAGE_SIZE),
      });
      if (pointTol > 0) params.set("tolerance", String(pointTol));
      for (const k of activeExtra) params.set(k, String(extraFilters[k]));
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
        state.mode = "point";
        renderProducts(sortItemsClient(items, sortSelect?.value), {
          total: items.length, page: 1, limit: Math.max(items.length, 1),
        });
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

  // Обработчик «Поделиться» глобальный (initShareLinkButton) — кнопка есть
  // в шапке каждой страницы, а не только каталога

  const urlQ = new URLSearchParams(window.location.search).get("q");
  if (urlQ) {
    const trimmed = String(urlQ).trim();
    if (filtersForm?.elements.q) filtersForm.elements.q.value = trimmed;
    if (headerSearchInput) headerSearchInput.value = trimmed;
  }

  try {
    setLoading(true);
    await loadFacets();
    // Фильтры переживают уход на карточку и возврат: восстанавливаем из
    // sessionStorage ПОСЛЕ loadFacets (селекты типа/диаметра к этому моменту
    // уже наполнены опциями), но НЕ перетирая явный ?q= из URL
    restoreCatalogFilters(filtersForm, sortSelect);
    if (headerSearchInput && filtersForm?.elements.q?.value && !headerSearchInput.value) {
      headerSearchInput.value = filtersForm.elements.q.value;
    }
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

    // Кастомный PDF-мейкер («Документ для клиента») доступен прямо со
    // страницы сравнения — не нужно идти в «Мой проект»
    exportPdfBtn?.addEventListener("click", () => {
      if (!products.length) {
        showError("Для экспорта выберите хотя бы одну модель.");
        return;
      }
      hideError();
      openPdfMaker({
        getIds: () => products.map((p) => String(p.id)).filter(Boolean),
        getChart: () => compareChart,
        filename: "ventsearch-compare.pdf",
      });
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

    // Служебные идентификаторы (ID, номер строки CSV) конечному клиенту не
    // показываем — это внутренние маркеры базы, они есть в админке
    const specBody = $("#specTableBody");
    specBody.innerHTML = "";
    const specs = [
      ["Тип", data.type],
      ["Модель", data.model],
      ["Типоразмер (двигатель)", data.size],
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

    // Габаритно-присоединительные размеры (чертёж завода): ячейка на размер
    // вместо одной длинной строки цифр — так каждую пару «буква-значение»
    // видно сразу, без сопоставления по вертикали через всю таблицу.
    const dims = data.dimensions;
    if (dims && typeof dims === "object" && Object.keys(dims).length) {
      const entries = Object.entries(dims);
      const grid = $("#dimensionsGrid");
      if (grid) {
        grid.innerHTML = entries
          .map(([label, value]) => `
            <div class="dim-cell">
              <div class="dim-cell-label">${escapeHtml(label)}</div>
              <div class="dim-cell-value">${escapeHtml(value)}</div>
            </div>`)
          .join("");
        $("#dimensionsCard")?.classList.remove("d-none");
      }
      $("#gabaritsCaption")?.replaceChildren(document.createTextNode(`${entries.length} размеров — блок выше на этой странице`));
    }

    // Чертёж из каталога: если в photos/ лежит blueprint_<слаг-модели>.png
    // (или .jpg/.jpeg/.webp) — показываем его; иначе шаблон-заглушку «синьки».
    await renderProductBlueprint(data);

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

    $("#exportProductPdfBtn")?.addEventListener("click", () => {
      const slug = currentProduct?._meta?.model_slug || currentProduct?.meta?.model_slug || currentProduct.id;
      openPdfMaker({
        getIds: () => [String(currentProduct.id)],
        getChart: () => productChart,
        filename: `ventsearch-${slug}.pdf`,
      });
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

// Список файлов photos/ (те же версии, что и для фото вентиляторов) — из них
// пользователь выбирает водяной знак для PDF-документа клиенту.
const WATERMARK_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

async function populateWatermarkOptions(selectEl) {
  if (!selectEl) return;
  try {
    const versions = await ensurePhotosVersionLoaded();
    const names = Object.keys(versions || {}).filter((n) => WATERMARK_EXT_RE.test(n)).sort();
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    }
  } catch (err) {
    console.warn("Не удалось загрузить список файлов для водяного знака", err);
  }
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

  // Единый PDF-мейкер (тот же, что на сравнении и карточке товара):
  // заголовок, водяной знак, предпросмотр и скачивание — в одном окне
  exportProjectPdfBtn?.addEventListener("click", () => {
    hideMessages();
    if (!currentProducts.length) {
      showError("Добавьте хотя бы одну модель в проект.");
      return;
    }
    openPdfMaker({
      getIds: () => currentProducts.map((p) => String(p.id)).filter(Boolean),
      filename: "ventsearch-project.pdf",
    });
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

// Инсайдерский/демо-режим (DEMO_MODE на бэкенде, см. /api/health): каталожные
// данные визуально скрыты для показа интерфейса внешним людям без раскрытия
// реальных цен/характеристик. Помечаем элементы атрибутом data-demo-guard.
async function applyDemoModeGuardIfNeeded() {
  const targets = document.querySelectorAll("[data-demo-guard]");
  if (!targets.length) return;
  try {
    const health = await fetchJson(apiUrl("/api/health"));
    if (!health?.demo_mode) return;
  } catch (err) {
    console.warn("Не удалось проверить демо-режим", err);
    return;
  }
  targets.forEach((el) => {
    el.classList.add("vs-demo-guard-wrap");
    const overlay = document.createElement("div");
    overlay.className = "vs-demo-guard-overlay";
    const label = document.createElement("div");
    label.className = "vs-demo-guard-label";
    label.textContent = "Недоступно в инсайдерской версии.";
    overlay.appendChild(label);
    el.appendChild(overlay);
  });
}

// Плавающий контакт-виджет (правый нижний угол): кому писать по вопросам.
// Данные — из data/credits.json через публичный /api/contacts; если файла
// нет или он пуст, показываем общий почтовый контакт проекта.
function initContactWidget() {
  if (document.getElementById("vsContactFab")) return;
  const fab = document.createElement("button");
  fab.id = "vsContactFab";
  fab.className = "vs-contact-fab";
  fab.type = "button";
  fab.title = "Контакты";
  fab.setAttribute("aria-label", "Контакты");
  fab.textContent = "✉";
  document.body.appendChild(fab);

  let card = null;
  let loaded = false;


  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function contactLine(contact) {
    const value = String(contact || "").trim();
    if (!value) return "";
    return EMAIL_RE.test(value)
      ? `<a href="mailto:${encodeURIComponent(value).replace(/%40/g, "@")}">${escapeHtml(value)}</a>`
      : escapeHtml(value);
  }


  async function fillCard(el) {
    let html = "";
    try {
      const d = await fetchJson(apiUrl("/api/contacts"));
      const creators = Array.isArray(d?.creators) ? d.creators : [];
      if (creators.length) {
        html = creators.map((c) => `
          <div class="mb-2">
            <div class="fw-semibold small">${escapeHtml(c.name || "—")}</div>
            ${c.role ? `<div class="text-secondary" style="font-size:.78rem;">${escapeHtml(c.role)}</div>` : ""}

            ${c.contact ? `<div class="small">${contactLine(c.contact)}</div>` : ""}

          </div>`).join("");
      }
    } catch (err) {
      console.warn("Не удалось загрузить контакты", err);
    }
    if (!html) {

      html = `<div class="small">По всем вопросам: <a href="mailto:${VENTSEARCH_TEAM_EMAIL}">${VENTSEARCH_TEAM_EMAIL}</a></div>`;
    }
    const writeBtn = `
      <a class="btn btn-sm btn-dark w-100 mt-2" href="mailto:${VENTSEARCH_TEAM_EMAIL}?subject=${encodeURIComponent("Вопрос по VENTSEARCH")}">
        Написать разработчикам
      </a>`;
    el.innerHTML = `<div class="fw-bold mb-2">Кому писать</div>${html}${writeBtn}`;

  }

  fab.addEventListener("click", () => {
    if (!card) {
      card = document.createElement("div");
      card.className = "vs-contact-card d-none";
      card.innerHTML = '<div class="text-secondary small">Загрузка…</div>';
      document.body.appendChild(card);
    }
    const willShow = card.classList.contains("d-none");
    card.classList.toggle("d-none");
    fab.textContent = willShow ? "✕" : "✉";
    if (willShow && !loaded) {
      loaded = true;
      fillCard(card);
    }
  });
}

// «Поделиться» — в шапке каждой страницы, поэтому обработчик глобальный
// (раньше вешался только в initCatalogPage и работал лишь на главной)
function initShareLinkButton() {
  const btn = document.getElementById("shareLinkBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const data = await fetchJson(apiUrl("/api/share-links"));
      const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
      if (!urls.length) {
        window.alert("Не удалось сгенерировать ссылку для локальной сети.");
        return;
      }
      // Делимся текущей страницей, а не корнем: путь и параметры сохраняем,
      // подменяем только хост на реально доступный из сети
      const first = urls[0];
      let shareUrl = first;
      try {
        const base = new URL(first);
        shareUrl = `${base.origin}${window.location.pathname}${window.location.search}`;
      } catch { /* оставляем как есть */ }
      const copied = await copyTextToClipboard(shareUrl);
      const status = copied
        ? "Ссылка скопирована в буфер обмена:"
        : "Не удалось скопировать автоматически (браузер блокирует буфер обмена вне HTTPS/localhost) — скопируйте вручную:";
      const text = `${status}\n${shareUrl}\n\nДоступные адреса:\n${urls.join("\n")}`;
      window.alert(text);
    } catch (err) {
      console.error(err);
      window.alert("Не удалось сгенерировать ссылку. Проверьте доступность API.");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyDemoModeGuardIfNeeded();
  initShareLinkButton();
  initContactWidget();
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
