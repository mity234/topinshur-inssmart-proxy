// Shared helpers for the Inssmart API proxy (Vercel serverless functions).
// Ported from site/public/api/_inssmart-common.php — moved here because the
// reg.ru hosting IP got rate-limited by Inssmart (rule=1) after heavy testing.

const INSSMART_EMAIL = process.env.INSSMART_EMAIL;
const INSSMART_PASSWORD = process.env.INSSMART_PASSWORD;
const INSSMART_BASE = "https://api.inssmart.ru/v1";

// Allowed origins for CORS — the actual site domains only. topinshur.online
// has no trusted cert yet, so browsers may load it over plain http — allow
// both schemes for the test domain.
const ALLOWED_ORIGINS = [
  "https://topinshur.ru",
  "https://topinshur.online",
  "http://topinshur.online",
];

const INSSMART_COMPANY_NAMES = {
  "-1": "Другая",
  0: "Альфа Страхование",
  1: "Зетта",
  2: "Ингосстрах",
  3: "Ренессанс",
  4: "Росгосстрах",
  7: "Т-Страхование",
  8: "Югория",
  9: "Согласие",
  11: "РЕСО",
  12: "ВСК",
  14: "Макс",
  15: "Абсолют Страхование",
  16: "ЕВРОИНС",
  17: "ОСК",
  18: "Гайде",
  19: "Астро-Волга",
  20: "Верна",
  21: "Согаз",
  23: "Совкомбанк Страхование",
  26: "Сбербанк Страхование",
  28: "ЭНЕРГОГАРАНТ",
  29: "Пари",
  31: "Интач",
  32: "Гелиос",
  33: "Боровицкое СО",
  34: "AMT",
  35: "РСХБ-Страхование",
  50: "РБ Страхование",
};

function companyName(code) {
  if (code === null || code === undefined) return "Страховая компания";
  return INSSMART_COMPANY_NAMES[String(code)] ?? `Компания #${code}`;
}

function enrichOffers(rawOffers) {
  const result = (rawOffers || []).map((o) => ({
    company: companyName(o.code),
    price: o.price ?? null,
    // A real price means the offer is ready, regardless of the raw status code —
    // different products (KASKO/OSAGO vs mortgage) use different OfferStatus enums.
    status: o.price != null ? "ready" : o.status === 1 ? "pending" : "failed",
    error: o.error ?? null,
  }));
  result.sort((a, b) => {
    const rank = (x) => (x.status === "ready" ? 0 : x.status === "pending" ? 1 : 2);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.price ?? Infinity) - (b.price ?? Infinity);
    return 0;
  });
  return result;
}

function offersComplete(rawOffers) {
  return !(rawOffers || []).some((o) => o.status === 1);
}

function isRateLimited(body) {
  return !!(body && typeof body.message === "string" && body.message.includes("Превышено число запросов"));
}

async function apiCall(method, url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const status = res.status;
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response, leave json null
  }
  return { status, body: json };
}

// Best-effort in-memory cache — persists only while the same serverless
// instance stays warm between invocations; falls back to a fresh login otherwise.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && cachedTokenExpiresAt > Date.now()) {
    return cachedToken;
  }
  const auth = await apiCall("POST", `${INSSMART_BASE}/account/accounts/token`, {
    email: INSSMART_EMAIL,
    password: INSSMART_PASSWORD,
  });
  const token = auth.body?.accessToken;
  if (!token) return null;
  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + 2.5 * 3600 * 1000;
  return token;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = {
  INSSMART_BASE,
  apiCall,
  getToken,
  enrichOffers,
  offersComplete,
  isRateLimited,
  companyName,
  applyCors,
};
