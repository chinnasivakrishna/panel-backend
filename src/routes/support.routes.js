import express from "express";
import { authGuard } from "../middleware/auth.js";
import { query } from "../config/db.js";
import { TICKET_STATUS } from "../config/constants.js";

const router = express.Router();
router.use(authGuard);

router.get("/tickets", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, ticket_type, title, description, status, created_at
       FROM support_tickets
       WHERE org_id = ?
       ORDER BY created_at DESC`,
      [req.user.orgId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch tickets" });
  }
});

router.post("/tickets", async (req, res) => {
  const { ticketType, title, description } = req.body;
  if (!ticketType || !title) return res.status(400).json({ message: "Missing required fields" });

  try {
    await query(
      `INSERT INTO support_tickets
       (org_id, created_by, ticket_type, title, description, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.orgId, req.user.sub, ticketType, title, description || "", TICKET_STATUS.OPEN]
    );
    return res.status(201).json({ message: "Ticket created" });
  } catch {
    return res.status(500).json({ message: "Unable to create ticket" });
  }
});

export default router;
