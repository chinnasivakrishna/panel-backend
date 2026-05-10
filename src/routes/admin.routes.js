import express from "express";
import { authGuard } from "../middleware/auth.js";
import { adminGuard } from "../middleware/admin.js";
import { query } from "../config/db.js";

const router = express.Router();
router.use(authGuard);
router.use(adminGuard);

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

  // Remove orphan module layout configs when sidebar items are removed.
  for (const mod of moduleRows) {
    if (!mod.route || ignore.has(mod.route)) continue;
    if (!desiredRoutes.has(mod.route)) {
      await query(`DELETE FROM modules WHERE id = ? AND org_id = ?`, [mod.id, orgId]);
    }
  }
}

// ---- Modules CRUD ----
router.get("/modules", async (req, res) => {
  try {
    await syncModulesWithNav(req.user.orgId);
    const rows = await query(
      `SELECT id, code, name, icon, route, ui_config_json, is_active
       FROM modules WHERE org_id = ?
       ORDER BY name ASC`,
      [req.user.orgId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch modules" });
  }
});

router.post("/modules", async (req, res) => {
  const { code, name, icon, route, uiConfig, isActive } = req.body || {};
  if (!code || !name || !route) return res.status(400).json({ message: "code, name, route are required" });
  try {
    await query(
      `INSERT INTO modules (org_id, code, name, icon, route, ui_config_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.orgId, code, name, icon || "CircleDot", route, uiConfig ? JSON.stringify(uiConfig) : null, isActive ? 1 : 0]
    );
    return res.status(201).json({ message: "Module created" });
  } catch {
    return res.status(500).json({ message: "Unable to create module" });
  }
});

router.patch("/modules/:id", async (req, res) => {
  const { id } = req.params;
  const { name, icon, route, uiConfig, isActive } = req.body || {};
  try {
    await query(
      `UPDATE modules
       SET name = COALESCE(?, name),
           icon = COALESCE(?, icon),
           route = COALESCE(?, route),
           ui_config_json = COALESCE(?, ui_config_json),
           is_active = COALESCE(?, is_active)
       WHERE id = ? AND org_id = ?`,
      [
        name ?? null,
        icon ?? null,
        route ?? null,
        uiConfig ? JSON.stringify(uiConfig) : null,
        typeof isActive === "boolean" ? (isActive ? 1 : 0) : null,
        id,
        req.user.orgId
      ]
    );
    return res.json({ message: "Module updated" });
  } catch {
    return res.status(500).json({ message: "Unable to update module" });
  }
});

// ---- Sidebar Items CRUD ----
router.get("/nav-items", async (req, res) => {
  try {
    await syncModulesWithNav(req.user.orgId);
    const rows = await query(
      `SELECT id, label, icon, route, position, sort_order, is_active
       FROM nav_items WHERE org_id = ?
       ORDER BY position ASC, sort_order ASC`,
      [req.user.orgId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch nav items" });
  }
});

router.post("/nav-items", async (req, res) => {
  const { label, icon, route, position, sortOrder, isActive } = req.body || {};
  if (!label || !route) return res.status(400).json({ message: "label and route are required" });
  try {
    await query(
      `INSERT INTO nav_items (org_id, label, icon, route, position, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.orgId, label, icon || "CircleDot", route, position || "top", Number(sortOrder || 0), isActive === false ? 0 : 1]
    );
    await syncModulesWithNav(req.user.orgId);
    return res.status(201).json({ message: "Nav item created" });
  } catch {
    return res.status(500).json({ message: "Unable to create nav item" });
  }
});

router.patch("/nav-items/:id", async (req, res) => {
  const { id } = req.params;
  const { label, icon, route, position, sortOrder, isActive } = req.body || {};
  try {
    await query(
      `UPDATE nav_items
       SET label = COALESCE(?, label),
           icon = COALESCE(?, icon),
           route = COALESCE(?, route),
           position = COALESCE(?, position),
           sort_order = COALESCE(?, sort_order),
           is_active = COALESCE(?, is_active)
       WHERE id = ? AND org_id = ?`,
      [
        label ?? null,
        icon ?? null,
        route ?? null,
        position ?? null,
        typeof sortOrder === "number" ? sortOrder : null,
        typeof isActive === "boolean" ? (isActive ? 1 : 0) : null,
        id,
        req.user.orgId
      ]
    );
    await syncModulesWithNav(req.user.orgId);
    return res.json({ message: "Nav item updated" });
  } catch {
    return res.status(500).json({ message: "Unable to update nav item" });
  }
});

router.delete("/nav-items/:id", async (req, res) => {
  try {
    await query(`DELETE FROM nav_items WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
    return res.json({ message: "Nav item deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete nav item" });
  }
});

router.delete("/modules/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await query(`DELETE FROM modules WHERE id = ? AND org_id = ?`, [id, req.user.orgId]);
    return res.json({ message: "Module deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete module" });
  }
});

// ---- Module Fields CRUD ----
router.get("/modules/:id/fields", async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await query(
      `SELECT id, field_key, label, field_type, is_required, is_listed, sort_order, options_json
       FROM module_fields
       WHERE org_id = ? AND module_id = ?
       ORDER BY sort_order ASC`,
      [req.user.orgId, id]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch fields" });
  }
});

router.post("/modules/:id/fields", async (req, res) => {
  const { id } = req.params;
  const { fieldKey, label, fieldType, isRequired, isListed, sortOrder, options } = req.body || {};
  if (!fieldKey || !label) return res.status(400).json({ message: "fieldKey and label are required" });
  try {
    await query(
      `INSERT INTO module_fields
       (org_id, module_id, field_key, label, field_type, is_required, is_listed, sort_order, options_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.orgId,
        id,
        fieldKey,
        label,
        fieldType || "text",
        isRequired ? 1 : 0,
        isListed === false ? 0 : 1,
        Number(sortOrder || 0),
        options ? JSON.stringify(options) : null
      ]
    );
    return res.status(201).json({ message: "Field created" });
  } catch {
    return res.status(500).json({ message: "Unable to create field" });
  }
});

router.patch("/fields/:fieldId", async (req, res) => {
  const { fieldId } = req.params;
  const { label, fieldType, isRequired, isListed, sortOrder, options } = req.body || {};
  try {
    await query(
      `UPDATE module_fields
       SET label = COALESCE(?, label),
           field_type = COALESCE(?, field_type),
           is_required = COALESCE(?, is_required),
           is_listed = COALESCE(?, is_listed),
           sort_order = COALESCE(?, sort_order),
           options_json = COALESCE(?, options_json)
       WHERE id = ? AND org_id = ?`,
      [
        label ?? null,
        fieldType ?? null,
        typeof isRequired === "boolean" ? (isRequired ? 1 : 0) : null,
        typeof isListed === "boolean" ? (isListed ? 1 : 0) : null,
        typeof sortOrder === "number" ? sortOrder : null,
        options ? JSON.stringify(options) : null,
        fieldId,
        req.user.orgId
      ]
    );
    return res.json({ message: "Field updated" });
  } catch {
    return res.status(500).json({ message: "Unable to update field" });
  }
});

router.delete("/fields/:fieldId", async (req, res) => {
  const { fieldId } = req.params;
  try {
    await query(`DELETE FROM module_fields WHERE id = ? AND org_id = ?`, [fieldId, req.user.orgId]);
    return res.json({ message: "Field deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete field" });
  }
});

// ---- Home Cards CRUD ----
router.get("/home-cards", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, code, title, subtitle, accent, enabled, sort_order, config_json
       FROM home_cards WHERE org_id = ?
       ORDER BY sort_order ASC`,
      [req.user.orgId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch home cards" });
  }
});

router.post("/home-cards", async (req, res) => {
  const { code, title, subtitle, accent, enabled, sortOrder, config } = req.body || {};
  if (!code || !title) return res.status(400).json({ message: "code and title are required" });
  try {
    await query(
      `INSERT INTO home_cards (org_id, code, title, subtitle, accent, enabled, sort_order, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.orgId,
        code,
        title,
        subtitle || null,
        accent || "root",
        enabled === false ? 0 : 1,
        Number(sortOrder || 0),
        config ? JSON.stringify(config) : null
      ]
    );
    return res.status(201).json({ message: "Home card created" });
  } catch {
    return res.status(500).json({ message: "Unable to create home card" });
  }
});

