import * as jose from "jose";

const COOKIE_NAME = "cabinet_token";

function secretKey(): Uint8Array {
  const s = process.env.CABINET_JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("CABINET_JWT_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(s);
}

export type CabinetJwtPayload = {
  sub: string;
  email: string;
  appUserId: string;
};

export async function signCabinetToken(payload: CabinetJwtPayload, expiresIn = "7d"): Promise<string> {
  return new jose.SignJWT({ email: payload.email, appUserId: payload.appUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifyCabinetToken(token: string): Promise<CabinetJwtPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const sub = String(payload.sub || "");
    const email = String(payload.email || "");
    const appUserId = String(payload.appUserId || "");
    if (!sub || !email || !appUserId) return null;
    return { sub, email, appUserId };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
