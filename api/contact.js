module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, pin, issueType, message } = req.body;
    if (!email || !message) return res.status(400).json({ error: "Email and message are required" });

    const submission = {
      id: Date.now(),
      name: name || "",
      email,
      pin: pin || "",
      issueType: issueType || "other",
      message,
      createdAt: new Date().toISOString(),
    };

    // Log to Vercel's function logs (viewable in dashboard)
    console.log("CONTACT_SUBMISSION:", JSON.stringify(submission));

    res.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ error: "Failed to submit message" });
  }
};
