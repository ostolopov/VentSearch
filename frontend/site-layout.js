/** Общий подвал и поиск в шапке на страницах вне каталога. */
(function () {
  function siteFooterHtml() {
    return `
      <hr class="my-5" />
      <section id="about" class="mb-5">
        <h2 class="h5">О проекте</h2>
        <p class="text-secondary mb-0">
          VENTSEARCH — веб-сервис для подбора промышленных вентиляторов по техническим параметрам. Платформа
          помогает инженерам и закупкам быстро находить подходящие модели, сравнивать характеристики на графике Q–P
          и формировать PDF-отчёт для согласования внутри компании. Официальные домены: ventsearch.ru, ventsearch.online.
        </p>
      </section>
      <section id="contact" class="mb-2">
        <h2 class="h5">Контакты</h2>
        <p class="text-secondary mb-0">
          Проектная команда VENTSEARCH. По вопросам демонстрации, внедрения и доработок:
          <a href="mailto:ventsearch.team@gmail.com">ventsearch.team@gmail.com</a>.
          Официальные домены: ventsearch.ru, ventsearch.online. Также вы можете использовать кнопку «Поделиться», чтобы
          отправить локальную ссылку коллегам в одной сети.
        </p>
      </section>
      <footer class="mt-5 pt-4 border-top text-secondary small">
        <div class="d-flex flex-column flex-md-row justify-content-between align-items-center gap-3">
          <div>&copy; 2026 VENTSEARCH. Все права защищены.</div>
          <div class="d-flex gap-3">
            <a href="#" class="text-secondary text-decoration-none">Пользовательское соглашение</a>
            <a href="#" class="text-secondary text-decoration-none">Политика конфиденциальности</a>
            <a href="#" class="text-secondary text-decoration-none">Лицензии</a>
          </div>
        </div>
      </footer>
    `;
  }

  function mountSiteFooter() {
    const mount = document.getElementById("siteFooterMount");
    if (!mount || mount.dataset.mounted === "1") return;
    mount.dataset.mounted = "1";
    mount.innerHTML = siteFooterHtml();
  }

  function initHeaderSearch() {
    if (document.body.dataset.page === "catalog") return;
    const input = document.getElementById("headerSearchInput");
    const btn = document.getElementById("headerSearchBtn");
    if (!input) return;

    const go = () => {
      const q = String(input.value || "").trim();
      window.location.href = q ? `index.html?q=${encodeURIComponent(q)}` : "index.html";
    };

    btn?.addEventListener("click", go);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        go();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    mountSiteFooter();
    initHeaderSearch();
  });
})();
