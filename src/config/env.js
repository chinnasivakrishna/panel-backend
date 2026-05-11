import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "change-me",
  jwtExpiry: process.env.JWT_EXPIRY || "8h",
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 3306),
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "i love you amma",
  dbName: process.env.DB_NAME || "enterprise_admin",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
};
