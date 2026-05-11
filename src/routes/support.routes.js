import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { authGuard } from "../middleware/auth.js";
import { adminGuard } from "../middleware/admin.js";
import { query } from "../config/db.js";
import { TICKET_STATUS } from "../config/constants.js";
import { sendMail } from "../common-features/mailer.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORT_ALERT_EMAIL = "tectrole@gmail.com";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function actionEmailHtml({ orgId, ticketId, ticketType, title, description, attachments, acceptUrl, declineUrl }) {
  const att = Array.isArray(attachments) ? attachments : [];
  const attachmentsHtml = att.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;color:#334155;font-size:13px;">${att
      .map((a) => `<li>${escapeHtml(a.name)} (${escapeHtml(a.mime)}${a.size ? `, ${a.size} bytes` : ""})</li>`)
      .join("")}</ul>`
    : `<div style="color:#64748b;font-size:13px;margin-top:8px;">No attachments</div>`;

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;background:#f8fafc;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#0f172a;color:#ffffff;">
        <div style="font-size:14px;opacity:.9;">Customer Service Decision</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${escapeHtml(title)}</div>
        <div style="font-size:12px;opacity:.85;margin-top:4px;">Org ${escapeHtml(orgId)} • Ticket #${escapeHtml(ticketId)} • ${escapeHtml(ticketType)}</div>
      </div>

      <div style="padding:18px;">
        <div style="color:#0f172a;font-size:14px;font-weight:600;margin-bottom:8px;">Description</div>
        <div style="color:#334155;font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(description || "-")}</div>

        <div style="margin-top:14px;color:#0f172a;font-size:14px;font-weight:600;">Attachments</div>
        ${attachmentsHtml}

        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${escapeHtml(acceptUrl)}" style="background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;font-size:13px;display:inline-block;">
            Accept
          </a>
          <a href="${escapeHtml(declineUrl)}" style="background:#ef4444;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;font-size:13px;display:inline-block;">
            Reject
          </a>
        </div>

        <div style="margin-top:14px;color:#64748b;font-size:12px;">
          These buttons are secure one-time links. If the ticket was already decided, the link will show the current status.
        </div>
      </div>
    </div>
  </div>`;
}

function decisionResultHtml({ status, title, note }) {
  const color = status === "accepted" ? "#16a34a" : status === "declined" ? "#ef4444" : "#f59e0b";
  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;background:#f8fafc;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;">
      <div style="font-size:12px;color:#64748b;">Customer Service</div>
      <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:6px;">${escapeHtml(title || "Ticket")}</div>
      <div style="margin-top:12px;font-size:14px;font-weight:800;color:${color};text-transform:capitalize;">${escapeHtml(status)}</div>
      ${note ? `<div style="margin-top:10px;color:#334155;font-size:13px;white-space:pre-wrap;">${escapeHtml(note)}</div>` : ""}
    </div>
  </div>`;
}

// Public email action endpoint (no login). Secure via token.
router.get("/tickets/:id/action", async (req, res) => {
  const id = Number(req.params.id);
  const decision = String(req.query.decision || "").toLowerCase();
  const token = String(req.query.token || "");

  if (!id || !["accepted", "declined"].includes(decision) || !token) {
    return res.status(400).send(decisionResultHtml({ status: "invalid", title: "Invalid link" }));
  }

  try {
    const [row] = await query(
      `SELECT id, title, decision_status, decision_token, decision_token_expires_at
       FROM tb_project_support_tickets
       WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).send(decisionResultHtml({ status: "not found", title: "Ticket not found" }));

    // Already decided -> show status
    if (row.decision_status && row.decision_status !== "pending") {
      return res.send(decisionResultHtml({ status: row.decision_status, title: row.title }));
    }

    const exp = row.decision_token_expires_at ? new Date(row.decision_token_expires_at).getTime() : 0;
    if (!row.decision_token || row.decision_token !== token || (exp && Date.now() > exp)) {
      return res.status(403).send(decisionResultHtml({ status: "expired", title: row.title || "Ticket" }));
    }

    await query(
      `UPDATE tb_project_support_tickets
       SET decision_status = ?, decided_at = CURRENT_TIMESTAMP,
           decision_token = NULL, decision_token_expires_at = NULL
       WHERE id = ?`,
      [decision, id]
    );

    return res.send(decisionResultHtml({ status: decision, title: row.title }));
  } catch {
    return res.status(500).send(decisionResultHtml({ status: "error", title: "Server error" }));
  }
});

// Protected routes below
router.use(authGuard);

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
      const token = crypto.randomBytes(32).toString("hex");
      await query(
        `INSERT INTO tb_project_support_tickets
         (org_id, created_by, ticket_type, title, description, attachments_json, status, decision_status, decision_token, decision_token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [
          req.user.orgId,
          req.user.sub,
          ticketType,
          title,
          description || "",
          JSON.stringify(attachments),
          TICKET_STATUS.OPEN,
          token
        ]
      );
      const [tkRow] = await query(
        `SELECT id FROM tb_project_support_tickets
         WHERE org_id = ? AND created_by = ?
         ORDER BY id DESC LIMIT 1`,
        [req.user.orgId, req.user.sub]
      );
      const ticketId = tkRow?.id;
      const acceptUrl = `${PUBLIC_BASE_URL}/api/support/tickets/${ticketId}/action?decision=accepted&token=${encodeURIComponent(token)}`;
      const declineUrl = `${PUBLIC_BASE_URL}/api/support/tickets/${ticketId}/action?decision=declined&token=${encodeURIComponent(token)}`;

      const mail = await sendMail({
        to: SUPPORT_ALERT_EMAIL,
        subject: `[Support Ticket] Org ${req.user.orgId} - ${title}`,
        text: [
          "New support ticket created",
          `Org ID: ${req.user.orgId}`,
          `User ID: ${req.user.sub}`,
          `Type: ${ticketType}`,
          `Title: ${title}`,
          `Description: ${description || "-"}`,
          `Attachments: ${attachments?.length || 0}`,
          `Accept: ${acceptUrl}`,
          `Reject: ${declineUrl}`,
          `When: ${new Date().toISOString()}`
        ].join("\n"),
        html: actionEmailHtml({
          orgId: req.user.orgId,
          ticketId,
          ticketType,
          title,
          description,
          attachments,
          acceptUrl,
          declineUrl
        })
      });
      console.log("[support-mail] ticket created mail result:", mail);
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

// Admin-only: quickly verify SMTP works in the deployed environment
router.post("/test-mail", adminGuard, async (req, res) => {
  const to = String(req.body?.to || "tectrole@gmail.com").trim();
  const result = await sendMail({
    to,
    subject: `[SMTP Test] Org ${req.user.orgId}`,
    text: `SMTP test from panel.\nOrg ID: ${req.user.orgId}\nUser ID: ${req.user.sub}\nWhen: ${new Date().toISOString()}`
  });
  return res.json(result);
});

export default router;
