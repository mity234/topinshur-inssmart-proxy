// Standalone test endpoint for the direct Ingosstrakh OSAGO integration —
// separate from the main osago-calc.js (Inssmart-backed) while this is being
// verified. Not wired into the main calculator yet.
const { calculateOsago } = require("../lib/ingosstrakh");
const { applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  if (!process.env.INGOSSTRAKH_CLIENT_ID || !process.env.INGOSSTRAKH_CLIENT_SECRET) {
    return res.status(500).json({ ok: false, error: "not_configured", detail: "INGOSSTRAKH_CLIENT_ID/SECRET not set" });
  }

  const data = req.body || {};
  try {
    const result = await calculateOsago(data);
    return res.status(200).json({ ok: result.status === 200, status: result.status, body: result.body });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "request_failed", detail: String(e) });
  }
};
