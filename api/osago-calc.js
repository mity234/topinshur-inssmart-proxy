const { apiCall, getToken, enrichOffers, offersComplete, isRateLimited, INSSMART_BASE, applyCors, getKBMInfo } = require("../lib/inssmart");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const data = req.body || {};
  const plate = String(data.plate ?? "").trim();
  const firstName = String(data.firstName ?? "").trim();
  const lastName = String(data.lastName ?? "").trim();
  const patronymic = String(data.patronymic ?? "").trim();
  const birthDate = String(data.birthDate ?? "").trim();
  const passportSeries = String(data.passportSeries ?? "").trim();
  const passportNumber = String(data.passportNumber ?? "").trim();
  const passportIssue = String(data.passportIssue ?? "").trim();
  const passportIssuePoint = String(data.passportIssuePoint ?? "").trim();
  const passportIssuePointCode = String(data.passportIssuePointCode ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const email = String(data.email ?? "").trim();
  const address = String(data.address ?? "").trim();
  const driverLicenseSeries = String(data.driverLicenseSeries ?? "").trim();
  const driverLicenseNumber = String(data.driverLicenseNumber ?? "").trim();
  const driverLicenseIssue = String(data.driverLicenseIssue ?? "").trim();
  const experienceDate = String(data.experienceDate ?? "").trim();
  const manualVehicle = data.manualVehicle && data.manualVehicle.modelId ? data.manualVehicle : null;

  if (!plate || !firstName || !lastName || !phone || !email || !address) {
    return res.status(422).json({ ok: false, error: "validation" });
  }

  const token = await getToken();
  if (!token) return res.status(502).json({ ok: false, error: "auth_failed" });

  let car;
  if (manualVehicle) {
    // User-entered fallback for when the plate isn't in Inssmart's carInfo
    // dictionary — same shape as a real carInfo response so the rest of the
    // flow (patchBody, response display) doesn't need to branch further.
    car = {
      carModelId: manualVehicle.modelId,
      carMarkName: manualVehicle.markTitle ?? "",
      carModelName: manualVehicle.modelTitle ?? "",
      carCategory: "B",
      vinNumber: manualVehicle.vin ?? null,
      year: Number(manualVehicle.year) || 2020,
      powerInHP: Number(manualVehicle.powerHp) || 100,
      stsNumber: manualVehicle.docNumber ?? "0000000000",
      stsDate: manualVehicle.docDate ?? null,
      documentType: Number(manualVehicle.docType) || 2,
    };
  } else {
    // Confirmed via real frontend traffic: OSAGO uses "type"=1, not "contractType" like KASKO does.
    const carInfoRes = await apiCall(
      "GET",
      `${INSSMART_BASE}/dictionary/carInfo?${new URLSearchParams({ query: plate, version: 4, type: 1 })}`,
      null,
      token,
    );
    car = carInfoRes.body;
    if (isRateLimited(car)) return res.status(429).json({ ok: false, error: "rate_limited", detail: car });
    if (!car || !car.carModelId) return res.status(422).json({ ok: false, error: "vehicle_not_found", detail: car });
  }

  const create = await apiCall("POST", `${INSSMART_BASE}/product-osago/contracts`, {}, token);
  const contractId = create.body?.id;
  if (!contractId) return res.status(502).json({ ok: false, error: "contract_create_failed", detail: create });

  // Auto-lookup the driver's real KBM from RSA for a more accurate premium —
  // best-effort: if the lookup fails or finds nothing, Inssmart falls back
  // to its own starting KBM, so we don't block the calculation on this.
  const kbmInfo = await getKBMInfo(token, {
    plate,
    firstName,
    lastName,
    patronymic,
    birthDate,
    driverLicenseSeries,
    driverLicenseNumber,
  }).catch(() => null);

  const validFrom = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const validTo = new Date(Date.now() + (7 + 365) * 86400000).toISOString().slice(0, 10);
  const rusPassport = `${passportSeries}${passportNumber}`;

  const patchBody = {
    validFrom,
    validTo,
    period: 12,
    purpose: 1,
    multidrive: false,
    vehicleCarModel: car.carModelId,
    vehicleCarCategory: car.carCategory ?? "B",
    vehicleDocumentType: car.documentType ?? 2,
    vehicleDocumentNumber: car.stsNumber ?? "0000000000",
    vehicleDocumentDate: car.stsDate ? String(car.stsDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    vehicleVinNumber: car.vinNumber ?? null,
    vehicleRegNumber: plate,
    vehicleNoRegNumber: false,
    vehicleYear: car.year ?? 2020,
    vehiclePower: car.powerInHP ?? 100,
    insurantPhone: phone,
    insurantEmail: email,
    insurantLegalAddress: address,
    insurantPassportNumber: passportNumber,
    insurantPassportSeries: passportSeries,
    insurantRusPassportNumber: rusPassport,
    insurantPassportIssue: passportIssue,
    insurantPassportIssuePoint: passportIssuePoint,
    insurantPassportIssuePointCode: passportIssuePointCode,
    insurantPassportForeign: false,
    insurantFirstName: firstName,
    insurantLastName: lastName,
    insurantPatronymic: patronymic,
    insurantBirthDate: birthDate,
    ownerIsInsurant: true,
    drivers: [
      {
        firstName,
        lastName,
        patronymic,
        birthDate,
        experienceDate,
        driverLicenseSeries,
        driverLicenseNumber,
        driverLicenseForeign: false,
        ...(kbmInfo?.found ? { kbm: kbmInfo.factor } : {}),
      },
    ],
  };

  const patch = await apiCall("PATCH", `${INSSMART_BASE}/product-osago/contracts/${contractId}`, patchBody, token);
  if (patch.body?.errors && Object.keys(patch.body.errors).length > 0) {
    return res.status(200).json({ ok: false, error: "validation_failed", car, fieldErrors: patch.body.errors });
  }

  await apiCall("POST", `${INSSMART_BASE}/product-osago/contracts/${contractId}/offers`, {}, token);

  let offers = [];
  let state = 0;
  for (let i = 0; i < 4; i++) {
    await sleep(3000);
    const poll = await apiCall("GET", `${INSSMART_BASE}/product-osago/contracts/${contractId}/offers`, null, token);
    offers = poll.body?.offers ?? [];
    state = poll.body?.state ?? 0;
    if (offersComplete(state, offers)) break;
  }

  return res.status(200).json({
    ok: true,
    car,
    contractId,
    kbmInfo,
    complete: offersComplete(state, offers),
    offers: enrichOffers(offers),
  });
};
