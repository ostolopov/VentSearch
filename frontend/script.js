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

// Скрытые колонки таблицы каталога (например, «Цена») — запоминаем выбор
const CATALOG_HIDDEN_COLS_KEY = "ventsearch.catalog.hiddenCols";

function loadHiddenCols() {
  try {
    const raw = localStorage.getItem(CATALOG_HIDDEN_COLS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveHiddenCols(set) {
  try {
    localStorage.setItem(CATALOG_HIDDEN_COLS_KEY, JSON.stringify([...set]));
  } catch {
    // приватный режим — не запоминаем
  }
}

// Фильтры каталога переживают переход на карточку товара и возврат назад.
// localStorage, а не sessionStorage: карточки часто открывают в НОВОЙ вкладке
// (Ctrl+клик), а sessionStorage живёт только внутри одной вкладки — из-за
// этого фильтры «сбрасывались». Кнопка «Сбросить» очищает сохранённое.
const CATALOG_FILTERS_KEY = "ventsearch.catalog.filters";

function saveCatalogFilters(form, sortSelect) {
  if (!form) return;
  try {
    const data = {};
    for (const el of form.elements) {
      if (el.name && String(el.value || "").trim()) data[el.name] = el.value;
    }
    if (sortSelect?.value) data.__sort = sortSelect.value;
    localStorage.setItem(CATALOG_FILTERS_KEY, JSON.stringify(data));
  } catch {
    // приватный режим — просто не запоминаем
  }
}

function restoreCatalogFilters(form, sortSelect) {
  if (!form) return;
  try {
    // Читаем localStorage, а из sessionStorage подхватываем то, что могло
    // остаться от предыдущей версии (миграция без потери фильтров)
    const raw = localStorage.getItem(CATALOG_FILTERS_KEY) || sessionStorage.getItem(CATALOG_FILTERS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [k, v] of Object.entries(data)) {
      if (k === "__sort") {
        if (sortSelect && !sortSelect.dataset.userSet) sortSelect.value = String(v);
        continue;
      }
      const el = form.elements[k];
      // Только пустые поля — явный ?q= из URL и введённое руками не трогаем
      if (el && !String(el.value || "").trim()) {
        let value = String(v);
        // Миграция: поле мощности раньше было в Вт, теперь в кВт.
        // Каталожный максимум — 110 кВт, так что >1000 — это старые Вт.
        if ((k === "minPower" || k === "maxPower") && Number(value) > 1000) {
          value = String(Number(value) / 1000);
        }
        el.value = value;
      }
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

// Мощность храним в Вт (как в CSV), а инженеру показываем в кВт: «5,5 кВт»
function formatPowerKw(watts) {
  const w = Number(watts);
  if (watts === null || watts === undefined || Number.isNaN(w)) return "\u2014";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(w / 1000)}\u00A0кВт`;
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

// Присоединительные размеры: группировка обозначений по смыслу — так глаз
// сразу находит нужную букву, вместо сопоставления «каши» цифр с чертежом.
// Num не показываем здесь (он уходит в характеристики как номер вентилятора).
const DIMENSION_GROUPS = [
  { title: "Габаритные размеры", keys: ["B", "H", "H1", "L", "L1 max", "L1", "L2", "l", "b"] },
  { title: "Диаметры", keys: ["D", "D1", "d", "d1"] },
];

function renderProductDimensions(dims) {
  const wrap = document.getElementById("dimensionsGrid");
  if (!wrap) return;
  const entries = Object.entries(dims || {}).filter(([k]) => k !== "Num");
  if (!entries.length) return;

  const used = new Set();
  const groups = [];
  for (const group of DIMENSION_GROUPS) {
    const rows = [];
    for (const key of group.keys) {
      const found = entries.find(([k]) => k === key);
      if (found) {
        rows.push(found);
        used.add(key);
      }
    }
    if (rows.length) groups.push({ title: group.title, rows });
  }
  const rest = entries.filter(([k]) => !used.has(k));
  if (rest.length) groups.push({ title: "Монтаж и прочее", rows: rest });

  wrap.innerHTML = groups
    .map((g) => `
      <div class="dims-table-block">
        <div class="dims-table-title">${escapeHtml(g.title)}</div>
        <table class="dims-table">
          <thead><tr><th>Обозн.</th><th>Значение, мм</th></tr></thead>
          <tbody>
            ${g.rows.map(([k, v]) => `<tr><td class="dims-code">${escapeHtml(k)}</td><td class="dims-val">${escapeHtml(v)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`)
    .join("");
  document.getElementById("dimensionsCard")?.classList.remove("d-none");
  document.getElementById("gabaritsCaption")?.replaceChildren(
    document.createTextNode(`${entries.length} размеров — блок выше на этой странице`),
  );
}

// Полноэкранный просмотр изображения (чертёж, фото) в модальном окне
function openImageLightbox(src, alt) {
  let modalEl = document.getElementById("imageLightboxModal");
  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.className = "modal fade";
    modalEl.id = "imageLightboxModal";
    modalEl.tabIndex = -1;
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content bg-transparent border-0 shadow-none">
          <img id="imageLightboxImg" src="" alt="" style="max-width: 100%; max-height: 92vh; object-fit: contain; border-radius: 10px; background: #fff;" />
        </div>
      </div>`;
    modalEl.addEventListener("click", () => {
      if (typeof bootstrap !== "undefined") bootstrap.Modal.getInstance(modalEl)?.hide();
    });
    document.body.appendChild(modalEl);
  }
  const img = modalEl.querySelector("#imageLightboxImg");
  img.src = src;
  img.alt = alt || "";
  if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
}

// Служебная подсказка «как заменить заглушку чертежа» — только для
// администраторов: обычному клиенту инструкции про photos/ не нужны.
// Признак админа — пункт «Управление каталогом» в меню (site-auth.js
// снимает с него d-none после проверки сессии, поэтому наблюдаем за классом).
function revealAdminHintWhenAdmin(hintEl) {
  const adminItem = document.getElementById("navAdminMenuItem");
  if (!hintEl || !adminItem) return;
  const sync = () => hintEl.classList.toggle("d-none", adminItem.classList.contains("d-none"));
  sync();
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(sync).observe(adminItem, { attributes: true, attributeFilter: ["class"] });
  }
}

// Чертёж модели из бумажного каталога. Скрин кладётся в photos/ с именем
// blueprint_<слаг-модели>.png (точное ожидаемое имя видно администратору в
// подсказке под блоком) — появится на карточке сам, без правок кода. Пока
// файла нет, показываем шаблон-заглушку «синьки» (frontend/img/blueprint-placeholder.svg).
const BLUEPRINT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// Ищет в photos/ файл <base>_<slug>.<ext>, затем общий <base>.<ext>.
// Возвращает готовый src (с ?v=mtime) или null.
function findPhotoVariant(versions, base, slug) {
  const candidates = [];
  for (const ext of BLUEPRINT_EXTENSIONS) candidates.push(`${base}_${slug}.${ext}`);
  for (const ext of BLUEPRINT_EXTENSIONS) candidates.push(`${base}.${ext}`);
  for (const name of candidates) {
    if (versions && Object.prototype.hasOwnProperty.call(versions, name)) {
      const version = versions[name];
      return { name, src: `${apiUrl(`/photos/${encodeURIComponent(name)}`)}${version ? `?v=${version}` : ""}` };
    }
  }
  return null;
}

async function renderProductBlueprint(product) {
  const card = document.getElementById("blueprintCard");
  const img = document.getElementById("blueprintImage");
  const valsImg = document.getElementById("blueprintValsImage");
  const hint = document.getElementById("blueprintHint");
  if (!card || !img) return;

  const slug = String(
    product?._meta?.model_slug || product?.meta?.model_slug || slugify(product?.model) || product?.id || "",
  ).trim().toLowerCase();

  const versions = await ensurePhotosVersionLoaded();
  const drawing = findPhotoVariant(versions, "blueprint", slug);
  const vals = findPhotoVariant(versions, "blueprintVals", slug);

  // Левая картинка — сам чертёж; заглушка-«синька», если файла ещё нет
  if (drawing) {
    img.src = drawing.src;
    img.alt = `Чертёж ${product?.model || ""}`.trim();
  } else {
    img.src = "img/blueprint-placeholder.svg";
    img.alt = "Чертёж появится позже";
  }
  img.addEventListener("click", () => openImageLightbox(img.src, img.alt));

  // Правая картинка — таблица подробных значений (blueprintVals)
  if (valsImg) {
    if (vals) {
      valsImg.src = vals.src;
      valsImg.alt = `Значения чертежа ${product?.model || ""}`.trim();
    } else {
      valsImg.src = "img/blueprint-vals-placeholder.svg";
      valsImg.alt = "Таблица значений появится позже";
    }
    valsImg.addEventListener("click", () => openImageLightbox(valsImg.src, valsImg.alt));
  }

  if (hint) {
    // Стилизованная подпись только для администратора (тег [ДЕБАГ])
    hint.classList.add("vs-debug-note");
    hint.innerHTML =
      `<span class="vs-debug-tag">[ДЕБАГ]</span> Файлы чертежа берутся из <code>photos/</code>: ` +
      `<code>blueprint_${escapeHtml(slug)}.png</code> — сам чертёж, ` +
      `<code>blueprintVals_${escapeHtml(slug)}.png</code> — таблица значений. ` +
      `Подойдут и общие <code>blueprint.png</code> / <code>blueprintVals.png</code>.`;
  }
  revealAdminHintWhenAdmin(hint);
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

// Прижимает «хвост» кривой (последние ~25% по расходу) к монотонному спаду,
// чтобы у конца линии не было «отскока» вверх (артефакт параметрической кривой
// у некоторых моделей). Седловину в середине (провал/горб осевых) не трогаем.
function clampCurveTail(points) {
  if (!Array.isArray(points) || points.length < 4) return points;
  const start = Math.floor(points.length * 0.75);
  for (let i = Math.max(1, start); i < points.length; i += 1) {
    if (points[i][1] > points[i - 1][1]) points[i][1] = points[i - 1][1];
  }
  return points;
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
    // Хвост — строго вниз: убирает «отскок» у конца линии. Сами 200 точек уже
    // лежат на аналитической кривой, поэтому дополнительное сглаживание
    // ECharts (smooth) не нужно — оно и давало overshoot на концах.
    clampCurveTail(points);

    const color = familyMode ? (isPrimary ? "#0d6efd" : "#c3ccd6") : colors[idx % colors.length];
    const siblingLabel = p.size || p.model || p.id;
    const curveName = familyMode && !isPrimary ? siblingLabel : (p.model || p.id);

    series.push({
      // В модельном ряду соседние типоразмеры подписаны коротко (по размеру) —
      // полное имя модели остаётся только у выделенной кривой
      name: curveName,
      type: 'line',
      smooth: false,
      symbol: 'none',
      // Появление рисует линию от её начала (qMin) слева направо, а не с 0,0
      animationDuration: 650,
      animationEasing: 'cubicOut',
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
      // Полоса — custom-полигон. Стек из line-серий выглядел бы «живее»
      // (анимируется зумом), но стек ECharts на value-оси X рисует полосу
      // с грубыми артефактами (проверено на минимальном примере) — это
      // ограничение движка: официальный пример confidence-band работает
      // только с category-осью. Синхронность полосы с кривой при сбросе
      // масштаба обеспечивает сам сброс: он перерисовывает график целиком
      // (см. myReset), а не морфит оси под ногами у полигона.
      series.push({
        // Та же name, что у кривой: одна запись легенды скрывает и линию, и
        // её зону допуска (ECharts переключает все серии с этим именем).
        // Маркеры ниже убирают полосу из подсказки и второй записи легенды.
        name: curveName,
        __isBand: true,
        type: 'custom',
        silent: true,
        tooltip: { show: false },
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

  let networkPoints = null;
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
    networkPoints = systemPoints;

    series.push({
      name: 'Кривая сети',
      type: 'line',
      smooth: false,
      symbol: 'none',
      // Тёплый медный цвет: кривая сети и рабочая точка — «действие»,
      // они должны отделяться от холодных паспортных кривых вентиляторов
      lineStyle: { type: 'dashed', color: '#B45309', width: 2 },
      itemStyle: { color: '#B45309' },
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

  // Пунктиры начала и конца рабочего диапазона выделенной кривой: вертикальные
  // линии на qMin/qMax — сразу видно рабочую зону вентилятора по расходу.
  const rangeCurve = products.length === 1
    ? productCurves[0]
    : (productCurves.find((c) => c.isPrimary) || (!familyMode ? null : productCurves[0]));
  if (rangeCurve && rangeCurve.points.length >= 2) {
    const qStart = rangeCurve.points[0][0];
    const qEnd = rangeCurve.points[rangeCurve.points.length - 1][0];
    const pStartTop = Math.max(...rangeCurve.points.map((pt) => pt[1]));
    for (const [gname, qv] of [["guide-range-min", qStart], ["guide-range-max", qEnd]]) {
      series.push({
        name: gname,
        type: 'line',
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color: '#94a3b8', width: 1, opacity: 0.7 },
        data: [[qv, 0], [qv, pStartTop]],
        z: 1,
      });
    }
  }

  // Лёгкая анимация: полупрозрачный бегунок ВДОЛЬ САМИХ КРИВЫХ (и кривой сети),
  // а не по оси Q — «движение потока» по характеристике. Служебные серии
  // guide-flow не попадают ни в легенду, ни в подсказку, ни в PDF.
  function downsample(pts, n = 48) {
    if (pts.length <= n) return pts.map((p) => [p[0], p[1]]);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
    return out.map((p) => [p[0], p[1]]);
  }
  const flowSources = productCurves
    .filter((c) => c.points.length >= 2)
    .map((c) => ({ coords: downsample(c.points), color: c.color }));
  if (networkPoints && networkPoints.length >= 2) {
    flowSources.push({ coords: downsample(networkPoints), color: '#B45309' });
  }
  flowSources.forEach((src, i) => {
    const rgb = src.color === '#B45309' ? '180, 83, 9' : '37, 99, 235';
    series.push({
      name: `guide-flow-${i}`,
      type: 'lines',
      coordinateSystem: 'cartesian2d',
      silent: true,
      z: 6,
      polyline: true,
      effect: {
        show: true,
        period: 5,
        trailLength: 0.4,
        symbol: 'circle',
        symbolSize: 4,
        color: `rgba(${rgb}, 0.45)`,
      },
      lineStyle: { color: `rgba(${rgb}, 0)`, width: 0, opacity: 0 },
      data: [{ coords: src.coords }],
    });
  });

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
  let focusMinQ = Infinity;
  let focusMinP = Infinity;
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
        if (q != null && q < focusMinQ) focusMinQ = q;
        if (pv != null && pv < focusMinP) focusMinP = pv;
      }
    }
  }
  if (!focusMaxQ) focusMaxQ = dataMaxQ;
  if (!focusMaxP) focusMaxP = dataMaxP;
  if (targetPoint?.q > focusMaxQ) focusMaxQ = targetPoint.q;
  if (targetPoint?.p > focusMaxP) focusMaxP = targetPoint.p;
  if (targetPoint?.q > 0 && targetPoint.q < focusMinQ) focusMinQ = targetPoint.q;
  if (targetPoint?.p > 0 && targetPoint.p < focusMinP) focusMinP = targetPoint.p;
  if (targetPoint?.q > dataMaxQ) dataMaxQ = targetPoint.q;
  if (targetPoint?.p > dataMaxP) dataMaxP = targetPoint.p;
  const xMax = dataMaxQ > 0 ? Math.ceil(dataMaxQ * 1.15) : undefined;
  const yMax = dataMaxP > 0 ? Math.ceil(dataMaxP * 1.18) : undefined;
  const xFocusEnd = focusMaxQ > 0 ? Math.ceil(focusMaxQ * 1.15) : undefined;
  const yFocusEnd = focusMaxP > 0 ? Math.ceil(focusMaxP * 1.18) : undefined;

  // Стартовое окно НЕ обязано начинаться с нуля: если кривые лежат, скажем,
  // в 23 456–45 678 м³/ч, слева была бы мёртвая пустая зона. Начало осей
  // округляем вниз (Q — к тысяче, P — к «инженерному» шагу), но ноль
  // сохраняем, когда данные и так начинаются близко к нему — иначе обрезка
  // почти ничего не даёт, а масштаб восприятия искажает.
  const floorTo = (v, step) => Math.max(0, Math.floor(v / step) * step);
  let xFocusStart = 0;
  if (Number.isFinite(focusMinQ) && focusMaxQ > 0 && focusMinQ >= 0.18 * focusMaxQ) {
    xFocusStart = floorTo(focusMinQ, 1000);
  }
  let yFocusStart = 0;
  if (Number.isFinite(focusMinP) && focusMaxP > 0 && focusMinP >= 0.3 * focusMaxP) {
    const stepP = focusMaxP > 500 ? 50 : focusMaxP > 150 ? 20 : 10;
    // 0.9 — чтобы нижняя граница зоны допуска (-7,5% и больше) не легла
    // ровно на край окна
    yFocusStart = floorTo(focusMinP * 0.9, stepP);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 },
      // Служебные серии (зона допуска, курсорные линии) в подсказку не
      // попадают: полосы допуска — line-серии с именем кривой, отсеиваем
      // их по индексу серии (bandSeriesIdx), а не по имени
      formatter: (params) => {
        const bandSeriesIdx = new Set(series.map((s, i) => (s.__isBand ? i : -1)).filter((i) => i >= 0));
        const list = (Array.isArray(params) ? params : [params])
          .filter((pr) => pr && pr.seriesName
            && !bandSeriesIdx.has(pr.seriesIndex)
            && pr.seriesType !== 'custom'
            && !isServiceSeriesName(pr.seriesName));
        if (!list.length) return '';
        const first = Array.isArray(list[0].value) ? list[0].value[0] : null;
        const head = first != null ? `Q = ${formatNumber(first)} м³/ч` : '';
        const rows = list.map((pr) => {
          const v = Array.isArray(pr.value) ? pr.value[1] : pr.value;
          // Давление округляем до целых Па: «296,648 Па» читается как тысячи
          const pInt = v != null ? Math.round(Number(v)) : null;
          return `${pr.marker} ${escapeHtml(pr.seriesName)}: <b>${formatNumber(pInt)} Па</b>`;
        });
        return [head, ...rows].filter(Boolean).join('<br/>');
      }
    },
    legend: {
      bottom: 0,
      // Полосы допуска (__isBand) делят имя с кривой — в легенду включаем имя
      // один раз (dedupe), чтобы у него была одна запись, гасящая обе серии
      data: [...new Set(
        series
          .filter((s) => s.name && !isServiceSeriesName(s.name) && !s.__hideLegend && !s.__isBand)
          .map((s) => s.name),
      )],
      textStyle: { fontFamily: qpChartFontFamily, fontSize: 12 }
    },
    // Зум по X и Y независим: колесо мыши — по Q (основная ось), а по Y —
    // свой ползунок справа (перетаскивание не задевает масштаб по X)
    // Стартовое окно зума — «фокус» по значимым кривым (см. расчёт выше):
    // выбранная модель занимает весь график, а не зажата в углу полной шкалы
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true, startValue: xFocusStart, endValue: xFocusEnd },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseMove: false, startValue: yFocusStart, endValue: yFocusEnd },
      { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 14, bottom: 26, brushSelect: false, startValue: xFocusStart, endValue: xFocusEnd },
      { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 14, right: 8, brushSelect: false, showDataShadow: false, startValue: yFocusStart, endValue: yFocusEnd }
    ],
    toolbox: {
      feature: {
        // Встроенную «лупу с шаговым откатом» убрали: её back вёл себя как
        // Ctrl+Z и не сбрасывал масштаб после зума мышью. Зум — колесом,
        // а «myReset» возвращает СРАЗУ в исходное окно (по выбранной модели).
        myReset: {
          show: true,
          title: 'Исходный масштаб',
          icon: 'path://M512 128a384 384 0 1 0 384 384h-80a304 304 0 1 1-89-215l-79 79h248V107l-90 90A382 382 0 0 0 512 128z',
          onclick: () => {
            // Сброс = полная перерисовка в исходное окно, как при загрузке
            // страницы. Морфить оси dataZoom-экшеном нельзя: кривые (line)
            // анимировались бы, а полоса допуска (custom-полигон) прыгала бы
            // в конечное положение мгновенно, отклеиваясь от своей кривой.
            chartRef.clear();
            chartRef.setOption(option, true);
          },
        },
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
      axisLine: { show: true, lineStyle: { color: '#334155' } },
      axisTick: { show: true, lineStyle: { color: '#334155' } },
      splitLine: { show: true, lineStyle: { color: '#d5dde6', width: 1 } },
      minorTick: { show: true, splitNumber: 2 },
      minorSplitLine: { show: true, lineStyle: { type: 'dashed', color: '#eef2f6' } },
      axisLabel: { fontFamily: qpChartFontFamily, color: '#475569', formatter: (val) => formatNumber(val) },
      nameTextStyle: { fontFamily: qpChartFontFamily, fontWeight: '600', fontSize: 13, color: '#334155' }
    },
    yAxis: {
      name: 'Давление (P), Па',
      nameLocation: 'end',
      type: 'value',
      min: 0,
      max: yMax,
      axisLine: { show: true, lineStyle: { color: '#334155' } },
      axisTick: { show: true, lineStyle: { color: '#334155' } },
      splitLine: { show: true, lineStyle: { color: '#d5dde6', width: 1 } },
      minorTick: { show: true, splitNumber: 2 },
      minorSplitLine: { show: true, lineStyle: { type: 'dashed', color: '#eef2f6' } },
      axisLabel: { fontFamily: qpChartFontFamily, color: '#475569', formatter: (val) => formatNumber(val) },
      nameTextStyle: { fontFamily: qpChartFontFamily, fontWeight: '600', fontSize: 13, color: '#334155' }
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
      show_title: !!options.showTitle,
      letterhead: !!options.letterhead,
      letterhead_all_pages: !!options.letterheadAllPages,
      builds: Array.isArray(options.builds) ? options.builds : [],
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
  // Текущие видимые пределы осей: в PDF график должен совпадать с тем, что
  // пользователь видит на экране (фокус по выбранной модели), а не с полной
  // шкалой всего модельного ряда до сотен тысяч Q
  let xExtent = null;
  let yExtent = null;
  try {
    xExtent = sourceChart.getModel().getComponent('xAxis', 0).axis.scale.getExtent();
    yExtent = sourceChart.getModel().getComponent('yAxis', 0).axis.scale.getExtent();
  } catch (err) {
    console.warn('Не удалось прочитать видимые пределы осей для PDF', err);
  }
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
    // Подсказка «Колесо — зум по Q…» и анимированный бегунок — только для
    // экрана: в статичном PDF они не нужны и мешают
    opts.graphic = [];
    if (Array.isArray(opts.series)) {
      opts.series = opts.series.filter((s) => !isServiceSeriesName(s && s.name) || !String(s.name).startsWith('guide-flow'));
    }
    if (Array.isArray(xExtent) && xExtent.length === 2 && Array.isArray(opts.xAxis) && opts.xAxis[0]) {
      opts.xAxis[0].min = xExtent[0];
      opts.xAxis[0].max = xExtent[1];
    }
    if (Array.isArray(yExtent) && yExtent.length === 2 && Array.isArray(opts.yAxis) && opts.yAxis[0]) {
      opts.yAxis[0].min = yExtent[0];
      opts.yAxis[0].max = yExtent[1];
    }
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
          <h2 class="modal-title h6">Просмотр PDF</h2>
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
              <label class="form-label text-secondary small mb-1">
                Водяной знак компании (файл из папки photos/)
              </label>
              <div class="dropdown w-100">
                <button class="btn btn-outline-secondary dropdown-toggle w-100 d-flex align-items-center gap-2 text-start" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" id="pdfMakerWmBtn">
                  <img id="pdfMakerWmThumb" alt="" style="width:26px;height:26px;object-fit:contain;display:none;border-radius:4px;background:#f1f5f9;">
                  <span id="pdfMakerWmLabel" class="flex-grow-1 text-truncate">Без водяного знака</span>
                </button>
                <ul class="dropdown-menu w-100" id="pdfMakerWmMenu" style="max-height:300px;overflow-y:auto;"></ul>
              </div>
              <input type="hidden" id="pdfMakerWatermark" value="">
            </div>
          </div>
          <div class="d-flex flex-wrap gap-3 mt-3">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="pdfMakerShowTitle">
              <label class="form-check-label small text-secondary" for="pdfMakerShowTitle">
                Заголовок (плашка с названием и датой)
              </label>
            </div>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="pdfMakerLetterhead">
              <label class="form-check-label small text-secondary" for="pdfMakerLetterhead">
                Фирменная шапка сверху (бланк заказчика)
              </label>
            </div>
            <select id="pdfMakerLetterheadPages" class="form-select form-select-sm w-auto d-none">
              <option value="first" selected>Шапка: только первая страница</option>
              <option value="all">Шапка: на всех страницах</option>
            </select>
          </div>
          <div class="d-flex gap-2 mt-3">
            <button id="pdfMakerPreviewBtn" class="btn btn-outline-secondary btn-sm" type="button">Предпросмотр</button>
            <button id="pdfMakerDownloadBtn" class="btn btn-pdf btn-sm" type="button">Скачать PDF</button>
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
      showTitle: !!modalEl.querySelector("#pdfMakerShowTitle")?.checked,
      letterhead: !!modalEl.querySelector("#pdfMakerLetterhead")?.checked,
      letterheadAllPages: modalEl.querySelector("#pdfMakerLetterheadPages")?.value === "all",
      builds: typeof ctx.getBuilds === "function" ? ctx.getBuilds() : [],
    };
  }

  async function buildBlob() {
    alertBox.classList.add("d-none");
    const ctx = _pdfMakerContext || {};
    const ids = (typeof ctx.getIds === "function" ? ctx.getIds() : []).map(String).filter(Boolean);
    const builds = typeof ctx.getBuilds === "function" ? ctx.getBuilds() : [];
    // Документ может состоять из одних кастомных сборок — тогда моделей
    // каталога в нём нет вовсе (вкладка «Сборки»)
    if (!ids.length && !builds.length) {
      showModalError("Нет выбранных моделей или сборок для документа.");
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

  let refreshBusy = false;
  let refreshQueued = false;

  async function refreshPreview() {
    if (refreshBusy) {
      refreshQueued = true;
      return;
    }
    refreshBusy = true;
    previewBtn.disabled = true;
    try {
      const blob = await buildBlob();
      if (blob) {
        if (_pdfMakerBlobUrl) URL.revokeObjectURL(_pdfMakerBlobUrl);
        _pdfMakerBlobUrl = URL.createObjectURL(blob);
        frame.src = _pdfMakerBlobUrl;
        previewWrap.classList.remove("d-none");
      }
    } finally {
      refreshBusy = false;
      previewBtn.disabled = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refreshPreview();
      }
    }
  }

  previewBtn.addEventListener("click", () => void refreshPreview());

  // Автообновление предпросмотра после правок: смена водяного знака — сразу,
  // ввод заголовка — с небольшой паузой после окончания печати. Работает
  // только когда предпросмотр уже открыт, чтобы не генерировать PDF зря.
  let headerDebounce = null;
  function autoRefreshIfPreviewOpen() {
    if (previewWrap.classList.contains("d-none")) return;
    void refreshPreview();
  }
  modalEl.querySelector("#pdfMakerHeaderText").addEventListener("input", () => {
    if (previewWrap.classList.contains("d-none")) return;
    clearTimeout(headerDebounce);
    headerDebounce = setTimeout(() => autoRefreshIfPreviewOpen(), 700);
  });
  modalEl.querySelector("#pdfMakerShowTitle").addEventListener("change", autoRefreshIfPreviewOpen);
  // Подвыбор «на первой / на всех страницах» показывается только при
  // включённой шапке — иначе он не имеет смысла и путает
  const letterheadCb = modalEl.querySelector("#pdfMakerLetterhead");
  const letterheadPages = modalEl.querySelector("#pdfMakerLetterheadPages");
  letterheadCb.addEventListener("change", () => {
    letterheadPages.classList.toggle("d-none", !letterheadCb.checked);
    autoRefreshIfPreviewOpen();
  });
  letterheadPages.addEventListener("change", autoRefreshIfPreviewOpen);

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

  void populateWatermarkPicker(modalEl, autoRefreshIfPreviewOpen);
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
  if (filters.minPower || filters.maxPower) {
    const kw = (v) => (v ? formatNumber(Number(v) / 1000) : "—");
    parts.push(`Мощность: ${kw(filters.minPower)}–${kw(filters.maxPower)} кВт`);
  }
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
  // Поля мощности инженер заполняет в кВт (как в каталоге завода),
  // а API и БД работают в Вт — конвертируем на выходе из формы
  for (const key of ["minPower", "maxPower"]) {
    if (filters[key]) {
      const kw = Number(filters[key].replace(",", "."));
      if (Number.isFinite(kw)) filters[key] = String(kw * 1000);
    }
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
    hiddenCols: loadHiddenCols(),
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

  // Кнопки строки — иконки с подсказкой при наведении: текст «В проект /
  // Сравнить» на каждой из 48 строк съедал правую часть таблицы.
  // Иконки живут внутри кнопки, поэтому меняем только классы и title.
  function syncSelectionUi() {
    if (!grid) return;
    const toggleButtons = grid.querySelectorAll(".btn-compare-toggle");
    for (const button of toggleButtons) {
      const id = String(button.dataset.id || "");
      const selected = state.selectedIds.has(id);
      button.classList.toggle("btn-dark", selected);
      button.classList.toggle("btn-outline-dark", !selected);
      button.title = selected ? "В сравнении — нажмите, чтобы убрать" : "Добавить в сравнение";
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const row = button.closest("tr");
      if (row) row.classList.toggle("catalog-row-selected", selected);
    }
    const projectButtons = grid.querySelectorAll(".btn-project-toggle");
    for (const button of projectButtons) {
      const id = String(button.dataset.id || "");
      const inProject = state.projectIds.has(id);
      button.classList.toggle("btn-dark", inProject);
      button.classList.toggle("btn-outline-dark", !inProject);
      button.title = inProject ? "В проекте — нажмите, чтобы убрать" : "Добавить в проект";
      button.setAttribute("aria-pressed", inProject ? "true" : "false");
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
    // Кнопки действий встроены в колонку «Модель» (рядом с названием), а не
    // отдельной колонкой справа — так понятнее, что кнопки относятся к строке.
    const COLUMNS = [
      { key: "model", label: "Модель", sortable: true },
      { key: "size", label: "Электродвигатель", sortable: false, hideable: true },
      { key: "diameter", label: "⌀, мм", sortable: true, numeric: true, hideable: true },
      { key: "airflow", label: "Расход Q, м³/ч", sortable: true, numeric: true, hideable: true },
      { key: "pressure", label: "Давление P, Па", sortable: true, numeric: true, hideable: true },
      { key: "power", label: "Мощность, кВт", sortable: true, numeric: true, hideable: true },
      { key: "noise", label: "Шум, дБ", sortable: true, numeric: true, hideable: true },
      { key: "price", label: "Цена", sortable: true, numeric: true, hideable: true },
    ];
    const hidden = state.hiddenCols;

    // Панель «Колонки»: чекбоксы съёмных колонок — можно убрать ненужное
    // (например, «Цену»). Выбор запоминается в localStorage.
    const controls = document.createElement("div");
    controls.className = "catalog-table-controls d-flex justify-content-end mb-2";
    const dd = document.createElement("div");
    dd.className = "dropdown";
    dd.innerHTML = `
      <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside">
        Колонки
      </button>
      <ul class="dropdown-menu dropdown-menu-end p-2" style="min-width: 220px;">
        ${COLUMNS.filter((c) => c.hideable).map((c) => `
          <li>
            <label class="dropdown-item d-flex align-items-center gap-2 mb-0">
              <input type="checkbox" class="form-check-input mt-0 catalog-col-toggle" data-col="${c.key}" ${hidden.has(c.key) ? "" : "checked"}>
              <span>${escapeHtml(c.label)}</span>
            </label>
          </li>`).join("")}
      </ul>`;
    controls.appendChild(dd);

    const wrap = document.createElement("div");
    wrap.className = "table-responsive catalog-table-wrap";
    const table = document.createElement("table");
    table.className = "table table-hover align-middle catalog-table mb-0";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of COLUMNS) {
      const th = document.createElement("th");
      th.textContent = col.label;
      th.classList.add(`col-${col.key}`);
      if (hidden.has(col.key)) th.classList.add("d-none");
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

    function cellClass(col, extra = "") {
      const base = `col-${col}${hidden.has(col) ? " d-none" : ""}`;
      return extra ? `${base} ${extra}` : base;
    }

    function buildProductRow(p) {
      state.cacheById.set(p.id, p);
      const selected = state.selectedIds.has(p.id);
      const inProject = state.projectIds.has(p.id);
      const tr = document.createElement("tr");
      tr.className = `catalog-row${selected ? " catalog-row-selected" : ""}${inProject ? " catalog-row-in-project" : ""}`;

      const pointBadge = p._point
        ? `<div class="mt-1"><span class="badge ${p._point.reserve_percent < 0 ? "text-bg-warning" : (p._point.reserve_percent <= 15 ? "text-bg-success" : "text-bg-secondary")}">В точке: ${escapeHtml(formatNumber(p._point.p_available))} Па · ${p._point.reserve_percent < 0 ? "дефицит " + escapeHtml(Math.abs(p._point.reserve_percent)) : "запас " + escapeHtml(p._point.reserve_percent)}%</span></div>`
        : "";

      // Мини-иконка вентилятора (фото по типу) рядом с названием
      const thumbUrls = getImageUrlCandidates(p);
      const thumb = thumbUrls.length
        ? `<img class="catalog-fan-thumb" src="${thumbUrls[0]}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="catalog-fan-thumb catalog-fan-thumb-empty"></span>`;

      tr.innerHTML = `
        <td class="${cellClass("model", "catalog-cell-model")}">
          <div class="d-flex align-items-start gap-2">
            ${thumb}
            <div class="flex-grow-1" style="min-width: 0;">
              <a href="product.html?id=${encodeURIComponent(p.id)}" class="fw-semibold">${escapeHtml(p.model || "Без названия")}</a>
              ${pointBadge}
              <div class="catalog-row-actions mt-1 d-flex gap-1">
                <button type="button" class="btn btn-sm btn-project-toggle ${inProject ? "btn-dark" : "btn-outline-dark"}"
                        data-id="${escapeHtml(p.id)}" title="${inProject ? "В проекте — нажмите, чтобы убрать" : "Добавить в проект"}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
                  <span>${inProject ? "В проекте" : "В проект"}</span>
                </button>
                <button type="button" class="btn btn-sm btn-compare-toggle ${selected ? "btn-dark" : "btn-outline-dark"}"
                        data-id="${escapeHtml(p.id)}" title="${selected ? "В сравнении — нажмите, чтобы убрать" : "Добавить в сравнение"}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                  <span>${selected ? "В сравнении" : "Сравнить"}</span>
                </button>
              </div>
            </div>
          </div>
        </td>
        <td class="${cellClass("size", "text-secondary")}">${escapeHtml(p.size || "—")}</td>
        <td class="${cellClass("diameter", "text-end")}">${p.diameter != null ? escapeHtml(formatNumber(p.diameter)) : "—"}</td>
        <td class="${cellClass("airflow", "text-end text-nowrap")}">${escapeHtml(p.airflow?.raw || "—")}</td>
        <td class="${cellClass("pressure", "text-end text-nowrap")}">${escapeHtml(p.pressure?.raw || "—")}</td>
        <td class="${cellClass("power", "text-end")}">${p.power != null ? escapeHtml(formatNumber(Number(p.power) / 1000)) : "—"}</td>
        <td class="${cellClass("noise", "text-end")}">${p.noise_level != null ? escapeHtml(p.noise_level) : "—"}</td>
        <td class="${cellClass("price", "text-end text-nowrap fw-semibold")}">${escapeHtml(formatPrice(p.price))}</td>
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
      // Клик по строке (не по кнопке/ссылке) открывает карточку модели
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
            <span class="catalog-group-badge">РЯД</span>
            <span class="fw-bold">${escapeHtml(key || "Прочие")}</span>
            <span class="text-secondary small ms-2">${items.length} ${pluralRu(items.length, "типоразмер", "типоразмера", "типоразмеров")}</span>
          </td>
        `;
        tbody.appendChild(groupRow);
      }
      items.forEach((p, i) => {
        const row = buildProductRow(p);
        // Зебра считается внутри группы: строки-заголовки не сбивают ритм
        if (i % 2 === 1) row.classList.add("catalog-row-alt");
        tbody.appendChild(row);
      });
    }

    table.appendChild(tbody);
    grid.appendChild(controls);
    wrap.appendChild(table);
    grid.appendChild(wrap);

    // Съём/возврат колонки: прячем все ячейки col-<key> и запоминаем выбор
    controls.querySelectorAll(".catalog-col-toggle").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.col;
        if (cb.checked) state.hiddenCols.delete(key);
        else state.hiddenCols.add(key);
        saveHiddenCols(state.hiddenCols);
        table.querySelectorAll(`.col-${key}`).forEach((el) => el.classList.toggle("d-none", !cb.checked));
      });
    });

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
            Мощность: ${escapeHtml(formatPowerKw(item.power))} · ${escapeHtml(formatPrice(item.price))}
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

  // Сворачиваемая панель фильтров: на ноутбуках колонка съедает четверть
  // экрана — по кнопке таблица получает всю ширину. Состояние запоминается.
  {
    const FILTERS_COLLAPSED_KEY = "ventsearch.catalog.filtersCollapsed";
    const layout = document.querySelector(".catalog-layout");
    const toggleBtn = $("#toggleFiltersBtn");
    const toggleLabel = $("#toggleFiltersBtnLabel");
    const applyCollapsed = (collapsed) => {
      layout?.classList.toggle("filters-collapsed", collapsed);
      if (toggleLabel) toggleLabel.textContent = collapsed ? "Показать фильтры" : "Скрыть фильтры";
    };
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(FILTERS_COLLAPSED_KEY) === "1";
    } catch { /* приватный режим */ }
    applyCollapsed(collapsed);
    toggleBtn?.addEventListener("click", () => {
      collapsed = !layout?.classList.contains("filters-collapsed");
      applyCollapsed(collapsed);
      try {
        localStorage.setItem(FILTERS_COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch { /* приватный режим */ }
    });
  }

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
    // Применяем восстановленное, а не только показываем цифры в полях:
    // если сохранена рабочая точка — повторяем подбор по точке (раньше
    // после перезахода поля заполнялись, а список оставался полным
    // каталогом — «фильтры сбрасывают применение»)
    const rpq = toNumber(pointQInput?.value);
    const rpp = toNumber(pointPInput?.value);
    if (rpq > 0 && rpp > 0) {
      const rtol = Math.min(Math.max(toNumber(pointTolInput?.value) || 0, 0), 50);
      await runPointSearch(rpq, rpp, rtol);
    } else {
      await loadPage(1);
    }
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
        const inProject = isInProject(p.id);
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
        <button type="button" class="btn btn-sm w-100 mt-2 btn-compare-add-project ${inProject ? "in" : ""}" data-id="${escapeHtml(p.id)}">
          ${inProject ? "✓ В проекте" : "＋ В проект"}
        </button>
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

    // «Добавить в проект» прямо из шапки сравнения — не нужно возвращаться
    // в каталог, чтобы забрать выбранную модель в спецификацию
    headerRow.querySelectorAll(".btn-compare-add-project").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleProjectId(btn.dataset.id);
        const nowIn = isInProject(btn.dataset.id);
        btn.classList.toggle("in", nowIn);
        btn.textContent = nowIn ? "✓ В проекте" : "＋ В проект";
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
      { label: "Мощность, кВт", pick: (p) => toNumber(p.power), display: (p) => (p.power != null ? formatNumber(Number(p.power) / 1000) : "—"), best: "min" },
      { label: "Уровень шума, дБ", pick: (p) => toNumber(p.noise_level), display: (p) => (p.noise_level != null ? `${p.noise_level}` : "—"), best: "min" },
      { label: "Цена, ₽", pick: (p) => toNumber(p.price), display: (p) => formatPrice(p.price), best: "min" },
    ];

    // Зелёную подсветку «лучшего» значения убрали: у инженера нет правила
    // «больше — лучше» (нужное давление/расход диктует задача, не максимум).
    for (const row of rows) {
      const values = products.map((p) => row.pick(p));
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="param-name">${escapeHtml(row.label)}</td>${products
        .map((p, idx) => {
          const raw = values[idx];
          const text = row.display ? row.display(p) : raw ?? "—";
          return `<td>${escapeHtml(text)}</td>`;
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

  // Повторный ввод рабочей точки прямо на странице сравнения (Q,P[,допуск]) —
  // сохраняем как общую рабочую точку и перерисовываем график с ней.
  function initComparePointForm(products) {
    const form = $("#comparePointForm");
    const qEl = $("#comparePointQ");
    const pEl = $("#comparePointP");
    const tolEl = $("#comparePointTol");
    const resetBtn = $("#comparePointResetBtn");
    if (!form) return;
    const stored = loadWorkingPoint();
    if (stored) {
      if (qEl) qEl.value = stored.q ?? "";
      if (pEl) pEl.value = stored.p ?? "";
      if (tolEl && stored.tol) tolEl.value = stored.tol;
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = toNumber(qEl?.value);
      const p = toNumber(pEl?.value);
      const tol = Math.min(Math.max(toNumber(tolEl?.value) || 0, 0), 50);
      if (!q || q <= 0 || !p || p <= 0) {
        showError("Укажите расход Q и давление P (оба больше нуля).");
        return;
      }
      hideError();
      saveWorkingPoint({ q, p, tol: tol > 0 ? tol : undefined });
      compareChart = renderQpChartShared(qpChartCanvas, compareChart, products, null, loadWorkingPoint());
    });
    resetBtn?.addEventListener("click", () => {
      if (qEl) qEl.value = "";
      if (pEl) pEl.value = "";
      if (tolEl) tolEl.value = "";
      saveWorkingPoint(null);
      compareChart = renderQpChartShared(qpChartCanvas, compareChart, products, null, null);
    });
  }

  // Мини-таблица поиска (как в каталоге) для добавления моделей в сравнение
  function initCompareSearchTable() {
    const input = $("#compareSearchInput");
    const body = $("#compareSearchBody");
    if (!input || !body) return;
    let timer = null;
    async function runSearch(q) {
      const query = String(q || "").trim();
      if (query.length < 2) {
        body.innerHTML = `<tr><td colspan="6" class="text-secondary text-center py-3">Введите запрос (минимум 2 символа)…</td></tr>`;
        return;
      }
      try {
        const data = await fetchJson(apiUrl(`/api/products?q=${encodeURIComponent(query)}&limit=25&sort=price_asc`));
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
          body.innerHTML = `<tr><td colspan="6" class="text-secondary text-center py-3">Ничего не найдено.</td></tr>`;
          return;
        }
        const compared = new Set(loadCompareIds());
        body.innerHTML = items.map((p) => {
          const inCompare = compared.has(String(p.id));
          return `<tr>
            <td><a href="product.html?id=${encodeURIComponent(p.id)}" class="fw-semibold">${escapeHtml(p.model || p.id)}</a></td>
            <td class="text-secondary">${escapeHtml(p.type || "—")}</td>
            <td class="text-end text-nowrap">${escapeHtml(p.airflow?.raw || "—")}</td>
            <td class="text-end text-nowrap">${escapeHtml(p.pressure?.raw || "—")}</td>
            <td class="text-end text-nowrap">${escapeHtml(formatPrice(p.price))}</td>
            <td class="text-end"><button type="button" class="btn btn-sm ${inCompare ? "btn-dark" : "btn-primary"} compare-mini-add" data-id="${escapeHtml(p.id)}" ${inCompare ? "disabled" : ""}>${inCompare ? "✓" : "＋"}</button></td>
          </tr>`;
        }).join("");
        body.querySelectorAll(".compare-mini-add").forEach((btn) => {
          btn.addEventListener("click", () => {
            const cur = new Set(loadCompareIds());
            if (cur.size >= MAX_COMPARE && !cur.has(btn.dataset.id)) {
              showError(`Максимум ${MAX_COMPARE} моделей одновременно.`);
              return;
            }
            cur.add(btn.dataset.id);
            saveCompareIds(cur);
            window.location.reload();
          });
        });
      } catch (err) {
        console.error(err);
        body.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-3">Ошибка поиска.</td></tr>`;
      }
    }
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(input.value), 300);
    });
  }

  // Каскадный подбор «модельный ряд → типоразмер» — как выбор поколения,
  // затем размера экрана у телефона, вместо плоского списка из 300+ моделей.
  const MAX_COMPARE = 6;
  function initFamilyVariantPicker(comparedIds = []) {
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

    // Подбор аналога в пределах того же модельного ряда: если сравнение уже
    // идёт, пикер сразу открыт на ряду сравниваемых моделей
    const currentFam = families.find((f) =>
      (f.variants || []).some((v) => comparedIds.some((id) => String(v.id) === String(id))),
    );
    if (currentFam) familySelect.value = currentFam.key;

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
    initFamilyVariantPicker(loadCompareIds());
    initCompareSearchTable();
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
    initComparePointForm(products);

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
    // показываем — это внутренние маркеры базы, они есть в админке.
    // Зато инженеру сразу даём двигатель, обороты, угол лопаток и номер
    // вентилятора — без похода в график или чертежи.
    const dims = (data.dimensions && typeof data.dimensions === "object") ? data.dimensions : {};
    const angleMatch = QP_MODEL_BLADE_ANGLE_RE.exec(String(data.model || ""));
    const fanNumber = dims.Num || (angleMatch ? angleMatch[1] : null);
    const powerVal = toNumber(data.power);
    const powerText = formatPowerKw(powerVal);
    const specBody = $("#specTableBody");
    specBody.innerHTML = "";
    const specs = [
      ["Тип", data.type],
      ["Модель", data.model],
      ["Электродвигатель", data.size],
      ["Номер вентилятора", fanNumber || "—"],
      ["Угол установки лопаток", angleMatch ? `${angleMatch[2]}°` : "—"],
      ["Частота вращения", data.nominal_rpm != null ? `${formatNumber(data.nominal_rpm)} об/мин` : "—"],
      ["Диаметр", data.diameter != null ? `${data.diameter} мм` : "—"],
      ["Расход воздуха", data.airflow?.raw || "—"],
      ["Давление", data.pressure?.raw || "—"],
      ["Мощность", powerText],
      ["Уровень шума", data.noise_level != null ? `${data.noise_level} дБ` : "—"],
      ["Цена", formatPrice(data.price)],
    ];
    for (const [label, value] of specs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<th scope="row" class="w-50 text-secondary">${escapeHtml(label)}</th><td>${escapeHtml(value ?? "—")}</td>`;
      specBody.appendChild(tr);
    }

    // Габаритно-присоединительные размеры: сгруппированные мини-таблицы
    // «Обозначение → Значение» (габариты / диаметры / монтаж) вместо
    // раздробленных плиток — считывается как строка спецификации.
    renderProductDimensions(dims);

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

      // Дропдаун ручного сравнения: только модели ТОГО ЖЕ ТИПА (сравнивать
      // осевой с центробежным бессмысленно), сгруппированные по модельному
      // ряду — плоский список из 300+ моделей был бы бесполезен
      const myType = normalizeType(data.type);
      const sameType = families.filter((f) => normalizeType(f.type) === myType);
      const famList = sameType.length ? sameType : families;
      for (const fam of famList) {
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
      const firstOpt = compareWithSelect.querySelector("option[value='']");
      if (firstOpt) firstOpt.textContent = sameType.length ? `Сравнить с моделью типа «${data.type}»...` : "Сравнить с другой моделью...";
    } catch (err) {
      console.error("families fetch failed", err);
    }

    // Соседние по мощности типоразмеры ряда: сортируем ряд по мощности,
    // берём выделенную модель и по паре ближайших с каждой стороны — вместо
    // всех 20 «волосков» показываем только сопоставимые по мощности варианты.
    const SIBLING_WINDOW = 2;
    function powerAdjacentVariants(primaryId) {
      if (!familyVariants) return [];
      const sorted = [...familyVariants].sort(
        (a, b) => (toNumber(a.power) ?? 0) - (toNumber(b.power) ?? 0),
      );
      const idx = sorted.findIndex((v) => String(v.id) === String(primaryId));
      if (idx === -1) return [sorted.find((v) => String(v.id) === String(primaryId)) || currentProduct];
      const from = Math.max(0, idx - SIBLING_WINDOW);
      const to = Math.min(sorted.length, idx + SIBLING_WINDOW + 1);
      return sorted.slice(from, to);
    }

    // Тумблер «показать соседние по мощности» — по умолчанию ВЫКЛ: сначала
    // видна только выбранная модель, без серого «частокола» всего ряда.
    const siblingsToggle = $("#showSiblingsToggle");
    const siblingsToggleWrap = $("#showSiblingsWrap");

    // Показ модели: либо одна кривая (тумблер выкл), либо выделенная +
    // соседние по мощности (тумблер вкл). primaryId — какую выделить.
    function renderFamilyView(primaryId) {
      const focused = familyVariants
        ? (familyVariants.find((v) => String(v.id) === String(primaryId)) || currentProduct)
        : currentProduct;
      const showSiblings = !!siblingsToggle?.checked && familyVariants;

      if (showSiblings) {
        const shown = powerAdjacentVariants(primaryId);
        productChart = renderQpChartShared(chartCanvas, productChart, shown, null, loadWorkingPoint(), {
          primaryId,
          onSelectFamilyMember: (pid) => renderFamilyView(pid),
        });
        productCompareMeta.textContent =
          `Модельный ряд ${familyKey(currentProduct)}. Показаны соседние по мощности: ${shown.length} из ${familyVariants.length}. ` +
          `Выделено: ${focused.size || focused.model || focused.id} — кликните по серой линии, чтобы выделить другой типоразмер.`;
      } else {
        productChart = renderQpChartShared(chartCanvas, productChart, [focused], null, loadWorkingPoint());
        productCompareMeta.textContent = familyVariants
          ? `Характеристика ${focused.model || focused.id}. Включите «соседние по мощности», чтобы сравнить с близкими типоразмерами ряда.`
          : `Сейчас показана характеристика модели ${data.model || data.id}.`;
      }
    }

    if (familyVariants && siblingsToggleWrap) siblingsToggleWrap.classList.remove("d-none");
    siblingsToggle?.addEventListener("change", () => renderFamilyView(currentProduct.id));

    renderFamilyView(data.id);

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

// Логотип компании по умолчанию для водяного знака PDF
const DEFAULT_WATERMARK = "ВЕНТМАШ_ЛОГО.png";

function watermarkThumbUrl(name, versions) {
  const v = versions?.[name];
  return `${apiUrl(`/photos/${encodeURIComponent(name)}`)}${v ? `?v=${v}` : ""}`;
}

// Пикер водяного знака с миниатюрами логотипов (нативный <select> не умеет
// показывать картинки). По умолчанию выбирается ВЕНТМАШ_ЛОГО.png, если есть.
async function populateWatermarkPicker(modalEl, onChange) {
  const menu = modalEl.querySelector("#pdfMakerWmMenu");
  const hidden = modalEl.querySelector("#pdfMakerWatermark");
  const label = modalEl.querySelector("#pdfMakerWmLabel");
  const thumb = modalEl.querySelector("#pdfMakerWmThumb");
  if (!menu || !hidden) return;

  let versions = {};
  try {
    versions = await ensurePhotosVersionLoaded();
  } catch (err) {
    console.warn("Не удалось загрузить список файлов для водяного знака", err);
  }
  const names = Object.keys(versions || {}).filter((n) => WATERMARK_EXT_RE.test(n)).sort();

  function select(name) {
    hidden.value = name || "";
    if (label) label.textContent = name || "Без водяного знака";
    if (thumb) {
      if (name) { thumb.src = watermarkThumbUrl(name, versions); thumb.style.display = ""; }
      else { thumb.removeAttribute("src"); thumb.style.display = "none"; }
    }
    if (typeof onChange === "function") onChange();
  }

  const items = [{ name: "", labelText: "Без водяного знака" }]
    .concat(names.map((n) => ({ name: n, labelText: n })));
  menu.innerHTML = items.map((it) => `
    <li>
      <button type="button" class="dropdown-item d-flex align-items-center gap-2 pdf-wm-item" data-name="${escapeHtml(it.name)}">
        ${it.name ? `<img src="${watermarkThumbUrl(it.name, versions)}" alt="" style="width:26px;height:26px;object-fit:contain;border-radius:4px;background:#f1f5f9;">` : `<span style="width:26px;height:26px;display:inline-block;"></span>`}
        <span class="text-truncate">${escapeHtml(it.labelText)}</span>
      </button>
    </li>`).join("");
  menu.querySelectorAll(".pdf-wm-item").forEach((btn) => {
    btn.addEventListener("click", () => select(btn.dataset.name));
  });

  // По умолчанию — логотип ВЕНТМАШ, если он лежит в photos/
  select(names.includes(DEFAULT_WATERMARK) ? DEFAULT_WATERMARK : "");
}

// Совместимость: старый вызов для нативного select (страница проекта больше
// не использует, но оставляем на случай других мест)
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
    // Мгновенная обратная связь: mailto не даёт подтверждения отправки,
    // поэтому объясняем, что произошло и чего ждать дальше
    document.getElementById("quoteSentNote")?.classList.remove("d-none");
    showSuccess("Черновик письма с составом проекта сформирован — отправьте его из почтового клиента.");
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

// Разделы, которые ещё не готовы к показу клиенту (например, «Доставка»):
// заливаем полупрозрачным серым и красной надписью ВСЕГДА, независимо от
// DEMO_MODE. Помечаются атрибутом data-locked-section.
function applyLockedSections() {
  document.querySelectorAll("[data-locked-section]").forEach((el) => {
    if (el.querySelector(":scope > .vs-locked-overlay")) return;
    el.classList.add("vs-locked-wrap");
    const overlay = document.createElement("div");
    overlay.className = "vs-locked-overlay";
    const label = document.createElement("div");
    label.className = "vs-locked-label";
    label.textContent = el.getAttribute("data-locked-section") || "Недоступно в инсайдерской версии";
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

// Возврат «Назад»/«Вперёд» отдаёт страницу из bfcache браузера БЕЗ повторного
// запуска скриптов: выделения сравнения/проекта и фильтры остаются от прошлого
// показа, хотя в localStorage они уже изменены на другой вкладке. Форсируем
// перезагрузку, чтобы состояние всегда совпадало с localStorage.
window.addEventListener("pageshow", (event) => {
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  const isBackForward = nav ? nav.type === "back_forward" : false;
  if (event.persisted || isBackForward) {
    window.location.reload();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  applyDemoModeGuardIfNeeded();
  applyLockedSections();
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
