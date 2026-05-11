import * as mariadb from "mariadb";
import { env } from "./env.js";

export const pool = mariadb.createPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  connectionLimit: 10,
  connectTimeout: 5000,
  allowPublicKeyRetrieval: true,
  // Ensure BIGINT columns (ids) serialize cleanly to JSON in Express responses.
  bigIntAsNumber: true
});

export async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(sql, params);
  } finally {
    if (conn) conn.release();
  }
}

export async function checkDbConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("SELECT 1 AS ok");
    return true;
  } finally {
    if (conn) conn.release();
  }
}
