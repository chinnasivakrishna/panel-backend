import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import configRoutes from "./routes/config.routes.js";
import supportRoutes from "./routes/support.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import modulesRoutes from "./routes/modules.routes.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: env.clientOrigin
  })
);
app.use(express.json());
app.use(morgan("dev"));

// Serve uploaded organization assets (e.g., logo)
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", env: env.nodeEnv });
});

app.use("/api/auth", authRoutes);
app.use("/api/config", configRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/modules", modulesRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/users", userRoutes);

export default app;
