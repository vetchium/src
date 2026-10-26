// Records several browser windows as one edited video. Only the window on air
// is captured, as CDP screencast frames with wall-clock timestamps; captions
// sit on one timeline that compose.ts burns in and writes as SRT.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Locator,
  Page,
} from "@playwright/test";
import type { Role } from "./cast.ts";

export const VIEWPORT = { width: 1440, height: 675 };
// Screencast frames follow the device scale only when Chromium is launched
// with it (a context's deviceScaleFactor is ignored), so 1440x675 CSS px
// arrive as 1920x900 frames.
export const CHROMIUM_ARGS = ["--force-device-scale-factor=1.3333333"];
export const FRAME = { width: 1920, height: 900 };

// A voiceover reads about 150 words a minute; a caption stays up at least
// that long plus a breath, so narration generated from it never overruns.
const WORDS_PER_SECOND = 2.4;
const CAPTION_BREATH_SECONDS = 0.8;

export interface Frame {
  file: string;
  ts: number;
}

export interface Segment {
  window: string;
  frames: Frame[];
  end: number;
}

export interface Caption {
  text: string | null;
  at: number;
}

export interface Timeline {
  windows: Role[];
  segments: Segment[];
  captions: Caption[];
}

const CURSOR_SCRIPT = `(() => {
  const KEY = "__demo_cursor";
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } };
  const install = () => {
    if (document.getElementById(KEY)) return;
    const c = document.createElement("div");
    c.id = KEY;
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.6 20.3 L11.5 13.6 L17.6 13.6 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "-40px", top: "-40px", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-4px,-2px)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" });
    document.documentElement.appendChild(c);
    const p = read();
    if (p) { c.style.left = p.x + "px"; c.style.top = p.y + "px"; }
  };
  const move = (e) => {
    install();
    const c = document.getElementById(KEY);
    c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
    try { sessionStorage.setItem(KEY, JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {}
  };
  const ripple = (e) => {
    const r = document.createElement("div");
    Object.assign(r.style, { position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", background: "rgba(250, 173, 20, .45)", border: "2px solid rgba(250,140,22,.9)", zIndex: "2147483646", pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.6)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  };
  addEventListener("mousemove", move, true);
  addEventListener("mousedown", ripple, true);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
})();`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Studio {
  readonly timeline: Timeline = { windows: [], segments: [], captions: [] };
  readonly browser: Browser;
  readonly dir: string;
  private live: DemoWindow | null = null;
  private frameCount = 0;
  private current: { text: string; at: number } | null = null;

  constructor(browser: Browser, dir: string) {
    this.browser = browser;
    this.dir = dir;
    mkdirSync(join(dir, "frames"), { recursive: true });
  }

  async window(role: Role): Promise<DemoWindow> {
    this.timeline.windows.push(role);
    const context = await this.browser.newContext({
      viewport: VIEWPORT,
      locale: "en-US",
      timezoneId: "Asia/Singapore",
    });
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    return new DemoWindow(this, role, page, cdp);
  }

  /** Shows `text` once the previous caption has been up long enough to be
   * read aloud. Call it only while a window is on air. */
  async caption(text: string) {
    if (!this.live) throw new Error("a caption needs a window on air");
    await this.holdCaption();
    const at = Date.now() / 1000;
    this.timeline.captions.push({ text, at });
    this.current = { text, at };
  }

  private async holdCaption() {
    if (!this.current) return;
    const words = this.current.text.split(/\s+/).length;
    const due =
      this.current.at + words / WORDS_PER_SECOND + CAPTION_BREATH_SECONDS;
    const wait = due - Date.now() / 1000;
    if (wait > 0) await sleep(wait * 1000);
  }

  nextFrameFile(): string {
    this.frameCount += 1;
    return join(
      this.dir,
      "frames",
      `${String(this.frameCount).padStart(6, "0")}.jpg`,
    );
  }

  /** Records `window` while `body` runs. Each segment ends its caption, so
   * the next one starts clean. */
  async onAir(window: DemoWindow, body: () => Promise<void>) {
    if (this.live) throw new Error(`${this.live.role.id} is already on air`);
    this.live = window;
    const segment: Segment = { window: window.role.id, frames: [], end: 0 };
    await window.startCapture(segment);
    try {
      await body();
      await this.holdCaption();
    } finally {
      this.timeline.captions.push({ text: null, at: Date.now() / 1000 });
      this.current = null;
      await window.stopCapture();
      segment.end = Date.now() / 1000;
      this.timeline.segments.push(segment);
      this.live = null;
      this.save();
    }
  }

  save() {
    writeFileSync(
      join(this.dir, "timeline.json"),
      JSON.stringify(this.timeline, null, 1),
    );
  }
}

