const { apiCall, getToken, INSSMART_BASE, applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const mark = String(req.query.mark ?? "").trim();
  const query = String(req.query.q ?? "").trim();
  if (!mark) return res.status(200).json({ items: [] });

  const token = await getToken();
  if (!token) return res.status(502).json({ items: [], error: "auth_failed" });

  const params = { mark, version: 4 };
  if (query) params.title = query;
  const r = await apiCall("GET", `${INSSMART_BASE}/dictionary/types/0/carModels?${new URLSearchParams(params)}`, null, token);
  const items = (r.body?.items ?? []).map((it) => ({ id: it.id, title: it.title })).filter((it) => it.id && it.title);

  return res.status(200).json({ items });
};
