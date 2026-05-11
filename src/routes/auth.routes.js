import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../config/db.js";
import { env } from "../config/env.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const users = await query(
      `SELECT id, org_id, full_name, email, password_hash, role
       FROM tb_cpanel_users WHERE email = ? AND is_active = 1 LIMIT 1`,
      [email]
    );

    const user = users[0];
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      {
        sub: Number(user.id),
        orgId: Number(user.org_id),
        role: user.role,
        name: user.full_name
      },
      env.jwtSecret,
      { expiresIn: env.jwtExpiry }
    );

    return res.json({
      token,
      user: {
        id: Number(user.id),
        orgId: Number(user.org_id),
        name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("LOGIN_ERROR", err?.sqlMessage || err?.message || err);
    return res.status(500).json({ message: "Login failed" });
  }
});

export default router;
