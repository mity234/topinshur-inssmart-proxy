// Direct integration with AlfaStrakhovanie's own calculation APIs — found via
// their developer portal (api.alfastrah.ru), not through Inssmart. Confirmed
// products/endpoints for all three of our calculator's lines of business:
//   - OSAGO:   POST /wapi/osago/calculation   (osago-calculation-relaunch)
//   - KASKO:   POST /wapi/kasko/calculation   (kasko-calculation) — same
//     server/auth; request adds damage/theft/total risk flags, GAP,
//     additional equipment, leasing, УТС as separate sub-objects.
//   - Ипотека: POST /wapi/ipoteka/calculation (ipoteka-calculation) — request
//     schema has dedicated PropertyRisk/TitleRisk/InsurerLifeRisk objects,
//     matching our own property/title/life breakdown already built for the
//     Inssmart-backed mortgage calculator.
// Only OSAGO's request builder is fully mapped below — KASKO/mortgage need
// their field-by-field mapping finished once live credentials let us verify
// assumptions against real validation errors (same technique used throughout
// this project for the Inssmart integration).
//
// Real Digest Auth credentials issued 2026-07-12 (login is shared across
// environments, password is NOT — test and prod each have their own).
// Still waiting on the "agent block" IDs (agent_contract_id, channel_sale_id,
// department_id, signer_id, manager_id) that identify our agency in their
// system — the user mentioned a table with an "ID" column but it didn't come
// through in the chat message, need to ask again. Spec confirmed via their
// real OpenAPI 3.1 documents fetched from the portal for all three products.

const crypto = require("crypto");

