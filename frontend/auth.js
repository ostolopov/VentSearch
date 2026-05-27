const AUTH_TOKEN_KEY = "ventsearch.auth.token";
const AUTH_USER_KEY = "ventsearch.auth.user";

function apiUrl(path) {
  const base = (typeof window !== "undefined" && window.VENTMASH_API_BASE
    ? String(window.VENTMASH_API_BASE)
    : ""
  ).replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function getAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || {}));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem("ventsearch.project.ids");
  localStorage.removeItem("ventsearch.compare.ids");
  localStorage.removeItem("ventsearch.user.profile");
  localStorage.removeItem("ventsearch.project.meta");
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiAuthFetch(path, options = {}) {
  const headers = authHeaders(options.headers || {});
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(apiUrl(path), { ...options, headers });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    const detail = data?.detail;
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object" && !Array.isArray(detail) && detail.error) message = detail.error;
    else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
    else if (data?.error) message = data.error;
    const err = new Error(message);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

window.VentAuth = {
  apiUrl,
  getAuthToken,
  getAuthUser,
  setAuthSession,
  clearAuthSession,
  authHeaders,
  apiAuthFetch,
};
