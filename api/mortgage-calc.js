const { apiCall, getToken, enrichOffers, offersComplete, isRateLimited, INSSMART_BASE, applyCors } = require("../lib/inssmart");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const data = req.body || {};
  const creditValue = Number(data.creditValue ?? 0);
  const birthDate = String(data.birthDate ?? "").trim();
  const insurantGender = Number(data.insurantGender ?? 1);
  const buildingType = Number(data.buildingType ?? 0);
  const bank = Number(data.bank ?? 0);
  const firstName = String(data.firstName ?? "").trim();
  const lastName = String(data.lastName ?? "").trim();
  const patronymic = String(data.patronymic ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const email = String(data.email ?? "").trim();
  const address = String(data.address ?? "").trim();
  const passportSeries = String(data.passportSeries ?? "").trim();
  const passportNumber = String(data.passportNumber ?? "").trim();
  const passportIssue = String(data.passportIssue ?? "").trim();
  const passportIssuePoint = String(data.passportIssuePoint ?? "").trim();
  const passportIssuePointCode = String(data.passportIssuePointCode ?? "").trim();
  const propertyAddress = String(data.propertyAddress ?? "").trim();
  const propertyYear = String(data.propertyYear ?? "").trim();
  const propertyCost = Number(data.propertyCost ?? 0);
  const titleInsurance = data.titleInsurance !== false;

  if (!creditValue || !birthDate || !firstName || !lastName || !phone || !email || !address || !propertyAddress) {
    return res.status(422).json({ ok: false, error: "validation" });
  }

  const token = await getToken();
  if (!token) return res.status(502).json({ ok: false, error: "auth_failed" });

  const createBody = {
    insurantBirthDate: birthDate,
    insurantGender,
    creditValue,
    bank,
    propertyInsurance: true,
    lifeInsurance: true,
    titleInsurance,
    buildingType,
  };
  const create = await apiCall("POST", `${INSSMART_BASE}/product-mortgage/contracts`, createBody, token);
  const contractId = create.body?.id;
  if (!contractId) {
    if (isRateLimited(create.body)) return res.status(429).json({ ok: false, error: "rate_limited", detail: create.body });
    return res.status(502).json({ ok: false, error: "contract_create_failed", detail: create });
  }

  const validFrom = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const validTo = new Date(Date.now() + (7 + 365) * 86400000).toISOString().slice(0, 10);
  const rusPassport = `${passportSeries}${passportNumber}`;

  const patchBody = {
    validFrom,
    validTo,
    period: 12,
    insurantPhone: phone,
    insurantEmail: email,
    insurantAddress: address,
    insurantPassportNumber: passportNumber,
    insurantPassportSeries: passportSeries,
    insurantRusPassportNumber: rusPassport,
    insurantPassportIssue: passportIssue,
    insurantPassportIssuePoint: passportIssuePoint,
    insurantPassportIssuePointCode: passportIssuePointCode,
    insurantFirstName: firstName,
    insurantLastName: lastName,
    insurantPatronymic: patronymic,
    propertyAddress,
    propertyYear,
    propertyCost: propertyCost || creditValue,
    propertySquare: "50",
    propertyFloor: 5,
    propertyFloorsCount: 10,
    saleType: 1,
    employment: "работник_по_найму",
    hasDisease: false,
    hasProfessionRisk: false,
    isMilitaryMortgage: false,
  };

  const patch = await apiCall("PATCH", `${INSSMART_BASE}/product-mortgage/contracts/${contractId}`, patchBody, token);
  if (patch.body?.errors && Object.keys(patch.body.errors).length > 0) {
    return res.status(200).json({ ok: false, error: "validation_failed", fieldErrors: patch.body.errors });
  }

  await apiCall("POST", `${INSSMART_BASE}/product-mortgage/contracts/${contractId}/offers`, { estimate: true }, token);

  let offers = [];
  let state = 0;
  for (let i = 0; i < 4; i++) {
    await sleep(3000);
    const poll = await apiCall("GET", `${INSSMART_BASE}/product-mortgage/contracts/${contractId}/offers`, null, token);
    offers = poll.body?.offers ?? [];
    state = poll.body?.state ?? 0;
    if (offersComplete(state, offers)) break;
  }

  return res.status(200).json({
    ok: true,
    contractId,
    complete: offersComplete(state, offers),
    offers: enrichOffers(offers),
  });
};