const ALFASTRAKH_ENV = process.env.ALFASTRAKH_ENV || "test"; // "test" or "prod"
const ALFASTRAKH_BASE_URLS = {
  test: "https://b2b-test2.alfastrah.ru",
  prod: "https://b2b.alfastrah.ru",
};
const ALFASTRAKH_BASE = ALFASTRAKH_BASE_URLS[ALFASTRAKH_ENV];
const ALFASTRAKH_USERNAME = process.env.ALFASTRAKH_USERNAME;
const ALFASTRAKH_PASSWORD =
  ALFASTRAKH_ENV === "prod" ? process.env.ALFASTRAKH_PROD_PASSWORD : process.env.ALFASTRAKH_TEST_PASSWORD;

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
  cityLocationPlace, // required by AlfaStrakh's address validation — plain city name (e.g. "Санкт-Петербург")
  region, // also required alongside location_place — e.g. "г Санкт-Петербург" or the region name
  additionalDrivers = [], // drivers beyond the policyholder — same shape as the rest of the app's AdditionalDriver type
}) {
  const person = {
    person_data: {
      first_name: firstName,
      last_name: lastName,
      middle_name: patronymic || undefined,
      birth_date: birthDate,
      sex: gender === "2" ? "FEMALE" : "MALE",
      addresses: [
        {
          address_type: "Регистрации",
          location_place: cityLocationPlace,
          region: region || cityLocationPlace,
          street: address,
        },
      ],
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
      ...additionalDrivers.map((d) => ({
        driver_data: {
          first_name: d.firstName,
          last_name: d.lastName,
          middle_name: d.patronymic || undefined,
          birth_date: d.birthDate,
          sex: d.gender === "2" ? "FEMALE" : "MALE",
          driver_document: {
            document_type: "Водительское удостоверение РФ",
            document_series: d.driverLicenseSeries,
            document_number: d.driverLicenseNumber,
            issue_date: d.driverLicenseIssue,
            driving_experience_date: d.experienceDate,
          },
        },
      })),
    ],
    transport_owner: { person },
    transport_insurer: { person },
    vehicle: {
      identity: { licence_plate: plate, vin: vin || undefined },
      // Confirmed live: AlfaStrakh's vehicle dictionary match is case-sensitive
      // and expects uppercase (docs examples use "FORD"/"FOCUS"; lowercase
      // "Audi"/"Q3" silently produced a 500 "unrecognized system error").
      mark: carMark ? carMark.toUpperCase() : carMark,
      model: carModel ? carModel.toUpperCase() : carModel,
      category: carCategory || "B - легковые",
      production_year: carYear,
      power_hp: carPowerHp,
      registration_country: "Россия",
      use_with_trailer: false,
      registration_documents: [
        {
          document_type: "Паспорт ТС",
          document_number: "000000",
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

// Builds AlfaStrakh's KASKO request shape — camelCase, notably different
// from OSAGO's snake_case (separate product team/schema). Some dictionary
// values (Document.docType numeric code, Insurance.marketingProductName)
// aren't confirmed yet — best-effort placeholders, expect validation errors
// on first live calls and iterate the same way OSAGO's mapping was fixed.
function buildKaskoRequest({
  plate,
  vin,
  carMark,
  carModel,
  carYear,
  carPowerHp,
  vehicleCost,
  firstName,
  lastName,
  patronymic,
  birthDate,
  gender, // "1" male / "2" female
  passportSeries,
  passportNumber,
  passportIssue,
  address,
  cityLocationPlace,
  phone,
  email,
  driverLicenseSeries,
  driverLicenseNumber,
  experienceDate,
  validFrom,
  validTo,
  additionalDrivers = [],
  multidrive = false,
}) {
  const sex = gender === "2" ? "female" : "male";
  const fullAddress = [cityLocationPlace, address].filter(Boolean).join(", ");

  const person = {
    sex,
    lastName,
    firstName,
    middleName: patronymic || undefined,
    birthDate,
    isResident: true,
    address: { addressType: 1, fullAddress, country: "Россия" },
    document: {
      docType: 1, // TODO: unconfirmed casco_document_type code for "Паспорт РФ"
      docSeries: passportSeries,
      docNumber: passportNumber,
      issueDate: passportIssue,
    },
    phone: phone ? { phoneType: 1, phone: phone.replace(/\D/g, "") } : undefined,
    email,
  };

  const allDrivers = [
    {
      sex,
      firstName,
      lastName,
      middleName: patronymic || undefined,
      birthDate,
      experienceDate,
      licenseSerialNumber: driverLicenseSeries,
      licenseNumber: driverLicenseNumber,
      firstDateAppearance: validFrom,
    },
    ...additionalDrivers.map((d) => ({
      sex: d.gender === "2" ? "female" : "male",
      firstName: d.firstName,
      lastName: d.lastName,
      middleName: d.patronymic || undefined,
      birthDate: d.birthDate,
      experienceDate: d.experienceDate,
      licenseSerialNumber: d.driverLicenseSeries,
      licenseNumber: d.driverLicenseNumber,
      firstDateAppearance: validFrom,
    })),
  ];

  return {
    calculation: { calcType: "FIRST" },
    insurance: {
      insuranceTerm: { beginDate: `${validFrom}T00:00:00`, endDate: `${validTo}T00:00:00` },
      agreementType: "Первоначальный",
      marketingProductName: "КАСКО", // TODO: unconfirmed casco_marketing_product_name value
      multidrive: multidrive ? { age: 21, experience: 3, type: "Мультидрайв" } : undefined,
    },
    insurant: { person },
    owner: { person },
    beneficiaries: [],
    drivers: multidrive ? undefined : allDrivers,
    vehicle: {
      vin: vin || undefined,
      licensePlate: plate || undefined,
      brand: carMark ? carMark.toUpperCase() : carMark,
      model: carModel ? carModel.toUpperCase() : carModel,
      power: carPowerHp,
      vehicleCost,
      year: carYear,
      newTS: false,
      ownershipDate: validFrom,
    },
    damage: true,
    theft: true,
    total: true,
  };
}

async function calculateKasko(params) {
  const requestBody = buildKaskoRequest(params);
  return apiCall("POST", "/wapi/kasko/calculation", requestBody);
}

// TODO: same as calculateKasko — endpoint confirmed (POST
// /wapi/ipoteka/calculation), schema has PropertyRisk/TitleRisk/
// InsurerLifeRisk objects matching our existing property/title/life
// breakdown, but not yet mapped field-by-field.
async function calculateIpoteka(requestBody) {
  return apiCall("POST", "/wapi/ipoteka/calculation", requestBody);
}

module.exports = {
  calculateOsago,
  calculateKasko,
  calculateIpoteka,
  buildCalculationRequest,
  buildKaskoRequest,
  apiCall,
  digestFetch,
};
