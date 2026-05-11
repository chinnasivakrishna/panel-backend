import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV,
  port: Number(process.env.PORT),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY,
  dbHost: process.env.DB_HOST,
  dbPort: Number(process.env.DB_PORT),
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbSsl: String(process.env.DB_SSL || "false").toLowerCase() === "true",
  dbSslRejectUnauthorized:
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true",
  clientOrigin: process.env.CLIENT_ORIGIN
};
