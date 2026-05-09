/**
 * Должен быть первым import в app.js: dotenv + автоподхват OpenClaw из ~/.openclaw/
 */
import dotenv from "dotenv";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { applyOpenClawGatewayFromUserProfile } from "./lib/openclaw-gateway-bootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, "..");
const repoRoot = path.join(__dirname, "..", "..", "..");
const openclawEnv = path.join(repoRoot, "openclaw", ".env");
if (existsSync(openclawEnv)) {
  dotenv.config({ path: openclawEnv });
}
dotenv.config({ path: path.join(backendDir, ".env"), override: true });
applyOpenClawGatewayFromUserProfile();
