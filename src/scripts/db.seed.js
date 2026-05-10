import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as mariadb from "mariadb";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function splitSql(sql) {
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
    await conn.query(`USE \`${dbName}\`;`);
    const seedPath = path.join(__dirname, "..", "..", "..", "database", "seed.sql");
    const sql = fs.readFileSync(seedPath, "utf8");
    const statements = splitSql(sql).filter((s) => !/^USE\s+/i.test(s));
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (e) {
        const msg = e?.sqlMessage || e?.message || "";
        const ignorable = msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("already exists");
        if (!ignorable) throw e;
      }
    }
    console.log("DB seed completed.");
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error("DB seed failed:", e?.sqlMessage || e?.message || e);
  process.exit(1);
});

