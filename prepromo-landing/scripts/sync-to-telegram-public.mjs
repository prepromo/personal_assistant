import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prepromoRoot = path.join(__dirname, "..");
const src = path.join(prepromoRoot, "docs");
const dest = path.join(prepromoRoot, "..", "telegram-user", "public");

await fs.cp(src, dest, { recursive: true, force: true });
console.log(`Synced landing: ${src} → ${dest}`);
