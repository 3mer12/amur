// لوحة تحكم عامر_ — دوال Cloudflare Pages (المسار: /api/*)
// الأسرار تُضبط في Cloudflare فقط: ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, GITHUB_TOKEN
const enc = new TextEncoder();
const dec = new TextDecoder();
const COOKIE = "amer_session";
const WEEK = 7 * 24 * 3600;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

function b64u(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(String(b64).replace(/\s/g, ""));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
// مقارنة آمنة: نقارن بصمتي HMAC بدل النصّين مباشرة
async function same(secret, a, b) {
  return (await hmac(secret, "c:" + a)) === (await hmac(secret, "c:" + b));
}
async function authed(request, env) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + COOKIE + "=([^;]+)"));
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 2 || Number(parts[0]) < Date.now() / 1000) return false;
  return (await hmac(env.SESSION_SECRET, "s:" + parts[0])) === parts[1];
}

const ALLOWED = [
  /^blog\/content\/posts\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/,
  /^blog\/content\/pages\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/,
  /^blog\/content\/about\.md$/,
];
const okPath = (p) => typeof p === "string" && ALLOWED.some((r) => r.test(p));

function gh(env, path, init = {}) {
  const repo = env.GITHUB_REPO || "3mer12/amur";
  const branch = env.GITHUB_BRANCH || "main";
  const method = init.method || "GET";
  const body = init.body ? { ...init.body, branch } : undefined;
  return fetch(
    "https://api.github.com/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + (method === "GET" ? "?ref=" + branch : ""),
    {
      method,
      headers: {
        authorization: "Bearer " + env.GITHUB_TOKEN,
        accept: "application/vnd.github+json",
        "user-agent": "amer-blog-admin",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
}

function meta(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const o = {};
  if (m)
    for (const l of m[1].split(/\r?\n/)) {
      const k = l.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (k) o[k[1]] = k[2].trim();
    }
  return o;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "setup" }, 503);

  // حماية من الطلبات القادمة من مواقع أخرى
  if (method !== "GET") {
    const origin = request.headers.get("origin");
    let host = "";
    try {
      host = new URL(origin).host;
    } catch (e) {}
    if (host !== url.host) return json({ error: "forbidden" }, 403);
  }

  if (route === "login" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const okE = await same(env.SESSION_SECRET, String(b.email || "").trim().toLowerCase(), String(env.ADMIN_EMAIL).trim().toLowerCase());
    const okP = await same(env.SESSION_SECRET, String(b.password || ""), String(env.ADMIN_PASSWORD));
    if (!(okE && okP)) {
      await new Promise((r) => setTimeout(r, 800));
      return json({ error: "bad" }, 401);
    }
    const exp = Math.floor(Date.now() / 1000) + WEEK;
    const sig = await hmac(env.SESSION_SECRET, "s:" + exp);
    return json({ ok: true }, 200, {
      "set-cookie": COOKIE + "=" + exp + "." + sig + "; Path=/; Max-Age=" + WEEK + "; HttpOnly; Secure; SameSite=Strict",
    });
  }
  if (route === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" });
  }

  if (!(await authed(request, env))) return json({ error: "auth" }, 401);
  if (route === "me") return json({ ok: true, github: !!env.GITHUB_TOKEN });
  if (!env.GITHUB_TOKEN) return json({ error: "token" }, 503);

  // قائمة المقالات أو الصفحات
  if (route === "items" && method === "GET") {
    const dir = url.searchParams.get("kind") === "pages" ? "blog/content/pages" : "blog/content/posts";
    const r = await gh(env, dir);
    if (r.status === 404) return json({ items: [] });
    if (!r.ok) return json({ error: "github", status: r.status }, 502);
    const files = (await r.json())
      .filter((f) => f.type === "file" && f.name.endsWith(".md"))
      .sort((a, b) => b.name.localeCompare(a.name));
    const items = await Promise.all(
      files.map(async (f, i) => {
        const item = { path: f.path, name: f.name };
        if (i < 40) {
          try {
            const fr = await gh(env, f.path);
            const m = meta(dec.decode(b64ToBytes((await fr.json()).content)));
            item.title = m.title;
            item.date = m.date;
            item.draft = m.draft === "true";
          } catch (e) {}
        }
        return item;
      })
    );
    return json({ items });
  }

  // قراءة ملف
  if (route === "item" && method === "GET") {
    const path = url.searchParams.get("path");
    if (!okPath(path)) return json({ error: "path" }, 400);
    const r = await gh(env, path);
    if (r.status === 404) return json({ error: "missing" }, 404);
    if (!r.ok) return json({ error: "github", status: r.status }, 502);
    const j = await r.json();
    return json({ path, sha: j.sha, text: dec.decode(b64ToBytes(j.content)) });
  }

  // حفظ ملف (جديد أو تعديل)
  if (route === "item" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!okPath(b.path) || typeof b.text !== "string" || b.text.length > 400000) return json({ error: "input" }, 400);
    const body = {
      message: "Admin: " + (b.sha ? "update " : "create ") + b.path.split("/").pop(),
      content: bytesToB64(enc.encode(b.text)),
    };
    if (b.sha) body.sha = String(b.sha);
    const r = await gh(env, b.path, { method: "PUT", body });
    if (!r.ok) return json({ error: "github", status: r.status }, r.status === 422 || r.status === 409 ? 409 : 502);
    const j = await r.json();
    return json({ ok: true, sha: j.content.sha });
  }

  // حذف ملف
  if (route === "item" && method === "DELETE") {
    const path = url.searchParams.get("path");
    const sha = url.searchParams.get("sha");
    if (!okPath(path) || path === "blog/content/about.md" || !sha) return json({ error: "input" }, 400);
    const r = await gh(env, path, { method: "DELETE", body: { message: "Admin: delete " + path.split("/").pop(), sha } });
    if (!r.ok) return json({ error: "github", status: r.status }, 502);
    return json({ ok: true });
  }

  // رفع صورة
  if (route === "upload" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (typeof b.data !== "string" || b.data.length > 6000000) return json({ error: "size" }, 413);
    let name = String(b.name || "image.jpg").replace(/[^A-Za-z0-9._-]/g, "").slice(-60) || "image.jpg";
    if (!/\.(jpe?g|png|gif|webp)$/i.test(name)) name += ".jpg";
    name = Date.now().toString(36) + "-" + name;
    const r = await gh(env, "blog/public/images/" + name, { method: "PUT", body: { message: "Admin: upload " + name, content: b.data } });
    if (!r.ok) return json({ error: "github", status: r.status }, 502);
    return json({ ok: true, url: "/images/" + name });
  }

  return json({ error: "not_found" }, 404);
}
