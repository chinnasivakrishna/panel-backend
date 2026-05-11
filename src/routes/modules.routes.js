import express from "express";
import { authGuard } from "../middleware/auth.js";
import { query } from "../config/db.js";

const router = express.Router();
router.use(authGuard);

router.get("/", async (req, res) => {
  try {
    const modules = await query(
      `SELECT id, code, name, icon, route, ui_config_json, is_active
       FROM tb_project_modules
       WHERE org_id = ? AND is_active = 1
       ORDER BY name ASC`,
      [req.user.orgId]
    );
    return res.json(modules);
  } catch {
    return res.status(500).json({ message: "Unable to fetch modules" });
  }
});

router.get("/:id/fields", async (req, res) => {
  try {
    const fields = await query(
      `SELECT id, field_key, label, field_type, is_required, is_listed, sort_order, options_json
       FROM tb_project_module_fields
       WHERE org_id = ? AND module_id = ?
       ORDER BY sort_order ASC`,
      [req.user.orgId, req.params.id]
    );
    return res.json(fields);
  } catch {
    return res.status(500).json({ message: "Unable to fetch module fields" });
  }
});

router.get("/:id/records", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;
    const rows = await query(
      `SELECT id, data_json, created_at, updated_at
       FROM tb_project_module_records
       WHERE org_id = ? AND module_id = ?
       ORDER BY updated_at DESC
       LIMIT ${limit}`,
      [req.user.orgId, req.params.id]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: "Unable to fetch records" });
  }
});

router.post("/:id/records", async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object") return res.status(400).json({ message: "data object is required" });
  try {
    await query(
      `INSERT INTO tb_project_module_records (org_id, module_id, data_json, created_by)
       VALUES (?, ?, ?, ?)`,
      [req.user.orgId, req.params.id, JSON.stringify(data), req.user.sub]
    );
    return res.status(201).json({ message: "Record created" });
  } catch {
    return res.status(500).json({ message: "Unable to create record" });
  }
});

router.patch("/:id/records/:recordId", async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object") return res.status(400).json({ message: "data object is required" });
  try {
    await query(
      `UPDATE tb_project_module_records
       SET data_json = ?
       WHERE id = ? AND module_id = ? AND org_id = ?`,
      [JSON.stringify(data), req.params.recordId, req.params.id, req.user.orgId]
    );
    return res.json({ message: "Record updated" });
  } catch {
    return res.status(500).json({ message: "Unable to update record" });
  }
});

router.delete("/:id/records/:recordId", async (req, res) => {
  try {
    await query(
      `DELETE FROM tb_project_module_records
       WHERE id = ? AND module_id = ? AND org_id = ?`,
      [req.params.recordId, req.params.id, req.user.orgId]
    );
    return res.json({ message: "Record deleted" });
  } catch {
    return res.status(500).json({ message: "Unable to delete record" });
  }
});

export default router;

