import app from "./app.js";
import { env } from "./config/env.js";
import { checkDbConnection } from "./config/db.js";

function logStartupContext() {
  const dbPortRaw = process.env.DB_PORT;
  const hasDbPassword = Boolean(process.env.DB_PASSWORD && String(process.env.DB_PASSWORD).trim());
  const hasJwtSecret = Boolean(process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim());
  console.log("[startup] booting server", {
    nodeEnv: env.nodeEnv,
    port: env.port,
    pid: process.pid,
    dbHost: env.dbHost,
    dbPort: env.dbPort,
    dbName: env.dbName,
    dbUser: env.dbUser,
    dbPortSource: dbPortRaw ? "env" : "default(3306)",
    hasDbPassword,
    hasJwtSecret,
    clientOrigin: env.clientOrigin
  });
}

function logDbError(error) {
  const details = {
    message: error?.message,
    sqlMessage: error?.sqlMessage,
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    name: error?.name
  };
  console.error("[startup] DB connection failed", details);
  if (error?.stack) {
    console.error("[startup] DB error stack:\n", error.stack);
  }
}

async function start() {
  logStartupContext();
  try {
    await checkDbConnection();
    console.log("[startup] DB connected successfully.");
  } catch (e) {
    logDbError(e);
    process.exit(1);
  }

  app.listen(env.port, () => {
    console.log(`[startup] Server running on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
