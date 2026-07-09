// Direct integration with Ingosstrakh's own OSAGO API — found via their
// PlatformEco partner documentation PDF (129 pages, dated 29.04.2026).
//
// NOT YET TESTED LIVE: waiting on the curator to provision test credentials
// (client_id/client_secret) — the user already submitted the onboarding form
// with our static IP (31.31.196.218, reg.ru). Once creds arrive, set
// INGOSSTRAKH_CLIENT_ID / INGOSSTRAKH_CLIENT_SECRET / INGOSSTRAKH_SCOPE as
// Vercel env vars and this should work as-is.

const crypto = require("crypto");

const INGOSSTRAKH_ENV = process.env.INGOSSTRAKH_ENV || "test"; // "test" or "prod"
const BASE_URLS = {
  test: "https://test-wsgate.ingos.ru",
  prod: "https://wsgate.ingos.ru",
};
const AUTH_URLS = {
  test: "https://ssotest.ingos.ru/blitz/auth-service/te",
  prod: "https://sso.ingos.ru/blitz/auth-service/te",
};

const INGOSSTRAKH_BASE = BASE_URLS[INGOSSTRAKH_ENV];
const INGOSSTRAKH_AUTH_URL = AUTH_URLS[INGOSSTRAKH_ENV];
const CLIENT_ID = process.env.INGOSSTRAKH_CLIENT_ID;
const CLIENT_SECRET = process.env.INGOSSTRAKH_CLIENT_SECRET;
const SCOPE = process.env.INGOSSTRAKH_SCOPE || "auth.wssales";

// Document type codes confirmed from the docs (справочник видов документов
// only lists a subset inline — the full list is available via
// GET /directory/osago/doctypes, code "21" = Паспорт гражданина РФ = 30363316).
const DOC_TYPE_PASSPORT_RF = 30363316;
const DOC_TYPE_DRIVER_LICENSE = 765912000;
const DOC_TYPE_STS = 34709116; // СТС
const DOC_TYPE_PTS = 34709216; // ПТС
const RISK_RESTRICTED_DRIVERS = 28966116; // "Список водителей"
const RISK_MULTIDRIVE = 28966316; // "Мультидрайв"
const USAGE_TYPE_NORMAL = 1381850903; // "Обычная эксплуатация"

// Best-effort in-memory token cache — same caveat as Inssmart's: only
// persists while the same serverless instance stays warm.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && cachedTokenExpiresAt > Date.now()) {
    return cachedToken;
  }
  const res = await fetch(INGOSSTRAKH_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SCOPE,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!json?.access_token) return null;
  cachedToken = json.access_token;
  // Refresh at 80% of the token's lifetime, per Ingosstrakh's own guidance —
  // hammering the token endpoint risks a 30-minute lockout (30 req/min limit).
  cachedTokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 * 0.8;
  return cachedToken;
}

function uuid() {
  return crypto.randomUUID();
}

async function apiCall(method, path, body, token, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Ip": process.env.INGOSSTRAKH_USER_IP || "31.31.196.218",
    "Http-Session-Id": uuid(),
    ...extraHeaders,
  };
  const res = await fetch(`${INGOSSTRAKH_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const status = res.status;
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  return { status, body: json };
}

// Builds the real Ingosstrakh request shape from our existing flat form
// fields (same fields the Inssmart-backed osago-calc.js already collects).
// NOTE: addresses require a FIAS aoGuid/houseGuid, which Ingosstrakh's docs
// don't expose a lookup dictionary for in this PDF — either ask Ingosstrakh
// for an address-dictionary endpoint, or fall back to a third-party FIAS/
// DaData lookup. For now this only sends the free-text "text" address field,
// which the docs show alongside the FIAS codes in every example but never
// confirm works alone — needs live verification once credentials exist.
function buildCalculationRequest({
  plate,
  vin,
  carModelIsn, // Ingosstrakh's own model dictionary id — must be resolved via /directory/osago/models first
  carCategory = "B",
  carYear,
  carPowerHp,
  firstName,
  lastName,
  patronymic,
  birthDate,
  gender, // "1" male / "2" female, matches the rest of the app's convention
  passportSeries,
  passportNumber,
  passportIssue,
  address,
  phone,
  email,
  driverLicenseSeries,
  driverLicenseNumber,
  driverLicenseIssue,
  experienceDate,
  validFrom,
  validTo,
  citySalesKladr, // КЛАДР code of the sales city — required, no default
  multidrive = false,
}) {
  const fullName = `${lastName} ${firstName} ${patronymic || ""}`.trim();

  return {
    agreement: {
      general: {
        dateBeg: `${validFrom}T00:00:00`,
        dateEnd: validTo,
        citySales: citySalesKladr,
      },
      insurer: { sbjRef: 1, mobilePhone: (phone || "").replace(/\D/g, ""), email },
      owner: { sbjRef: 1 },
      drivers: [
        {
          sbjRef: 1,
          drvDateBeg: experienceDate,
          driverLicense: {
            docType: DOC_TYPE_DRIVER_LICENSE,
            docSer: driverLicenseSeries,
            docNo: driverLicenseNumber,
            docDate: driverLicenseIssue,
          },
        },
      ],
      vehicle: {
        model: carModelIsn,
        regNum: plate || undefined,
        vin: vin || undefined,
        enginePowerHP: carPowerHp,
        constructed: carYear ? `${carYear}-01-01` : undefined,
        category: carCategory,
        document: {
          docType: DOC_TYPE_STS,
        },
      },
      condition: {
        liability: {
          riskCtg: multidrive ? RISK_MULTIDRIVE : RISK_RESTRICTED_DRIVERS,
          usageType: USAGE_TYPE_NORMAL,
          usageTarget: { personal: "Y" },
          useWithTrailer: "N",
          periods: [{ dateBeg: validFrom, dateEnd: validTo }],
        },
      },
      subjects: [
        {
          sbjKey: 1,
          gender: gender === "2" ? "Ж" : "М",
          sbjResident: "Y",
          fullName,
          birthDate,
          identityDocument: {
            countryCode: "643",
            docType: DOC_TYPE_PASSPORT_RF,
            docSer: `${passportSeries}`.replace(/(\d{2})(\d{2})/, "$1 $2"),
            docNo: passportNumber,
            docDate: passportIssue,
          },
          addresses: [{ countryCode: "643", text: address }],
        },
      ],
    },
  };
}

async function calculateOsago(params) {
  const token = await getToken();
  if (!token) return { status: 0, body: null, error: "auth_failed" };
  const requestBody = buildCalculationRequest(params);
  const sessionId = uuid();
  return apiCall("POST", "/agent/osago/calculation", requestBody, token, { "Http-Session-Id": sessionId });
}

async function searchMarks(query, count = 20) {
  const token = await getToken();
  if (!token) return null;
  const res = await apiCall("GET", `/directory/osago/marks?${new URLSearchParams({ count, query })}`, undefined, token);
  return res.body;
}

async function searchModels(markIsn, query, count = 20) {
  const token = await getToken();
  if (!token) return null;
  const params = { count };
  if (markIsn) params.markisn = markIsn;
  if (query) params.query = query;
  const res = await apiCall("GET", `/directory/osago/models?${new URLSearchParams(params)}`, undefined, token);
  return res.body;
}

module.exports = { calculateOsago, buildCalculationRequest, searchMarks, searchModels, getToken, apiCall, INGOSSTRAKH_BASE };
