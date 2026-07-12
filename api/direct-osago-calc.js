// Orchestrates OSAGO calculation across every insurer we have a WORKING
// direct API for (bypassing Inssmart entirely). Add a new insurer here once
// its integration is confirmed live — see plans/2026-07-10-sogaz-direct-api.md
// for the roadmap. Currently: AlfaStrakhovanie only.
const { applyCors } = require("../lib/inssmart");
const alfastrakh = require("../lib/alfastrakh");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const data = req.body || {};

  const offers = [];

  // АльфаСтрахование
  if (process.env.ALFASTRAKH_USERNAME) {
    try {
      const result = await alfastrakh.calculateOsago(data);
      if (result.status === 200 && result.body?.calculation_details?.success) {
        offers.push({
          company: "АльфаСтрахование",
          price: result.body.calculation_details.insurance_premium,
          status: "ready",
          error: null,
        });
      } else {
        const errText =
          result.body?.info ||
          result.body?.sub_errors?.map((e) => e.message).join("; ") ||
          result.body?.calculation_details?.popup_message ||
          "Не удалось получить предложение";
        offers.push({ company: "АльфаСтрахование", price: null, status: "failed", error: errText });
      }
    } catch (e) {
      offers.push({ company: "АльфаСтрахование", price: null, status: "failed", error: String(e) });
    }
  }

  return res.status(200).json({ ok: true, complete: true, offers });
};
