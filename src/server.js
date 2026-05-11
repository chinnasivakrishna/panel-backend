import app from "./app.js";
import { env } from "./config/env.js";
import { checkDbConnection } from "./config/db.js";

async function start() {
  try {
    await checkDbConnection();
    console.log("DB connected successfully.");
  } catch (e) {
    console.error("DB connection failed:", e?.sqlMessage || e?.message || e);
    process.exit(1);
  }

  app.listen(env.Port, () => {
    console.log(`Server running on port ${env.Port} (${env.nodeEnv})`);
  });
}

start();
