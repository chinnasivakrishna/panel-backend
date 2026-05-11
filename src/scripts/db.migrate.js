import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as mariadb from "mariadb";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function splitSql(sql) {
  // Simple statement splitter for our seed/schema files (no stored procs).
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(";") ? s : `${s};`));
}

async function run() {
  const dbName = process.env.DB_NAME || "enterprise_admin";
  const conn = await mariadb.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    connectTimeout: 5000,
    allowPublicKeyRetrieval: true,
    bigIntAsNumber: true,
    multipleStatements: true
  });

  try {
    const schemaPath = path.join(__dirname, "..", "..", "..", "database", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");

    // Ensure DB exists and selected
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await conn.query(`USE \`${dbName}\`;`);

    const statements = splitSql(sql).filter((s) => !/^USE\s+/i.test(s));

    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (e) {
        // If re-running, some CREATE TABLE may already exist. Surface other errors.
        const msg = e?.sqlMessage || e?.message || "";
        const ignorable =
          msg.toLowerCase().includes("already exists") ||
          msg.toLowerCase().includes("duplicate") ||
          msg.toLowerCase().includes("cannot add foreign key constraint");
        if (!ignorable) throw e;
      }
    }

    // Minimal additive migrations for existing installs
    try {
      await conn.query("ALTER TABLE tb_csd_dashboard_widgets ADD COLUMN config_json JSON NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_modules ADD COLUMN ui_config_json JSON NULL;");
    } catch {}

    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS tb_csd_org_metric_values (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          org_id BIGINT NOT NULL,
          metric_key VARCHAR(80) NOT NULL,
          description VARCHAR(240) NULL,
          value_text VARCHAR(2048) NOT NULL DEFAULT "",
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_org_metric (org_id, metric_key),
          CONSTRAINT fk_org_metric_org FOREIGN KEY (org_id) REFERENCES tb_cpanel_organizations(id)
        );
      `);
    } catch {}

    // Sidebar item visibility (roles). Null/empty => visible to all roles.
    try {
      await conn.query("ALTER TABLE tb_cpanel_nav_items ADD COLUMN roles_csv VARCHAR(255) NULL;");
    } catch {}

    // Support workflow enhancements: attachments + accept/decline tracking.
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN attachments_json JSON NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decision_status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending';");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decision_token VARCHAR(96) NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decision_token_expires_at TIMESTAMP NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decision_note TEXT NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decided_by BIGINT NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD COLUMN decided_at TIMESTAMP NULL;");
    } catch {}
    try {
      await conn.query("ALTER TABLE tb_project_support_tickets ADD CONSTRAINT fk_ticket_decider FOREIGN KEY (decided_by) REFERENCES tb_cpanel_users(id);");
    } catch {}

    console.log("DB migration completed.");
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error("DB migration failed:", e?.sqlMessage || e?.message || e);
  process.exit(1);
});

