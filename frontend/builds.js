/**
 * Вкладка «Сборки»: исполнение под заказчика на базе каталожной модели.
 *
 * Менеджер берёт модель из каталога, правит название/двигатель/габариты,
 * дописывает примечания — и выгружает всё в PDF через ОБЩИЙ конвейер
 * (openPdfMaker из script.js), тот же, что у сравнения и карточки.
 *
 * Аэродинамика остаётся заводской: на графике рисуются паспортные кривые
 * базовых моделей. Правки размеров и текстов — это про исполнение
 * (корпус, клапан, фланец), а не про характеристики вентилятора.
 */
(function () {
  if (document.body.dataset.page !== "builds") return;

  const BUILDS_KEY = "ventsearch.builds";
  const $ = (sel) => document.querySelector(sel);

  // Значения по умолчанию берём из базовой модели, но храним как СТРОКИ:
  // менеджеру нужно писать «АИР 112MA6 (взрывозащищённый)», а не число.
  function buildFromProduct(product) {
    const dims = (product && product.dimensions && typeof product.dimensions === "object")
      ? { ...product.dimensions }
      : {};
    const powerKw = product && product.power != null
      ? String(Number(product.power) / 1000).replace(".", ",")
      : "";
    return {
      id: `b${Date.now()}${Math.random().toString(16).slice(2, 6)}`,
      title: product ? String(product.model || product.id || "Сборка") : "Новая сборка",
      baseId: product ? String(product.id) : "",
      baseModel: product ? String(product.model || "") : "",
      motor: product ? String(product.size || "") : "",
      powerKw,
      rpm: product && product.nominal_rpm != null ? String(product.nominal_rpm) : "",
      dimensions: dims,
      notes: "",
    };
  }

  function loadBuilds() {
    try {
      const raw = localStorage.getItem(BUILDS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveBuilds(list) {
    try {
      localStorage.setItem(BUILDS_KEY, JSON.stringify(list));
    } catch {
      // приватный режим — просто не сохраняем
    }
    updateBuildsBadge(list.length);
  }

  function updateBuildsBadge(count) {
    const badge = document.getElementById("navBuildsBadge");
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle("d-none", count === 0);
  }

  function escapeAttr(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  let builds = loadBuilds();
  let chart = null;
  const alertBox = $("#alertBox");

  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }
  function hideError() {
    alertBox?.classList.add("d-none");
  }

  // --- Рабочая точка (общее хранилище с каталогом и сравнением) ------------
  function currentPoint() {
    const q = Number($("#buildsPointQ")?.value);
    const p = Number($("#buildsPointP")?.value);
    const tol = Number($("#buildsPointTol")?.value);
    if (!(q > 0) || !(p > 0)) return null;
    return { q, p, tol: tol > 0 ? tol : undefined };
  }

  // --- График: паспортные кривые базовых моделей ---------------------------
  async function renderChart() {
    const container = $("#buildsQpChart");
    if (!container || typeof renderQpChartShared !== "function") return;
    const ids = [...new Set(builds.map((b) => b.baseId).filter(Boolean))].slice(0, 8);
    if (!ids.length) {
      if (chart) {
        chart.dispose();
        chart = null;
      }
      container.innerHTML =
        '<div class="text-secondary small p-3">Добавьте сборку на базе модели каталога — здесь появится её кривая Q–P.</div>';
      return;
    }
    try {
      const products = [];
      for (const id of ids) {
        const data = await fetchJson(apiUrl(`/api/products/${encodeURIComponent(id)}`));
        if (data) products.push(data);
      }
      if (!products.length) return;
      // Чистим контейнер только когда живого графика ещё нет (в нём лежит
      // текст-заглушка). Иначе innerHTML снёс бы DOM работающего инстанса
      // ECharts, а сам инстанс остался бы «висеть» — и перерисовка по
      // рабочей точке уходила бы в пустоту.
      if (!chart) container.innerHTML = "";
      chart = renderQpChartShared(container, chart, products, null, currentPoint());
    } catch (err) {
      console.error(err);
      showError("Не удалось загрузить кривые базовых моделей.");
    }
  }

  // --- Карточка сборки -----------------------------------------------------
  function dimensionRows(build) {
    const entries = Object.entries(build.dimensions || {});
    if (!entries.length) {
      return '<div class="text-secondary small">Размеры не заданы.</div>';
    }
    return (
      '<div class="row g-2">' +
      entries
        .map(
          ([key, value]) => `
        <div class="col-6 col-md-3">
          <label class="form-label text-secondary small mb-1">${escapeAttr(key)}</label>
          <input class="form-control form-control-sm build-dim" data-dim-key="${escapeAttr(key)}"
                 value="${escapeAttr(value)}" />
        </div>`,
        )
        .join("") +
      "</div>"
    );
  }

  function renderBuilds() {
    const list = $("#buildsList");
    const countEl = $("#buildsCount");
    if (!list) return;
    if (countEl) countEl.textContent = builds.length ? `(${builds.length})` : "";
    updateBuildsBadge(builds.length);

    if (!builds.length) {
      list.innerHTML =
        '<div class="card border-0 shadow-sm" style="border-radius: 16px;"><div class="card-body p-4 text-secondary">' +
        "Пока пусто. Найдите модель выше и нажмите «Взять за основу»." +
        "</div></div>";
      return;
    }

    list.innerHTML = builds
      .map(
        (b, idx) => `
      <div class="card border-0 shadow-sm build-card" data-build-id="${escapeAttr(b.id)}" style="border-radius: 16px;">
        <div class="card-body p-4">
          <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div class="flex-grow-1">
              <label class="form-label text-secondary small mb-1">Название в документе</label>
              <input class="form-control fw-semibold build-title" value="${escapeAttr(b.title)}" />
              ${b.baseModel
                ? `<div class="small text-secondary mt-1">На базе: ${escapeAttr(b.baseModel)}</div>`
                : '<div class="small text-secondary mt-1">Без базовой модели каталога</div>'}
            </div>
            <button class="btn btn-sm btn-outline-danger build-remove" type="button" title="Удалить сборку">✕</button>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-12 col-md-6">
              <label class="form-label text-secondary small mb-1">Электродвигатель</label>
              <input class="form-control form-control-sm build-motor" value="${escapeAttr(b.motor)}" />
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label text-secondary small mb-1">Мощность, кВт</label>
              <input class="form-control form-control-sm build-power" value="${escapeAttr(b.powerKw)}" />
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label text-secondary small mb-1">Обороты, об/мин</label>
              <input class="form-control form-control-sm build-rpm" value="${escapeAttr(b.rpm)}" />
            </div>
          </div>

          <div class="mb-2 d-flex justify-content-between align-items-center">
            <span class="form-label text-secondary small mb-0">Габаритные и присоединительные размеры, мм</span>
            <button class="btn btn-sm btn-outline-secondary build-add-dim" type="button">+ размер</button>
          </div>
          <div class="build-dims mb-3">${dimensionRows(b)}</div>

          <label class="form-label text-secondary small mb-1">Примечания к исполнению</label>
          <textarea class="form-control build-notes" rows="3"
            placeholder="Например: корпус оцинкованный, обратный клапан, гибкая вставка, комплектация по опросному листу…">${escapeAttr(b.notes)}</textarea>
        </div>
      </div>`,
      )
      .join("");
  }

  function findBuild(el) {
    const card = el.closest(".build-card");
    if (!card) return null;
    return builds.find((b) => b.id === card.dataset.buildId) || null;
  }

  // Правки применяем сразу в модель и в localStorage — без кнопки «сохранить»
  $("#buildsList")?.addEventListener("input", (event) => {
    const el = event.target;
    const build = findBuild(el);
    if (!build) return;
    if (el.classList.contains("build-title")) build.title = el.value;
    else if (el.classList.contains("build-motor")) build.motor = el.value;
    else if (el.classList.contains("build-power")) build.powerKw = el.value;
    else if (el.classList.contains("build-rpm")) build.rpm = el.value;
    else if (el.classList.contains("build-notes")) build.notes = el.value;
    else if (el.classList.contains("build-dim")) {
      build.dimensions = build.dimensions || {};
      build.dimensions[el.dataset.dimKey] = el.value;
    } else return;
    saveBuilds(builds);
  });

  $("#buildsList")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".build-remove");
    if (removeBtn) {
      const build = findBuild(removeBtn);
      if (!build) return;
      builds = builds.filter((b) => b.id !== build.id);
      saveBuilds(builds);
      renderBuilds();
      void renderChart();
      return;
    }
    const addDimBtn = event.target.closest(".build-add-dim");
    if (addDimBtn) {
      const build = findBuild(addDimBtn);
      if (!build) return;
      const key = window.prompt("Обозначение размера (например, L2 или «Патрубок»):", "");
      if (!key || !key.trim()) return;
      build.dimensions = build.dimensions || {};
      build.dimensions[key.trim()] = "";
      saveBuilds(builds);
      renderBuilds();
    }
  });

  // --- Поиск базовой модели (тот же нестрогий поиск, что в каталоге) -------
  let searchTimer = null;
  async function searchBase(query) {
    const tbody = $("#buildBaseResults");
    if (!tbody) return;
    const q = String(query || "").trim();
    if (!q) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-secondary text-center py-3">Введите запрос выше…</td></tr>';
      return;
    }
    try {
      const data = await fetchJson(apiUrl(`/api/products?q=${encodeURIComponent(q)}&limit=25`));
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="text-secondary text-center py-3">Ничего не найдено.</td></tr>';
        return;
      }
      tbody.innerHTML = items
        .map(
          (p) => `
        <tr>
          <td class="fw-semibold">${escapeAttr(p.model || p.id)}</td>
          <td>${escapeAttr(p.type || "—")}</td>
          <td class="text-end">${escapeAttr(p.airflow?.raw || "—")}</td>
          <td class="text-end">${escapeAttr(p.pressure?.raw || "—")}</td>
          <td class="text-end">${p.power != null ? escapeAttr(String(Number(p.power) / 1000).replace(".", ",")) : "—"}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-dark build-take" type="button"
                    data-product-id="${escapeAttr(p.id)}">Взять за основу</button>
          </td>
        </tr>`,
        )
        .join("");
    } catch (err) {
      console.error(err);
      showError("Не удалось выполнить поиск по каталогу.");
    }
  }

  $("#buildBaseSearch")?.addEventListener("input", (event) => {
    hideError();
    clearTimeout(searchTimer);
    const value = event.target.value;
    searchTimer = setTimeout(() => void searchBase(value), 350);
  });

  $("#buildBaseResults")?.addEventListener("click", async (event) => {
    const btn = event.target.closest(".build-take");
    if (!btn) return;
    btn.disabled = true;
    try {
      const product = await fetchJson(
        apiUrl(`/api/products/${encodeURIComponent(btn.dataset.productId)}`),
      );
      builds.push(buildFromProduct(product));
      saveBuilds(builds);
      renderBuilds();
      void renderChart();
    } catch (err) {
      console.error(err);
      showError("Не удалось загрузить модель каталога.");
    } finally {
      btn.disabled = false;
    }
  });

  $("#addBlankBuildBtn")?.addEventListener("click", () => {
    builds.push(buildFromProduct(null));
    saveBuilds(builds);
    renderBuilds();
  });

  $("#clearBuildsBtn")?.addEventListener("click", () => {
    if (!builds.length) return;
    if (!window.confirm("Удалить все сборки?")) return;
    builds = [];
    saveBuilds(builds);
    renderBuilds();
    void renderChart();
  });

  // --- Рабочая точка -------------------------------------------------------
  $("#buildsPointForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const point = currentPoint();
    if (!point) {
      showError("Укажите расход Q и давление P — оба больше нуля.");
      return;
    }
    hideError();
    if (typeof saveWorkingPoint === "function") saveWorkingPoint(point);
    void renderChart();
  });

  $("#buildsPointResetBtn")?.addEventListener("click", () => {
    if ($("#buildsPointQ")) $("#buildsPointQ").value = "";
    if ($("#buildsPointP")) $("#buildsPointP").value = "";
    if ($("#buildsPointTol")) $("#buildsPointTol").value = "";
    if (typeof saveWorkingPoint === "function") saveWorkingPoint(null);
    void renderChart();
  });

  // --- Экспорт в PDF: тот же конвейер, что у сравнения ---------------------
  $("#exportBuildsPdfBtn")?.addEventListener("click", () => {
    if (!builds.length) {
      showError("Добавьте хотя бы одну сборку.");
      return;
    }
    hideError();
    if (typeof openPdfMaker !== "function") return;
    openPdfMaker({
      filename: "ventsearch-sborka.pdf",
      // Моделей каталога в документе нет — только сборки
      getIds: () => [],
      getBuilds: () =>
        builds.map((b) => ({
          title: b.title || "Сборка",
          base_id: b.baseId || null,
          base_model: b.baseModel || null,
          motor: b.motor || null,
          power_kw: b.powerKw || null,
          rpm: b.rpm || null,
          dimensions: b.dimensions || {},
          notes: b.notes || null,
        })),
      getChart: () => chart,
    });
  });

  // --- Инициализация -------------------------------------------------------
  function restorePoint() {
    if (typeof loadWorkingPoint !== "function") return;
    const stored = loadWorkingPoint();
    if (!stored) return;
    if ($("#buildsPointQ")) $("#buildsPointQ").value = String(stored.q);
    if ($("#buildsPointP")) $("#buildsPointP").value = String(stored.p);
    if ($("#buildsPointTol") && stored.tol) $("#buildsPointTol").value = String(stored.tol);
  }

  // Раздел рабочий, а не клиентский: гостю показываем подсказку вместо
  // конструктора. Данные сборок всё равно локальные, но лишний интерфейс
  // клиенту ни к чему (доступ к самим API проверяет сервер).
  function applyStaffGuard() {
    const role = document.body.dataset.role;
    const staff = role === "admin" || role === "moderator";
    $("#buildsStaffOnly")?.classList.toggle("d-none", staff);
    const workspace = $("#buildsWorkspace");
    if (workspace) workspace.classList.toggle("d-none", !staff);
    return staff;
  }

  document.addEventListener("DOMContentLoaded", () => {
    restorePoint();
    renderBuilds();
    void renderChart();
    applyStaffGuard();
    // Роль приходит асинхронно (проверка токена) — реагируем на её появление
    const observer = new MutationObserver(() => applyStaffGuard());
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-role"] });
  });
})();
