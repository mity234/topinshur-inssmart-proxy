const { apiCall, getToken, INSSMART_BASE, applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const query = String(req.query.q ?? "").trim();
  if (query.length < 2) return res.status(200).json({ items: [] });

  const token = await getToken();
  if (!token) return res.status(502).json({ items: [], error: "auth_failed" });

  const r = await apiCall("GET", `${INSSMART_BASE}/dictionary/fms?${new URLSearchParams({ query })}`, null, token);
  const items = (r.body?.items ?? [])
    .map((it) => ({ name: it.name, code: it.code }))
    .filter((it) => it.name && it.code);

  return res.status(200).json({ items });
};
