import * as mariadb from "mariadb";
import { env } from "./env.js";

export const pool = mariadb.createPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  ...(env.dbSsl
    ? {
      ssl: {
        rejectUnauthorized: env.dbSslRejectUnauthorized
      }
    }
    : {}),
  // Keep this low on shared MySQL hosts (Hostinger)
  connectionLimit: Number.isFinite(env.dbPoolLimit) && env.dbPoolLimit > 0 ? env.dbPoolLimit : 1,
  minimumIdle: 1,
  idleTimeout: 60_000,
  acquireTimeout: 10_000,
  connectTimeout: 5000,
  allowPublicKeyRetrieval: true,
  // Ensure BIGINT columns (ids) serialize cleanly to JSON in Express responses.
  bigIntAsNumber: true
});

export async function query(sql, params = []) {
  // Use pool.query to encourage connection reuse.
  return await pool.query(sql, params);
}

export async function checkDbConnection() {
  await pool.query("SELECT 1 AS ok");
  return true;
}
