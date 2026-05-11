import * as mariadb from "mariadb";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const dbName = process.env.DB_NAME || "enterprise_admin";
  const orgId = Number(process.env.ORG_ID || 1);

  const conn = await mariadb.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: dbName,
    connectTimeout: 5000,
    allowPublicKeyRetrieval: true,
    bigIntAsNumber: true,
    multipleStatements: true
  });

  try {
    await conn.query("DELETE FROM tb_cpanel_nav_items WHERE org_id = ?", [orgId]);
    await conn.query(
      `INSERT INTO tb_cpanel_nav_items (org_id, label, icon, route, position, sort_order, is_active, roles_csv)
       VALUES
         (?, 'Dashboard', 'LayoutDashboard', '/dashboard', 'top', 1, 1, 'admin,employee,merchant'),
         (?, 'Accounts',  'Users',           '/accounts',  'top', 2, 1, 'admin,employee,merchant'),
         (?, 'Records',   'Folder',          '/records',   'top', 3, 1, 'admin,employee,merchant'),
         (?, 'Trash',     'Trash2',          '/trash',     'top', 4, 1, 'admin,employee,merchant'),
         (?, 'Profile',   'User',            '/profile',   'bottom', 100, 1, 'admin,employee,merchant')`,
      [orgId, orgId, orgId, orgId, orgId]
    );
    console.log(`Reset nav_items defaults for org_id=${orgId}`);
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error("Reset nav defaults failed:", e?.sqlMessage || e?.message || e);
  process.exit(1);
});