/** One signed-in person's browser window, with a visible cursor. */
export class DemoWindow {
  readonly role: Role;
  readonly page: Page;
  private readonly cdp: CDPSession;
  private mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  private segment: Segment | null = null;
  private acks: Promise<unknown>[] = [];

  constructor(studio: Studio, role: Role, page: Page, cdp: CDPSession) {
    this.role = role;
    this.page = page;
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", (event) => {
      this.acks.push(
        cdp
          .send("Page.screencastFrameAck", { sessionId: event.sessionId })
          .catch(() => undefined),
      );
      const segment = this.segment;
      if (!segment) return;
      const file = studio.nextFrameFile();
      writeFileSync(file, Buffer.from(event.data, "base64"));
      segment.frames.push({
        file,
        ts: event.metadata.timestamp ?? Date.now() / 1000,
      });
    });
  }

  get context(): BrowserContext {
    return this.page.context();
  }

  async startCapture(segment: Segment) {
    this.segment = segment;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: FRAME.width,
      maxHeight: FRAME.height,
    });
    // A mouse move repaints, so the first frame arrives at once.
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
    await this.pause(250);
  }

  async stopCapture() {
    await this.pause(150);
    await this.cdp.send("Page.stopScreencast");
    await Promise.all(this.acks);
    this.acks = [];
    this.segment = null;
  }

  pause(ms: number) {
    return this.page.waitForTimeout(ms);
  }

  /** Opens `url` and waits for its first data requests to settle. */
  async goto(url: string) {
    await this.page.goto(url);
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
  }

  /** Glides the visible cursor to the element's centre. */
  async pointAt(locator: Locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${locator} has no box`);
    await this.glide(box.x + box.width / 2, box.y + box.height / 2);
  }

  async glide(x: number, y: number) {
    const from = { ...this.mouse };
    const distance = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(8, Math.min(32, Math.round(distance / 22)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(
        from.x + (x - from.x) * ease,
        from.y + (y - from.y) * ease,
      );
      await this.pause(12);
    }
    this.mouse = { x, y };
  }

  /** Never measures `locator` after the click: a click that removes it would
   * otherwise wait out Playwright's 30 s timeout on air. */
  async click(locator: Locator, options: { pause?: number } = {}) {
    await locator.waitFor({ state: "visible" });
    await this.pointAt(locator);
    await this.pause(180);
    await locator.click();
    await this.pause(options.pause ?? 450);
  }

  async type(locator: Locator, text: string, options: { delay?: number } = {}) {
    await this.click(locator, { pause: 150 });
    await locator.pressSequentially(text, { delay: options.delay ?? 28 });
    await this.pause(300);
  }

  /** Types the first words of a long text, then fills the rest at once. */
  async typeLong(locator: Locator, text: string) {
    await this.click(locator, { pause: 150 });
    await locator.pressSequentially(text.slice(0, 40), { delay: 25 });
    await locator.fill(text);
    await this.pause(300);
  }

  /** Date and date-time inputs ignore typed keystrokes; fill them instead. */
  async setDate(locator: Locator, value: string) {
    await this.pointAt(locator);
    await this.pause(200);
    await locator.fill(value);
    await this.pause(600);
  }

  /** Scrolls smoothly by `dy` CSS px. */
  async scroll(dy: number) {
    const step = Math.sign(dy) * 60;
    for (let moved = 0; Math.abs(moved) < Math.abs(dy); moved += step) {
      await this.page.mouse.wheel(0, step);
      await this.pause(28);
    }
    await this.pause(350);
  }

  async scrollToTop() {
    await this.page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
    await this.pause(600);
  }

  /** Picks the first antd Select option containing `text`. Option titles
   * can carry more than the label, such as "Faculty hiring · 2 stages". */
  async choose(
    combobox: Locator,
    text: string,
    options: { search?: boolean } = {},
  ) {
    await this.click(combobox, { pause: 300 });
    if (options.search) await combobox.pressSequentially(text, { delay: 30 });
    await this.click(
      this.page
        .locator(".ant-select-dropdown:visible .ant-select-item-option")
        .filter({ hasText: text })
        .first(),
    );
  }
}
