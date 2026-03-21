const path = require("path");
const fs = require("fs");

let APPEAL_STATS = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "appeal-stats.json"), "utf-8");
  APPEAL_STATS = JSON.parse(raw);
} catch (e) {
  console.warn("appeal-stats.json not found", e.message);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.json(APPEAL_STATS);
};