router.patch("/home-cards/:id", async (req, res) => {
  const { id } = req.params;
  const { title, subtitle, accent, enabled, sortOrder, config } = req.body || {};
  try {
    await query(
      `UPDATE home_cards
       SET title = COALESCE(?, title),
           subtitle = COALESCE(?, subtitle),
           accent = COALESCE(?, accent),
           enabled = COALESCE(?, enabled),
           sort_order = COALESCE(?, sort_order),
           config_json = COALESCE(?, config_json)
       WHERE id = ? AND org_id = ?`,
      [
        title ?? null,
        subtitle ?? null,
        accent ?? null,
        typeof enabled === "boolean" ? (enabled ? 1 : 0) : null,
        typeof sortOrder === "number" ? sortOrder : null,
        config ? JSON.stringify(config) : null,
        id,
        req.user.orgId
      ]
    );
    return res.json({ message: "Home card updated" });
  } catch {
    return res.status(500).json({ message: "Unable to update home card" });
  }
});

router.delete("/home-cards/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await query(`DELETE FROM home_cards WHERE id = ? AND org_id = ?`, [id, req.user.orgId]);
    return res.json({ message: "Home card deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete home card" });
  }
});

const METRIC_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;

function metricsTableMissing(err) {
  const msg = String(err?.sqlMessage || err?.message || err || "");
  return /doesn't exist|unknown table|table.*not exist/i.test(msg);
}

