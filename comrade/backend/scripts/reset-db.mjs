/**
 * Удаляет SQLite dev.db и заново применяет миграции.
 * Остановите `npm run dev` перед запуском (иначе EPERM на Windows).
 */
import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const db = join(root, "prisma", "dev.db");

if (existsSync(db)) {
  unlinkSync(db);
  console.log("Removed prisma/dev.db");
}

execSync("npx prisma migrate deploy", { cwd: root, stdio: "inherit" });
console.log("Done.");
