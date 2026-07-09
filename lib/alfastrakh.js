// Direct integration with AlfaStrakhovanie's own OSAGO calculation API — found
// via their developer portal (api.alfastrah.ru), not through Inssmart.
//
// NOT YET TESTED LIVE: the portal login the user has is for browsing docs
// only. The API itself (b2b-test2.alfastrah.ru) requires separate HTTP Digest
// Auth credentials that AlfaStrakhovanie issues specifically for API access —
// still waiting on those, plus the "agent block" IDs (agent_contract_id,
// channel_sale_id, department_id, signer_id, manager_id) that identify our
// agency in their system. Spec confirmed via their real OpenAPI 3.1 document
// (osago-calculation-relaunch product) fetched from the portal.

const crypto = require("crypto");

const ALFASTRAKH_BASE = process.env.ALFASTRAKH_BASE_URL || "https://b2b-test2.alfastrah.ru";
const ALFASTRAKH_USERNAME = process.env.ALFASTRAKH_USERNAME;
const ALFASTRAKH_PASSWORD = process.env.ALFASTRAKH_PASSWORD;

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function parseDigestChallenge(header) {
  const params = {};
  const regex = /(\w+)=("([^"]*)"|[^,]*)/g;
  let match;
  while ((match = regex.exec(header))) {
    params[match[1]] = match[3] !== undefined ? match[3] : match[2];
  }
  return params;
}

// Node's fetch has no built-in Digest Auth support, so this does the RFC 2617
// challenge/response by hand: first request gets a 401 + WWW-Authenticate
// challenge, then we retry with a computed Authorization header.
async function digestFetch(url, options, username, password) {
  const method = options.method || "GET";
  const firstRes = await fetch(url, options);
  if (firstRes.status !== 401) return firstRes;

  const wwwAuth = firstRes.headers.get("www-authenticate");
  if (!wwwAuth || !wwwAuth.toLowerCase().startsWith("digest")) return firstRes;

  const challenge = parseDigestChallenge(wwwAuth);
  const { realm, nonce, qop, opaque } = challenge;
  const { pathname, search } = new URL(url);
  const uri = pathname + search;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);

  return fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Digest ${parts.join(", ")}` },
  });
}

async function apiCall(method, path, body) {
  const res = await digestFetch(
    `${ALFASTRAKH_BASE}${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    ALFASTRAKH_USERNAME,
    ALFASTRAKH_PASSWORD,
  );
  const status = res.status;
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  return { status, body: json };
}

// Builds the real AlfaStrakhovanie request shape from our existing flat form
// fields (same fields the Inssmart-backed osago-calc.js already collects).
function buildCalculationRequest({
  plate,
  vin,
  carMark,
  carModel,
  carCategory,
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
  driversRestriction = true,
}) {
  const person = {
    person_data: {
      first_name: firstName,
      last_name: lastName,
      middle_name: patronymic || undefined,
      birth_date: birthDate,
      sex: gender === "2" ? "FEMALE" : "MALE",
      addresses: [{ address_type: "Регистрации", district: address, region: address }],
      person_document: {
        document_type: "Паспорт гражданина РФ",
        document_series: passportSeries,
        document_number: passportNumber,
        issue_date: passportIssue,
      },
      phones: phone ? [{ phone_number: phone.replace(/\D/g, ""), phone_type: "Сотовый" }] : undefined,
      email,
    },
  };

  return {
    drivers: [
      {
        driver_data: {
          first_name: firstName,
          last_name: lastName,
          middle_name: patronymic || undefined,
          birth_date: birthDate,
          sex: gender === "2" ? "FEMALE" : "MALE",
          driver_document: {
            document_type: "Водительское удостоверение РФ",
            document_series: driverLicenseSeries,
            document_number: driverLicenseNumber,
            issue_date: driverLicenseIssue,
            driving_experience_date: experienceDate,
          },
        },
      },
    ],
    transport_owner: { person },
    transport_insurer: { person },
    vehicle: {
      identity: { licence_plate: plate, vin: vin || undefined },
      mark: carMark,
      model: carModel,
      category: carCategory || "B - легковые",
      production_year: carYear,
      registration_country: "Россия",
      use_with_trailer: false,
      registration_documents: [
        {
          document_type: "Паспорт ТС",
          document_number: "0000000000",
          issue_date: validFrom,
        },
      ],
    },
    insurance_contract: {
      begin_date: `${validFrom} 00:00:00`,
      end_date: validTo ? `${validTo} 00:00:00` : undefined,
      drivers_restriction: driversRestriction,
      purpose_of_use: "Личные",
    },
  };
}

async function calculateOsago(params) {
  const requestBody = buildCalculationRequest(params);
  return apiCall("POST", "/wapi/osago/calculation", requestBody);
}

module.exports = { calculateOsago, buildCalculationRequest, apiCall, digestFetch };
