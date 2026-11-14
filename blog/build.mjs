// مولّد مدونة عامر_ — بدون أي اعتماديات. التشغيل: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, basename } from "node:path";

import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));

// ---------- أدوات ----------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (d) =>
  new Intl.DateTimeFormat("ar-OM-u-nu-latn", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(d)
  );

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v === "true") v = true;
    else if (v === "false") v = false;
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

// ---------- Markdown → HTML ----------
function inline(text) {
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = esc(text);
  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const ext = /^https?:\/\//.test(u);
      return `<a href="${u}"${ext ? ' rel="noopener" target="_blank"' : ""}>${t}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

function markdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // كتلة كود
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre dir="ltr"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // عناوين
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 4); // # داخل المقال يصبح h2
      const text = h[2].trim();
      const id = text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${esc(id)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    // فاصل
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push("<hr>"); i++; continue; }
    // اقتباس
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdown(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // قوائم
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].match(re)[1]);
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    // صورة منفردة
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      out.push(`<figure><img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy">${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ""}</figure>`);
      i++;
      continue;
    }
    // فقرة
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ---------- قراءة المقالات ----------
const postsDir = join(ROOT, "content", "posts");
const posts = existsSync(postsDir)
  ? readdirSync(postsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const { data, body } = parseFrontmatter(readFileSync(join(postsDir, f), "utf8"));
        const stem = basename(f, ".md");
        const dateFromName = stem.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
        const slug = data.slug || stem.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, "") || stem;
        const date = data.date ? String(data.date).slice(0, 10) : dateFromName || "2026-01-01";
        const words = body.split(/\s+/).filter(Boolean).length;
        return {
          title: data.title || stem,
          description: data.description || "", excerpt: ((t) => (t.length > 170 ? t.slice(0, 170).replace(/\s\S*$/, "") + "…" : t))(body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*`\[\]]/g, "").replace(/\s+/g, " ").trim()),
          cover: data.cover || "",
          tags: data.tags ? String(data.tags).split(/[,،]/).map((t) => t.trim()).filter(Boolean) : [],
          draft: data.draft === true,
          slug,
          date,
          minutes: Math.max(1, Math.round(words / 180)),
          html: markdown(body),
        };
      })
      .filter((p) => !p.draft)
      .sort((a, b) => b.date.localeCompare(a.date))
  : [];

// ---------- الصفحات ----------
const RESERVED = new Set(["posts", "about", "admin", "api", "images", "404"]);
const pagesDir = join(ROOT, "content", "pages");
const pages = existsSync(pagesDir)
  ? readdirSync(pagesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const { data, body } = parseFrontmatter(readFileSync(join(pagesDir, f), "utf8"));
        const slug = data.slug || basename(f, ".md");
        return { title: data.title || slug, slug, order: Number(data.order) || 0, draft: data.draft === true, html: markdown(body) };
      })
      .filter((p) => !p.draft && !RESERVED.has(p.slug))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ar"))
  : [];

// ---------- القالب ----------
const logo = `<a class="logo" href="/" aria-label="${esc(site.title)}"><img class="logo-img" src="/logo.jpg" alt="" width="44" height="44"><span class="logo-text"><span class="logo-word">عامر</span><span class="logo-cursor" aria-hidden="true"></span></span></a>`;

function layout({ title, description, path, body, type = "website", cover = "" }) {
  const url = site.url.replace(/\/$/, "") + path;
  const fullTitle = path === "/" ? site.title : `${title} — ${site.title}`;
  const desc = description || site.description;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ar_AR">
<meta property="og:image" content="${esc(site.url.replace(/\/$/, "") + (cover || "/logo.jpg"))}">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@700;800&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap bar">
    ${logo}
    <nav aria-label="التنقل">
      <a href="/"${path === "/" ? ' aria-current="page"' : ""}>المقالات</a>
      <a href="/about/"${path === "/about/" ? ' aria-current="page"' : ""}>من أنا</a>
      ${pages.map((pg) => `<a href="/${esc(pg.slug)}/"${path === "/" + pg.slug + "/" ? ' aria-current="page"' : ""}>${esc(pg.title)}</a>`).join("")}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <span class="sig">عامر<span class="logo-cursor small" aria-hidden="true"></span></span>
    ${site.social ? `<a class="handle" dir="ltr" href="${esc(site.social)}" rel="noopener">${esc(site.handle)}</a>` : `<span class="handle" dir="ltr">${esc(site.handle)}</span>`}
  </div>
</footer>
</body>
</html>`;
}

const postCard = (p) => `<article class="card">
  <a class="card-link" href="/posts/${esc(p.slug)}/">
    <div class="meta"><time datetime="${p.date}">${fmtDate(p.date)}</time><span>${p.minutes} د قراءة</span></div>
    <h2>${esc(p.title)}</h2>
    ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
  </a>
</article>`;

// ---------- البناء ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
if (existsSync(join(ROOT, "public"))) cpSync(join(ROOT, "public"), DIST, { recursive: true });

const write = (rel, content) => {
  const file = join(DIST, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
};

// الرئيسية
write(
  "index.html",
  layout({
    title: site.title,
    path: "/",
    body: `<section class="hero">
  <p class="eyebrow">${esc(site.tagline)}</p>
  <h1>${esc(site.heading)}</h1>
  <p class="lead">${esc(site.description)}</p>
  <div class="actions">
    <button class="btn" id="notify-btn" type="button">تفعيل الإشعارات</button>
  </div>
  <p class="note" id="notify-msg" role="status" aria-live="polite"></p>
</section>
<script src="/notify.js" defer></script>
<section class="list" aria-label="المقالات">
${posts.length ? posts.map(postCard).join("\n") : '<p class="empty">لا توجد مقالات بعد.</p>'}
</section>`,
  })
);

// المقالات
for (const p of posts) {
  write(
    `posts/${p.slug}/index.html`,
    layout({
      title: p.title,
      description: p.description,
      path: `/posts/${p.slug}/`,
      type: "article",
      cover: p.cover,
      body: `<article class="post">
  ${p.cover ? `<img class="cover" src="${esc(p.cover)}" alt="">` : ""}
  <header class="post-head">
    <div class="meta"><time datetime="${p.date}">${fmtDate(p.date)}</time><span>${p.minutes} د قراءة</span></div>
    <h1>${esc(p.title)}</h1>
    ${p.description ? `<p class="lead">${esc(p.description)}</p>` : ""}
  </header>
  <div class="prose">
${p.html}
  </div>
  ${p.tags.length ? `<ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
  <p class="back"><a href="/">← كل المقالات</a></p>
</article>`,
    })
  );
}

// من أنا
const aboutFile = join(ROOT, "content", "about.md");
if (existsSync(aboutFile)) {
  const { data, body } = parseFrontmatter(readFileSync(aboutFile, "utf8"));
  write(
    "about/index.html",
    layout({
      title: data.title || "من أنا",
      path: "/about/",
      body: `<article class="post"><header class="post-head"><h1>${esc(data.title || "من أنا")}</h1></header><div class="prose">${markdown(body)}</div></article>`,
    })
  );
}

// الصفحات
for (const p of pages) {
  write(
    `${p.slug}/index.html`,
    layout({
      title: p.title,
      path: `/${p.slug}/`,
      body: `<article class="post"><header class="post-head"><h1>${esc(p.title)}</h1></header><div class="prose">${p.html}</div></article>`,
    })
  );
}

// 404
write(
  "404.html",
  layout({
    title: "الصفحة غير موجودة",
    path: "/404.html",
    body: `<section class="hero"><p class="eyebrow">404</p><h1>الصفحة غير موجودة</h1><p class="lead"><a href="/">العودة إلى الرئيسية</a></p></section>`,
  })
);

// sitemap
const base = site.url.replace(/\/$/, "");
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/about/", ...pages.map((p) => `/${p.slug}/`), ...posts.map((p) => `/posts/${p.slug}/`)].map((u) => `<url><loc>${base}${u}</loc></url>`).join("\n")}
</urlset>`
);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

console.log(`تم بناء ${posts.length} مقال → dist/`);
