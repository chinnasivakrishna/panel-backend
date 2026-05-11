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

  app.listen(env.port, () => {
    console.log(`Server running on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
