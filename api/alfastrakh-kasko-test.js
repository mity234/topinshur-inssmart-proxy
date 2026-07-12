// Standalone test endpoint for the direct AlfaStrakhovanie KASKO integration —
// field mapping is a first draft, expect to iterate against real validation
// errors before this is reliable.
const { calculateKasko } = require("../lib/alfastrakh");
const { applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  if (!process.env.ALFASTRAKH_USERNAME || !(process.env.ALFASTRAKH_TEST_PASSWORD || process.env.ALFASTRAKH_PROD_PASSWORD)) {
    return res.status(500).json({ ok: false, error: "not_configured" });
  }

  const data = req.body || {};
  try {
    const result = await calculateKasko(data);
    return res.status(200).json({ ok: result.status === 200, status: result.status, body: result.body });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "request_failed", detail: String(e) });
  }
};
