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
    // Mortgage-specific cost breakdown — undefined/null for KASKO/OSAGO offers.
    lifePrice: o.lifePrice ?? null,
    propertyPrice: o.propertyPrice ?? null,
    titlePrice: o.titlePrice ?? null,
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

// IMPORTANT: the offers array only contains companies that have *responded so
// far* — a company that hasn't been queried yet simply isn't in the array at
// all (no placeholder "pending" entry). So checking "none of the listed
// offers are pending" is not enough — early on, few companies have answered
// and none of *those* are pending, which looks "complete" while 20+ others
// haven't even started. The real signal is the search "state" field: state=2
// means still searching, state=3 (or higher) means the search itself is done.
function offersComplete(state, rawOffers) {
  if ((state ?? 0) < 3) return false;
  return !(rawOffers || []).some((o) => o.status === 1);
}

// Looks up the driver's real KBM (bonus-malus coefficient) from RSA via
// Inssmart, so the OSAGO calculation uses the driver's actual discount
// instead of the "starting" default KBM.
async function getKBMInfo(token, { plate, firstName, lastName, patronymic, birthDate, driverLicenseSeries, driverLicenseNumber }) {
  const res = await apiCall(
    "POST",
    `${INSSMART_BASE}/product-osago/KBMInfo`,
    {
      vehicleRegNumber: plate,
      driver: {
        firstName,
        lastName,
        patronymic,
        birthDate: birthDate ? `${birthDate}T00:00:00.000Z` : undefined,
        driverLicenseSeries,
        driverLicenseNumber,
      },
    },
    token,
  );
  return res.body && typeof res.body.factor === "number" ? res.body : null;
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
  getKBMInfo,
};
