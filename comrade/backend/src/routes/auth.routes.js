import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signToken, authRequired } from "../middleware/auth.js";

const r = Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function userResponse(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    trialRequestsUsed: user.trialRequestsUsed,
    trialLimit: user.trialLimit,
    subscriptionActive: user.subscriptionActive,
  };
}

r.post("/register", registerLimiter, async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const normalized = String(email).toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email: normalized } });
  if (exists) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await prisma.user.create({
    data: {
      email: normalized,
      passwordHash,
      name: name || null,
      role: "ADMIN",
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    },
  });

  const token = signToken(user.id);
  res.status(201).json({
    token,
    user: userResponse(user),
  });
});

r.post("/login", registerLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const user = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase().trim() },
  });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken(user.id);
  res.json({
    token,
    user: userResponse(user),
  });
});

r.get("/me", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(userResponse(user));
});

export default r;
