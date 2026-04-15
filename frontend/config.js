/**
 * Базовый URL REST API (без завершающего слэша).
 * Пустая строка — запросы на тот же origin (если фронт и API на одном хосте).
 * Для отдельного dev-сервера фронта укажите, например: "http://127.0.0.1:8000"
 */
(() => {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocalHost = host === "127.0.0.1" || host === "localhost";

  // Локально всегда бьем в локальный API.
  if (isLocalHost) {
    window.VENTMASH_API_BASE = "http://127.0.0.1:8000";
    return;
  }

  // Для прода/других стендов можно оставить пусто (same-origin) или задать URL явно.
  window.VENTMASH_API_BASE = "https://bbacquvporktcsrk793o.containers.yandexcloud.net/";
})();
