// Edits a recorded run into the demo video. Each on-air segment becomes the
// browser area of a 1920x1080 frame, under a title bar naming the window and
// above a caption band; title cards open and close it. Also writes the
// captions as SRT and as a timestamped script for the voiceover.
//
// Homebrew's ffmpeg lacks the drawtext and subtitles filters, so the title
// bar and captions are HTML stills rendered by Chromium and overlaid.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { type Role, RUN_DIR } from "./cast.ts";
import { FRAME, type Timeline } from "./studio.ts";

const INPUT = process.argv[2] ? resolve(process.argv[2]) : RUN_DIR;
const FINAL = resolve(process.argv[3] ?? join(INPUT, "vetchium-demo.mp4"));

const OUTPUT = { width: 1920, height: 1080 };
const TOP = 72;
const CAPTION_BAND = OUTPUT.height - TOP - FRAME.height;
const FPS = 30;
const CARD_SECONDS = 5;

const INTRO = {
  title: "Hiring with a sourcing agency, end to end",
  lines: [
    "An agency joins the marketplace · a company hires through it",
    "and every candidate tracks their own application",
  ],
};
const OUTRO = {
  title: "Hermione is hired",
  lines: [
    "Sortinghat sourced her · Gryffindor hired her",
    "Voldemort and Draco always knew where they stood",
  ],
};

const timeline = JSON.parse(
  readFileSync(join(INPUT, "timeline.json"), "utf8"),
) as Timeline;
if (timeline.segments.length === 0) throw new Error("nothing was recorded");
const work = join(INPUT, "work");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
];
// The concat demuxer resolves relative entries against the list file.
const concatList = (file: string, entries: string[]) =>
  writeFileSync(file, entries.join("\n"));

// 1. The body: each segment's frames, each shown until the next arrived.
interface Placed {
  window: string;
  start: number;
  end: number;
  offset: number;
  duration: number;
  file: string;
}
let offset = 0;
const placed: Placed[] = timeline.segments.map((segment, i) => {
  const lines: string[] = [];
  segment.frames.forEach((frame, k) => {
    const next = segment.frames[k + 1]?.ts ?? segment.end;
    lines.push(
      `file '${frame.file}'`,
      `duration ${Math.max(0.001, next - frame.ts).toFixed(4)}`,
    );
  });
  // The demuxer ignores the last entry's duration unless it is repeated.
  lines.push(`file '${segment.frames.at(-1)?.file}'`);
  const list = join(work, `segment${i}.txt`);
  concatList(list, lines);
  const file = join(work, `segment${i}.mp4`);
  ffmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `scale=${FRAME.width}:${FRAME.height}:flags=lanczos`,
    ...ENCODE,
    file,
  ]);
  const duration = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  const at: Placed = {
    window: segment.window,
    start: segment.frames[0]?.ts ?? segment.end,
    end: segment.end,
    offset,
    duration,
    file,
  };
  offset += duration;
  return at;
});
const total = offset;
const bodyList = join(work, "body.txt");
concatList(
  bodyList,
  placed.map((p) => `file '${p.file}'`),
);
const body = join(work, "body.mp4");
ffmpeg(["-f", "concat", "-safe", "0", "-i", bodyList, "-c", "copy", body]);

// 2. Captions on the output clock. Wall time maps into the segment on air;
// time off air collapses to the next segment's start.
function outputTime(wall: number): number {
  for (const p of placed) {
    if (wall < p.start) return p.offset;
    if (wall <= p.end) return p.offset + Math.min(wall - p.start, p.duration);
  }
  return total;
}

interface Cue {
  text: string;
  from: number;
  to: number;
}
const cues: Cue[] = [];
let open: Cue | null = null;
for (const caption of timeline.captions) {
  const t = outputTime(caption.at);
  if (open) {
    open.to = t;
    if (open.to - open.from > 0.2) cues.push(open);
    open = null;
  }
  if (caption.text) open = { text: caption.text, from: t, to: total };
}
if (open) cues.push(open);

// 3. The chrome (title bar and caption band): one still per interval in
// which neither the window nor the caption changes.
const roles = new Map<string, Role>(timeline.windows.map((r) => [r.id, r]));
const cuts = new Set<number>([0, total]);
for (const p of placed) cuts.add(p.offset);
for (const c of cues) {
  cuts.add(c.from);
  cuts.add(c.to);
}
const times = [...cuts].sort((a, b) => a - b);

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Single quotes only: the string sits inside double-quoted style attributes.
const FONT =
  "font-family: Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif;";

