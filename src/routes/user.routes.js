import express from "express";
import { authGuard } from "../middleware/auth.js";
import { query } from "../config/db.js";

const router = express.Router();
router.use(authGuard);

router.get("/me", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, full_name, email, role, theme_preference
       FROM users WHERE id = ? LIMIT 1`,
      [req.user.sub]
    );
    return res.json(rows[0] || null);
  } catch {
    return res.status(500).json({ message: "Unable to fetch profile" });
  }
});

router.patch("/me/theme", async (req, res) => {
  const { theme } = req.body;
  if (!["light", "dark"].includes(theme)) {
    return res.status(400).json({ message: "Invalid theme" });
  }
  try {
    await query("UPDATE users SET theme_preference = ? WHERE id = ?", [theme, req.user.sub]);
    return res.json({ message: "Theme updated" });
  } catch {
    return res.status(500).json({ message: "Could not update theme" });
  }
});

export default router;
