const $ = (id: string) => document.getElementById(id)!;

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = sessionStorage.getItem("cabinet_token");
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

$("btnLogin").addEventListener("click", async () => {
  const r = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ($("email") as HTMLInputElement).value.trim(),
      password: ($("password") as HTMLInputElement).value,
    }),
  });
  const t = await r.text();
  $("out").textContent = t;
  if (r.ok) {
    try {
      const j = JSON.parse(t) as { token?: string };
      if (j.token) sessionStorage.setItem("cabinet_token", j.token);
    } catch {
      /* ignore */
    }
  }
});

$("btnMe").addEventListener("click", async () => {
  const r = await fetch("/api/v1/auth/me", { headers: headers() });
  $("out").textContent = await r.text();
});
