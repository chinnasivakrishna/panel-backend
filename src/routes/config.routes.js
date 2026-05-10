import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { authGuard } from "../middleware/auth.js";
import { query } from "../config/db.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toCodeFromRoute(route) {
  return String(route || "")
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "")
    .replace(/\//g, "_")
    .toLowerCase() || "page";
}

async function syncModulesWithNav(orgId) {
  const navRows = await query(
    `SELECT label, route, icon
     FROM nav_items
     WHERE org_id = ? AND is_active = 1`,
    [orgId]
  );
  const moduleRows = await query(
    `SELECT id, route FROM modules WHERE org_id = ?`,
    [orgId]
  );
  const existingRoutes = new Set(moduleRows.map((m) => m.route));
  const ignore = new Set(["/dashboard", "/profile", "/settings"]);
  const desiredRoutes = new Set(
    navRows
      .map((n) => n.route)
      .filter((r) => r && !ignore.has(r))
  );

  for (const nav of navRows) {
    if (!nav.route || ignore.has(nav.route) || existingRoutes.has(nav.route)) continue;
    await query(
      `INSERT INTO modules (org_id, code, name, icon, route, ui_config_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        orgId,
        toCodeFromRoute(nav.route),
        nav.label || toCodeFromRoute(nav.route),
        nav.icon || "CircleDot",
        nav.route,
        JSON.stringify({
          pageTitle: nav.label || "Page",
          pageSubtitle: "Configured from sidebar item",
          filterDefs: [
            { key: "q", label: "Search", filterType: "search", placeholder: "Search…" },
            { key: "asOf", label: "Date", filterType: "date" }
          ],
          cards: [],
          tableColumns: [],
          tableTitle: `${nav.label || "Page"} Table`,
          tableSubtitle: "Configure columns in Settings (metrics and/or record fields)."
        })
      ]
    );
  }

  for (const mod of moduleRows) {
    if (!mod.route || ignore.has(mod.route)) continue;
    if (!desiredRoutes.has(mod.route)) {
      await query(`DELETE FROM modules WHERE id = ? AND org_id = ?`, [mod.id, orgId]);
    }
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(__dirname, "..", "..", "uploads", "logos"));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `org-${req.user.orgId}-logo-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  }
});

router.get("/panel", authGuard, async (req, res) => {
  try {
    const orgId = req.user.orgId;
    await syncModulesWithNav(orgId);

    const branding = await query(
      "SELECT config_key, config_value FROM org_config WHERE org_id = ?",
      [orgId]
    );
    // De-duplicate nav entries by route+position in case seed ran multiple times.
    const nav = await query(
      `SELECT MIN(id) AS id, MIN(label) AS label, MIN(icon) AS icon, route, position, MIN(sort_order) AS sort_order
       FROM nav_items
       WHERE org_id = ? AND is_active = 1
       GROUP BY route, position
       ORDER BY position ASC, sort_order ASC`,
      [orgId]
    );
    const widgets = await query(
      `SELECT code, title, enabled, layout_size
       FROM dashboard_widgets WHERE org_id = ? ORDER BY sort_order ASC`,
      [orgId]
    );
    const homeCards = await query(
      `SELECT id, code, title, subtitle, accent, enabled, sort_order, config_json
       FROM home_cards WHERE org_id = ? ORDER BY sort_order ASC`,
      [orgId]
    );
    const modules = await query(
      `SELECT id, code, name, icon, route, ui_config_json, is_active
       FROM modules WHERE org_id = ? AND is_active = 1
       ORDER BY name ASC`,
      [orgId]
    );
    let metrics = {};
    try {
      const metricRows = await query(
        `SELECT metric_key, value_text FROM org_metric_values WHERE org_id = ?`,
        [orgId]
      );
      metrics = metricRows.reduce((acc, row) => {
        acc[row.metric_key] = row.value_text;
        return acc;
      }, {});
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || e || "");
      // Existing DBs before org_metric_values migration — panel must still load nav/modules/cards.
      if (/doesn't exist|unknown table|table.*not exist/i.test(msg)) {
        console.warn("[config/panel] org_metric_values missing; run `npm run db:migrate`. Metrics disabled.");
      } else {
        console.warn("[config/panel] metrics query failed:", msg);
      }
    }

    const config = branding.reduce((acc, row) => {
      acc[row.config_key] = row.config_value;
      return acc;
    }, {});

    return res.json({ config, nav, widgets, homeCards, modules, metrics });
  } catch {
    return res.status(500).json({ message: "Could not load panel configuration" });
  }
});

router.patch("/panel", authGuard, async (req, res) => {
  // Enterprise default: only admins can change org-wide branding/config.
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

  const orgId = req.user.orgId;
  const { config } = req.body || {};
  if (!config || typeof config !== "object") {
    return res.status(400).json({ message: "Missing config payload" });
  }

  const allowedKeys = new Set([
    "app_name",
    "logo_url",
    "color_root",
    "color_secondary",
    "color_tertiary",
    "support_widget_enabled"
  ]);

  const entries = Object.entries(config).filter(([k, v]) => allowedKeys.has(k) && v !== undefined && v !== null);
  if (entries.length === 0) return res.status(400).json({ message: "No valid config keys" });

  try {
    // Upsert each key
    for (const [key, value] of entries) {
      await query(
        `INSERT INTO org_config (org_id, config_key, config_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [orgId, key, String(value)]
      );
    }
    return res.json({ message: "Config updated" });
  } catch {
    return res.status(500).json({ message: "Could not update configuration" });
  }
});

router.post("/panel/logo", authGuard, (req, res) => {
  // Enterprise default: only admins can change org-wide branding/config.
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

  upload.single("logo")(req, res, async (err) => {
    if (err) {
      const msg = err?.message || "Upload failed";
      const isSize = msg.toLowerCase().includes("file too large");
      return res.status(400).json({
        message: isSize ? "Logo must be <= 2MB" : msg
      });
    }

    if (!req.file) return res.status(400).json({ message: "Logo file is required" });

    const logoUrl = `/uploads/logos/${req.file.filename}`;
    try {
      await query(
        `INSERT INTO org_config (org_id, config_key, config_value)
         VALUES (?, 'logo_url', ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [req.user.orgId, logoUrl]
      );
      return res.status(201).json({ logoUrl });
    } catch {
      return res.status(500).json({ message: "Could not save logo" });
    }
  });
});

export default router;
