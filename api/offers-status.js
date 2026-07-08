const { apiCall, getToken, enrichOffers, offersComplete, INSSMART_BASE, applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const product = String(req.query.product ?? "").trim();
  const contractId = String(req.query.id ?? "").trim();
  if (!["kasko", "osago", "mortgage"].includes(product) || !contractId) {
    return res.status(422).json({ ok: false, error: "validation" });
  }

  const token = await getToken();
  if (!token) return res.status(502).json({ ok: false, error: "auth_failed" });

  const poll = await apiCall("GET", `${INSSMART_BASE}/product-${product}/contracts/${contractId}/offers`, null, token);
  const rawOffers = poll.body?.offers ?? [];
  const state = poll.body?.state ?? 0;

  return res.status(200).json({
    ok: true,
    complete: offersComplete(state, rawOffers),
    offers: enrichOffers(rawOffers),
  });
};