router.get("/metrics", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT metric_key, description, value_text
       FROM org_metric_values
       WHERE org_id = ?
       ORDER BY metric_key ASC`,
      [_req.user.orgId]
    );
    return res.json(rows);
  } catch (e) {
    if (metricsTableMissing(e)) {
      console.warn("[admin/metrics] org_metric_values missing; run `npm run db:migrate`.");
      return res.json([]);
    }
    return res.status(500).json({ message: "Unable to fetch metrics" });
  }
});

router.post("/metrics", async (req, res) => {
  const { metricKey, value, description } = req.body || {};
  if (!metricKey || typeof metricKey !== "string" || !METRIC_KEY_RE.test(metricKey)) {
    return res.status(400).json({ message: "metricKey must match [a-zA-Z][a-zA-Z0-9_]{0..79}" });
  }
  try {
    await query(
      `INSERT INTO org_metric_values (org_id, metric_key, description, value_text)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value_text = VALUES(value_text),
         description = VALUES(description)`,
      [req.user.orgId, metricKey, description || null, value != null ? String(value) : ""]
    );
    return res.status(201).json({ message: "Metric saved" });
  } catch (e) {
    if (metricsTableMissing(e)) {
      return res.status(503).json({
        message: "Database table org_metric_values is missing. Run: npm run db:migrate"
      });
    }
    return res.status(500).json({ message: "Unable to save metric" });
  }
});

router.patch("/metrics/:metricKey", async (req, res) => {
  const { metricKey } = req.params;
  const { value, description } = req.body || {};
  if (!METRIC_KEY_RE.test(metricKey)) {
    return res.status(400).json({ message: "Invalid metric key" });
  }
  try {
    await query(
      `UPDATE org_metric_values
       SET value_text = COALESCE(?, value_text),
           description = COALESCE(?, description)
       WHERE org_id = ? AND metric_key = ?`,
      [value !== undefined ? String(value) : null, description ?? null, req.user.orgId, metricKey]
    );
    const [row] = await query(
      `SELECT metric_key, description, value_text FROM org_metric_values WHERE org_id = ? AND metric_key = ?`,
      [req.user.orgId, metricKey]
    );
    if (!row) return res.status(404).json({ message: "Metric not found" });
    return res.json(row);
  } catch {
    return res.status(500).json({ message: "Unable to update metric" });
  }
});

router.delete("/metrics/:metricKey", async (req, res) => {
  const { metricKey } = req.params;
  try {
    await query(`DELETE FROM org_metric_values WHERE org_id = ? AND metric_key = ?`, [
      req.user.orgId,
      metricKey
    ]);
    return res.json({ message: "Metric deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete metric" });
  }
});

export default router;

