const base = () => import.meta.env.VITE_API_URL || "";

export function apiPath(p: string) {
  return `${base()}${p.startsWith("/") ? p : `/${p}`}`;
}

export async function apiFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {},
) {
  const { token, headers: h, ...rest } = init;
  const headers = new Headers(h);
  const method = (rest.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiPath(path), { ...rest, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : res.statusText;
    const err = new Error(msg) as Error & {
      status: number;
      body: unknown;
      code?: string;
    };
    err.status = res.status;
    err.body = data;
    if (
      typeof data === "object" &&
      data !== null &&
      "code" in data &&
      typeof (data as { code: unknown }).code === "string"
    ) {
      err.code = (data as { code: string }).code;
    }
    throw err;
  }
  return data;
}
