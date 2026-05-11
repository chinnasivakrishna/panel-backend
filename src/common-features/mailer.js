import nodemailer from "nodemailer";

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
  return cachedTransporter;
}

export async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "smtp_not_configured" };

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    return { sent: true, messageId: info?.messageId || null };
  } catch (e) {
    return {
      sent: false,
      reason: "smtp_send_failed",
      error: {
        message: e?.message || String(e),
        code: e?.code,
        response: e?.response,
        responseCode: e?.responseCode,
        command: e?.command
      }
    };
  }
}

