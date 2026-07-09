// Ingosstrakh's own car mark/model dictionaries — needed to resolve
// `carModelIsn` for the calculation request. Not wired into the main
// calculator UI yet (waiting on live credentials to verify the shape).
const { searchMarks, searchModels } = require("../lib/ingosstrakh");
const { applyCors } = require("../lib/inssmart");

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!process.env.INGOSSTRAKH_CLIENT_ID || !process.env.INGOSSTRAKH_CLIENT_SECRET) {
    return res.status(500).json({ ok: false, error: "not_configured" });
  }

  const query = String(req.query.q ?? "").trim();
  const markIsn = req.query.markIsn ? String(req.query.markIsn) : null;
  if (query.length < 2) return res.status(200).json({ items: [] });

  const result = markIsn ? await searchModels(markIsn, query) : await searchMarks(query);
  return res.status(200).json({ ok: true, raw: result });
};
