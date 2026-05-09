import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function key32(): Buffer {
  const k = process.env.SESSION_ENCRYPTION_KEY;
  if (!k || k.length < 16) {
    throw new Error("Задайте SESSION_ENCRYPTION_KEY (минимум 16 символов, лучше 32+ случайных байт в base64)");
  }
  return crypto.createHash("sha256").update(k, "utf8").digest();
}

export function encryptSession(plain: string): Buffer {
  const key = key32();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSession(buf: Buffer): string {
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Пустая или повреждённая сессия");
  }
  const key = key32();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
