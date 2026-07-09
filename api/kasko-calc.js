const { apiCall, getToken, enrichOffers, offersComplete, isRateLimited, INSSMART_BASE, applyCors } = require("../lib/inssmart");

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
  const gender = Number(data.gender ?? 1);
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
  const usePreviousPolicy = !!data.usePreviousPolicy;
  const previousPolicyCompany =
    data.previousPolicyCompany !== null && data.previousPolicyCompany !== undefined && data.previousPolicyCompany !== ""
      ? Number(data.previousPolicyCompany)
      : null;
  const manualVehicle = data.manualVehicle && data.manualVehicle.modelId ? data.manualVehicle : null;
  const additionalDrivers = Array.isArray(data.additionalDrivers) ? data.additionalDrivers : [];
  // Repair type(s): 1 = у дилера, 4 = на СТОА по направлению страховой. Requesting
  // both by default gets offers from companies that only support one or the other —
  // requesting just [1] (the old hardcoded value) excluded a lot of companies.
  const repairOptions =
    Array.isArray(data.repairOptions) && data.repairOptions.length > 0 ? data.repairOptions.map(Number) : [1, 4];
  const deductibleAmount =
    data.deductibleAmount !== undefined && data.deductibleAmount !== null && data.deductibleAmount !== ""
      ? Number(data.deductibleAmount)
      : -1;
  const deductibleType = Number(data.deductibleType ?? 1);
  const gap = !!data.gap;

  if (!plate || !firstName || !lastName || !phone || !email) {
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
      vinNumber: manualVehicle.vin ?? null,
      year: Number(manualVehicle.year) || 2020,
      powerInHP: Number(manualVehicle.powerHp) || 100,
      stsNumber: manualVehicle.docNumber ?? "0000000000",
      stsDate: manualVehicle.docDate ?? null,
      documentType: Number(manualVehicle.docType) || 2,
    };
  } else {
    const carInfoRes = await apiCall(
      "GET",
      `${INSSMART_BASE}/dictionary/carInfo?${new URLSearchParams({ query: plate, version: 4, contractType: 4000 })}`,
      null,
      token,
    );
    car = carInfoRes.body;
    if (isRateLimited(car)) return res.status(429).json({ ok: false, error: "rate_limited", detail: car });
    if (!car || !car.carModelId) return res.status(422).json({ ok: false, error: "vehicle_not_found", detail: car });
  }

  const create = await apiCall("POST", `${INSSMART_BASE}/product-kasko/contracts`, {}, token);
  const contractId = create.body?.id;
  if (!contractId) return res.status(502).json({ ok: false, error: "contract_create_failed", detail: create });

  const validFrom = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const validTo = new Date(Date.now() + (7 + 365) * 86400000).toISOString().slice(0, 10);
  const rusPassport = `${passportSeries} ${passportNumber}`.trim();

  const patchBody = {
    validFrom,
    validTo,
    period: 12,
    usePreviousPolicy,
    previousPolicyCompany,
    repairOptions,
    isNewVehicle: false,
    purpose: 1,
    multidrive: false,
    vehicleCarModel: car.carModelId,
    vehicleVinNumber: car.vinNumber ?? null,
    vehicleRegNumber: plate,
    vehicleNoRegNumber: false,
    vehicleTypeOfNumber: 0,
    vehicleDocumentType: car.documentType ?? 2,
    vehicleDocumentNumber: car.stsNumber ?? "0000000000",
    vehicleDocumentDate: car.stsDate ? String(car.stsDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    vehicleYear: car.year ?? 2020,
    vehiclePower: car.powerInHP ?? 100,
    vehicleMileage: 30000,
    vehicleCost: Number(data.vehicleCost ?? 2000000),
    vehiclePurchaseDate: car.stsDate ? String(car.stsDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    vehicleHasAntiTheftSystem: false,
    isCredit: false,
    insurantPhone: phone,
    insurantEmail: email,
    coverageProgram: 1,
    insurantLegalAddress: address,
    insurantPassportNumber: passportNumber,
    insurantPassportSeries: passportSeries,
    insurantRusPassportNumber: rusPassport,
    insurantPassportIssue: passportIssue,
    insurantPassportIssuePoint: passportIssuePoint,
    insurantPassportIssuePointCode: passportIssuePointCode,
    insurantFirstName: firstName,
    insurantLastName: lastName,
    insurantPatronymic: patronymic,
    insurantBirthDate: birthDate,
    insurantGender: gender,
    insurantIsJuridical: false,
    ownerIsJuridical: false,
    ownerIsInsurant: true,
    contactEmail: email,
    contactPhone: phone,
    options: { deductibleAmounts: [deductibleAmount], deductibleType, gap },
    drivers: [
      {
        isMarried: false,
        driverType: 3,
        firstName,
        lastName,
        patronymic,
        birthDate,
        gender,
        driverLicenseSeries,
        driverLicenseNumber,
        driverRusLicenseNumber: `${driverLicenseSeries} ${driverLicenseNumber}`.trim(),
        driverLicenseIssue,
        experienceDate,
      },
      ...additionalDrivers.map((d) => {
        const dLicenseSeries = String(d.driverLicenseSeries ?? "").trim();
        const dLicenseNumber = String(d.driverLicenseNumber ?? "").trim();
        return {
          isMarried: false,
          driverType: 3,
          firstName: String(d.firstName ?? "").trim(),
          lastName: String(d.lastName ?? "").trim(),
          patronymic: String(d.patronymic ?? "").trim(),
          birthDate: String(d.birthDate ?? "").trim(),
          gender: Number(d.gender ?? 1),
          driverLicenseSeries: dLicenseSeries,
          driverLicenseNumber: dLicenseNumber,
          driverRusLicenseNumber: `${dLicenseSeries} ${dLicenseNumber}`.trim(),
          driverLicenseIssue: String(d.driverLicenseIssue ?? "").trim(),
          experienceDate: String(d.experienceDate ?? "").trim(),
        };
      }),
    ],
  };

  const patch = await apiCall("PATCH", `${INSSMART_BASE}/product-kasko/contracts/${contractId}`, patchBody, token);
  if (patch.body?.errors && Object.keys(patch.body.errors).length > 0) {
    return res.status(200).json({ ok: false, error: "validation_failed", car, fieldErrors: patch.body.errors });
  }

  await apiCall("POST", `${INSSMART_BASE}/product-kasko/contracts/${contractId}/offers`, {}, token);

  let offers = [];
  let state = 0;
  for (let i = 0; i < 4; i++) {
    await sleep(3000);
    const poll = await apiCall("GET", `${INSSMART_BASE}/product-kasko/contracts/${contractId}/offers`, null, token);
    offers = poll.body?.offers ?? [];
    state = poll.body?.state ?? 0;
    if (offersComplete(state, offers)) break;
  }

  return res.status(200).json({
    ok: true,
    car,
    contractId,
    complete: offersComplete(state, offers),
    offers: enrichOffers(offers),
  });
};
