// Serves the mockup app and screenshots a spec's screens into mockups/<spec>/.
//   node mockups/app/capture.mjs <spec> [screen-id-prefix ...]
//   node mockups/app/capture.mjs --serve
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = dirname(fileURLToPath(import.meta.url));
const repo = resolve(app, "../..");
const modules = join(app, "node_modules");
if (!existsSync(modules)) symlinkSync("../../orgs-ui/node_modules", modules);

const { createServer } = await import(
  pathToFileURL(join(repo, "orgs-ui/node_modules/vite/dist/node/index.js")).href
);
const server = await createServer({
  root: app,
  configFile: join(app, "vite.config.mjs"),
  logLevel: "warn",
});
await server.listen();
const base = server.resolvedUrls.local[0];

const [spec, ...prefixes] = process.argv.slice(2);
if (spec === undefined || spec === "--serve") {
  console.log(`Mockups at ${base}`);
} else {
  await capture(spec, prefixes);
  await server.close();
}

async function capture(spec, prefixes) {
  const { chromium } = await import(
    pathToFileURL(join(repo, "playwright/node_modules/playwright/index.mjs"))
      .href
  );
  const out = join(repo, "mockups", spec);
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const index = await browser.newPage();
  await index.goto(base);
  const screens = await index.evaluate(
    async (spec) =>
      ((await import("/src/registry.tsx")).specs[spec] ?? []).map(
        ({ id, title, width, dark }) => ({ id, title, width, dark }),
      ),
    spec,
  );
  await index.close();
  if (screens.length === 0) throw new Error(`no screens for spec ${spec}`);
  let failed = false;
  for (const s of screens) {
    if (prefixes.length > 0 && !prefixes.some((p) => s.id.startsWith(p)))
      continue;
    const phone = s.width !== undefined;
    const context = await browser.newContext({
      viewport: { width: s.width ?? 1440, height: phone ? 844 : 900 },
      deviceScaleFactor: phone ? 2 : 1,
      colorScheme: s.dark ? "dark" : "light",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}?s=${s.id}${s.dark ? "&theme=dark" : ""}`);
    await page.waitForLoadState("networkidle");
    // Grow the viewport to the page so fixed modal masks cover all of it.
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const viewport = page.viewportSize();
    if (height > viewport.height)
      await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `${s.id}.png`), fullPage: true });
    failed ||= errors.length > 0;
    console.log(s.id, errors.length ? `ERRORS: ${errors.join(" | ")}` : "ok");
    await context.close();
  }
  await browser.close();
  writeFileSync(join(out, "index.html"), gallery(spec, screens));
  if (failed) process.exitCode = 1;
}

function gallery(spec, screens) {
  const esc = (s) =>
    s.replace(
      /[&<>"]/g,
      (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`,
    );
  const groups = new Map();
  for (const s of screens) {
    const group = s.title.split(" · ")[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(s);
  }
  const sections = [...groups].map(
    ([group, list], i) =>
      `<h2 id="g${i}">${esc(group)}</h2>\n${list
        .map(
          (s) =>
            `<figure><figcaption>${esc(s.title)} <small>${s.id}.png</small></figcaption><img loading="lazy" src="${s.id}.png" alt="${esc(s.title)}"></figure>`,
        )
        .join("\n")}`,
  );
  const nav = [...groups.keys()]
    .map((g, i) => `<a href="#g${i}">${esc(g)}</a>`)
    .join(" ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(spec)} mockups</title>
<style>body{font-family:system-ui;margin:0;background:#f4f4f5;color:#18181b}main{max-width:1500px;margin:0 auto;padding:24px}h2{margin:40px 0 12px}figure{margin:0 0 32px;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px}figcaption{font-weight:600;margin-bottom:8px}small{font-weight:400;color:#71717a}img{max-width:100%;border:1px solid #e4e4e7}nav a{margin-right:12px}</style></head>
<body><main><h1>${esc(spec)} mockups</h1><p>Static mockups in the portals' Ant Design theme and shell. Data is invented. Regenerate with <code>node mockups/app/capture.mjs ${esc(spec)}</code>.</p>
<nav>${nav}</nav>
${sections.join("\n")}
</main></body></html>
`;
}
