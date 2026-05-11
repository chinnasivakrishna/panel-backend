import * as mariadb from "mariadb";
import dotenv from "dotenv";

dotenv.config();

const TABLE_MAP = [
  { from: "organizations", to: "tb_cpanel_organizations" },
  { from: "tb_organizations", to: "tb_cpanel_organizations" },
  { from: "org_config", to: "tb_config_org_config" },
  { from: "tb_org_config", to: "tb_config_org_config" },
  { from: "users", to: "tb_cpanel_users" },
  { from: "tb_users", to: "tb_cpanel_users" },
  { from: "nav_items", to: "tb_cpanel_nav_items" },
  { from: "tb_nav_items", to: "tb_cpanel_nav_items" },
  { from: "dashboard_widgets", to: "tb_csd_dashboard_widgets" },
  { from: "tb_dashboard_widgets", to: "tb_csd_dashboard_widgets" },
  { from: "modules", to: "tb_project_modules" },
  { from: "tb_modules", to: "tb_project_modules" },
  { from: "module_fields", to: "tb_project_module_fields" },
  { from: "tb_module_fields", to: "tb_project_module_fields" },
  { from: "module_records", to: "tb_project_module_records" },
  { from: "tb_module_records", to: "tb_project_module_records" },
  { from: "home_cards", to: "tb_csd_home_cards" },
  { from: "tb_home_cards", to: "tb_csd_home_cards" },
  { from: "org_metric_values", to: "tb_csd_org_metric_values" },
  { from: "tb_org_metric_values", to: "tb_csd_org_metric_values" },
  { from: "support_tickets", to: "tb_project_support_tickets" },
  { from: "tb_support_tickets", to: "tb_project_support_tickets" }
];

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
    await conn.query(`USE \`${dbName}\`;`);
    await conn.query("SET FOREIGN_KEY_CHECKS=0;");

    for (const { from, to } of TABLE_MAP) {
      // Rename only if source exists and target doesn't.
      // SHOW TABLES LIKE returns [] if missing.
      const src = await conn.query("SHOW TABLES LIKE ?", [from]);
      const dst = await conn.query("SHOW TABLES LIKE ?", [to]);
      if (src.length && !dst.length) {
        await conn.query(`RENAME TABLE \`${from}\` TO \`${to}\`;`);
        console.log(`Renamed ${from} -> ${to}`);
      }
    }

    await conn.query("SET FOREIGN_KEY_CHECKS=1;");
    console.log("Grouped TB rename completed.");
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error("Grouped TB rename failed:", e?.sqlMessage || e?.message || e);
  process.exit(1);
});

