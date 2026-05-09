/**
 * Создаёт local-saas/data/users.json с тестовым пользователем.
 * Использование: LOCAL_SAAS_SKIP_AUTH=0 в .env, затем вход test@local.dev / test123456
 */
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const usersFile = path.join(dataDir, "users.json");

const email = "test@local.dev";
const password = "test123456";

const hash = await bcrypt.hash(password, 10);
const store = {
  users: [
    {
      id: randomUUID(),
      email,
      passwordHash: hash,
      plan: "free",
      createdAt: new Date().toISOString(),
    },
  ],
};

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(usersFile, JSON.stringify(store, null, 2), "utf8");
console.log("Written:", usersFile);
console.log("Email:   ", email);
console.log("Password:", password);
console.log("Next: set LOCAL_SAAS_SKIP_AUTH=0 in local-saas/.env and restart the server.");