function chromeHTML(role: Role, caption: string | null) {
  const size = caption && caption.length > 110 ? 27 : 31;
  return `<html><body style="margin:0;width:${OUTPUT.width}px;height:${OUTPUT.height}px;background:#0f1115;${FONT}">
  <div style="height:${TOP}px;display:flex;align-items:center;gap:18px;padding:0 32px;background:#16181d;border-bottom:3px solid ${role.accent}">
    <div style="width:16px;height:16px;border-radius:50%;background:${role.accent}"></div>
    <div style="color:#fff;font-size:28px;font-weight:700">${html(role.title)}</div>
    <div style="color:#aab0bc;font-size:22px">${html(role.subtitle)}</div>
    <div style="margin-left:auto;color:#6b7280;font-size:20px;letter-spacing:.04em">VETCHIUM DEMO</div>
  </div>
  <div style="position:absolute;top:${TOP + FRAME.height}px;left:0;right:0;height:${CAPTION_BAND}px;display:flex;align-items:center;justify-content:center;padding:0 80px;box-sizing:border-box">
    <div style="color:#fff;font-size:${size}px;line-height:1.3;text-align:center;font-weight:500">${caption ? html(caption) : ""}</div>
  </div></body></html>`;
}

function cardHTML(card: { title: string; lines: string[] }) {
  return `<html><body style="margin:0;width:${OUTPUT.width}px;height:${OUTPUT.height}px;background:linear-gradient(135deg,#16181d,#2a1215 55%,#1d1530);${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff">
  <div style="font-size:30px;letter-spacing:.3em;color:#f5c542;margin-bottom:28px">VETCHIUM</div>
  <div style="font-size:72px;font-weight:800;text-align:center;max-width:1500px;line-height:1.15">${html(card.title)}</div>
  <div style="margin-top:40px;font-size:30px;color:#c9ced8;text-align:center;line-height:1.6">${card.lines.map(html).join("<br/>")}</div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: OUTPUT });
const stills = new Map<string, string>();
async function still(key: string, html: string): Promise<string> {
  const known = stills.get(key);
  if (known) return known;
  const file = join(work, `still${stills.size}.png`);
  await page.setContent(html);
  await page.screenshot({ path: file });
  stills.set(key, file);
  return file;
}

const chromeLines: string[] = [];
let from = 0;
for (const to of times.slice(1)) {
  // A sliver this short folds into the next interval.
  if (to - from < 0.001) continue;
  const mid = (from + to) / 2;
  const segment =
    placed.find((p) => mid >= p.offset && mid < p.offset + p.duration) ??
    placed.at(-1);
  const role = roles.get(segment?.window ?? "");
  if (!role) throw new Error(`no role for window ${segment?.window}`);
  const cue = cues.find((c) => mid >= c.from && mid < c.to);
  const file = await still(
    `${role.id}|${cue?.text ?? ""}`,
    chromeHTML(role, cue?.text ?? null),
  );
  chromeLines.push(`file '${file}'`, `duration ${(to - from).toFixed(4)}`);
  from = to;
}
chromeLines.push(chromeLines.at(-2) ?? "");
const introStill = await still("intro", cardHTML(INTRO));
const outroStill = await still("outro", cardHTML(OUTRO));
await browser.close();

const chromeList = join(work, "chrome.txt");
concatList(chromeList, chromeLines);
const chrome = join(work, "chrome.mp4");
ffmpeg(["-f", "concat", "-safe", "0", "-i", chromeList, ...ENCODE, chrome]);

// 4. Overlay the body on the chrome, then add the cards.
const main = join(work, "main.mp4");
ffmpeg([
  "-i",
  chrome,
  "-i",
  body,
  "-filter_complex",
  `[0:v][1:v]overlay=0:${TOP}:shortest=1`,
  ...ENCODE,
  main,
]);
const card = (still: string, out: string) =>
  ffmpeg([
    "-loop",
    "1",
    "-t",
    String(CARD_SECONDS),
    "-i",
    still,
    "-vf",
    "fade=in:0:12",
    ...ENCODE,
    out,
  ]);
const intro = join(work, "intro.mp4");
const outro = join(work, "outro.mp4");
card(introStill, intro);
card(outroStill, outro);
const allList = join(work, "all.txt");
concatList(
  allList,
  [intro, main, outro].map((f) => `file '${f}'`),
);
ffmpeg([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  allList,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  FINAL,
]);

// 5. The captions, with the cards, for the voiceover.
function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
const all: Cue[] = [
  {
    text: `${INTRO.title}. ${INTRO.lines.join(", ")}.`,
    from: 0,
    to: CARD_SECONDS,
  },
  ...cues.map((c) => ({
    text: c.text,
    from: c.from + CARD_SECONDS,
    to: c.to + CARD_SECONDS,
  })),
  {
    text: `${OUTRO.title}. ${OUTRO.lines.join(". ")}.`,
    from: CARD_SECONDS + total,
    to: 2 * CARD_SECONDS + total,
  },
];
const base = FINAL.replace(/\.mp4$/, "");
writeFileSync(
  `${base}.srt`,
  all
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`,
    )
    .join("\n"),
);
writeFileSync(
  `${base}-script.txt`,
  `${all
    .map(
      (c) =>
        `[${srtTime(c.from).slice(0, 8)} – ${srtTime(c.to).slice(0, 8)}] ${c.text}`,
    )
    .join("\n")}\n`,
);
console.log(
  `wrote ${FINAL} (${(total + 2 * CARD_SECONDS).toFixed(1)}s, ${all.length} captions)`,
);
