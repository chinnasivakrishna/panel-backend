import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { authGuard } from "../middleware/auth.js";
import { adminGuard } from "../middleware/admin.js";
import { query } from "../config/db.js";
import { TICKET_STATUS } from "../config/constants.js";
import { sendMail } from "../common-features/mailer.js";

const router = express.Router();
router.use(authGuard);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORT_ALERT_EMAIL = "tectrole@gmail.com";

const SUPPORT_UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads", "support");
if (!fs.existsSync(SUPPORT_UPLOAD_DIR)) {
  fs.mkdirSync(SUPPORT_UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SUPPORT_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || "";
      cb(null, `org-${req.user.orgId}-ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"
    ].includes(file.mimetype);
    cb(ok ? null : new Error("Only images, PDF, DOC/DOCX, TXT files are allowed"), ok);
  }
});

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function notifyUploadIssue({ reason, req, ticketType, title }) {
  try {
    const mail = await sendMail({
      to: SUPPORT_ALERT_EMAIL,
      subject: `[Support Upload Issue] Org ${req.user.orgId} - ${reason}`,
      text: [
        `Reason: ${reason}`,
        `Org ID: ${req.user.orgId}`,
        `User ID: ${req.user.sub}`,
        `Ticket Type: ${ticketType || "-"}`,
        `Title: ${title || "-"}`,
        `When: ${new Date().toISOString()}`
      ].join("\n")
    });
    console.log("[support-mail] upload issue alert result:", mail);
  } catch (e) {
    console.warn("Could not send upload issue alert email:", e?.message || e);
  }
}

async function notifyTicketCreated({ req, ticketType, title, description, attachments }) {
  const text = [
    "New support ticket created",
    `Org ID: ${req.user.orgId}`,
    `User ID: ${req.user.sub}`,
    `Type: ${ticketType}`,
    `Title: ${title}`,
    `Description: ${description || "-"}`,
    `Attachments: ${attachments?.length || 0}`,
    `When: ${new Date().toISOString()}`
  ].join("\n");

  const result = await sendMail({
    to: SUPPORT_ALERT_EMAIL,
    subject: `[Support Ticket] Org ${req.user.orgId} - ${title}`,
    text
  });
  console.log("[support-mail] ticket created mail result:", result);
  return result;
}

async function notifyTicketDecision({ req, id, decision, note }) {
  const result = await sendMail({
    to: SUPPORT_ALERT_EMAIL,
    subject: `[Support Decision] Ticket #${id} - ${decision}`,
    text: [
      "Support ticket decision updated",
      `Org ID: ${req.user.orgId}`,
      `Ticket ID: ${id}`,
      `Decision: ${decision}`,
      `Note: ${note || "-"}`,
      `Decided By User ID: ${req.user.sub}`,
      `When: ${new Date().toISOString()}`
    ].join("\n")
  });
  console.log("[support-mail] ticket decision mail result:", result);
  return result;
}

router.get("/tickets", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, ticket_type, title, description, attachments_json, status, decision_status, decision_note,
              decided_by, decided_at, created_at, updated_at
       FROM tb_project_support_tickets
       WHERE org_id = ?
       ORDER BY created_at DESC`,
      [req.user.orgId]
    );
    return res.json(
      rows.map((r) => ({
        ...r,
        attachments: parseJson(r.attachments_json, []) || []
      }))
    );
  } catch {
    return res.status(500).json({ message: "Unable to fetch tickets" });
  }
});

router.post("/tickets", (req, res) => {
  upload.array("attachments", 5)(req, res, async (err) => {
    const ticketType = req.body?.ticketType;
    const title = req.body?.title;
    const description = req.body?.description;
    if (err) {
      await notifyUploadIssue({
        reason: err?.message || "upload_failed",
        req,
        ticketType,
        title
      });
      return res.status(400).json({ message: err?.message || "Attachment upload failed" });
    }

    if (!ticketType || !title) return res.status(400).json({ message: "Missing required fields" });

    try {
      const attachments = (req.files || []).map((f) => ({
        name: f.originalname,
        mime: f.mimetype,
        size: f.size,
        url: `/uploads/support/${f.filename}`
      }));
      await query(
        `INSERT INTO tb_project_support_tickets
         (org_id, created_by, ticket_type, title, description, attachments_json, status, decision_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          req.user.orgId,
          req.user.sub,
          ticketType,
          title,
          description || "",
          JSON.stringify(attachments),
          TICKET_STATUS.OPEN
        ]
      );
      const mail = await notifyTicketCreated({
        req,
        ticketType,
        title,
        description,
        attachments
      });
      return res.status(201).json({
        message: "Ticket created",
        attachments,
        mailSent: Boolean(mail?.sent),
        mailReason: mail?.reason || null
      });
    } catch (e) {
      await notifyUploadIssue({
        reason: e?.message || "db_insert_failed",
        req,
        ticketType,
        title
      });
      return res.status(500).json({ message: "Unable to create ticket" });
    }
  });
});

router.patch("/tickets/:id/decision", adminGuard, async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body || {};
  if (!["accepted", "declined"].includes(String(decision || "").toLowerCase())) {
    return res.status(400).json({ message: "decision must be accepted or declined" });
  }

  try {
    await query(
      `UPDATE tb_project_support_tickets
       SET decision_status = ?, decision_note = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP
       WHERE id = ? AND org_id = ?`,
      [String(decision).toLowerCase(), note || null, req.user.sub, id, req.user.orgId]
    );
    const [row] = await query(
      `SELECT id, ticket_type, title, status, decision_status, decision_note, decided_by, decided_at
       FROM tb_project_support_tickets WHERE id = ? AND org_id = ?`,
      [id, req.user.orgId]
    );
    if (!row) return res.status(404).json({ message: "Ticket not found" });
    const mail = await notifyTicketDecision({
      req,
      id,
      decision: String(decision).toLowerCase(),
      note
    });
    return res.json({ ...row, mailSent: Boolean(mail?.sent), mailReason: mail?.reason || null });
  } catch {
    return res.status(500).json({ message: "Unable to update ticket decision" });
  }
});

export default router;
