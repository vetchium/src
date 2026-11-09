// Edits a recorded run into the demo video. Each on-air segment becomes the
// browser area of a 1920x1080 frame, under a title bar naming the window and
// above a caption band; title cards, including the cast card, sit between
// segments as the story placed them. Also writes the captions as SRT and as
// a timestamped script for the voiceover.
//
// Homebrew's ffmpeg lacks the drawtext and subtitles filters, so the title
// bar, captions, and cards are HTML stills rendered by Chromium and overlaid.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { type Role, RUN_DIR } from "./cast.ts";
import { type Card, FRAME, type Segment, type Timeline } from "./studio.ts";

const INPUT = process.argv[2] ? resolve(process.argv[2]) : RUN_DIR;
const FINAL = resolve(process.argv[3] ?? join(INPUT, "vetchium-demo.mp4"));

const OUTPUT = { width: 1920, height: 1080 };
const TOP = 72;
const CAPTION_BAND = OUTPUT.height - TOP - FRAME.height;
const FPS = 30;

const timeline = JSON.parse(
  readFileSync(join(INPUT, "timeline.json"), "utf8"),
) as Timeline;
if (!timeline.segments.some((s) => s.frames.length > 0)) {
  throw new Error("nothing was recorded");
}
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
const duration = (file: string) =>
  Number(
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

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Single quotes only: the string sits inside double-quoted style attributes.
const FONT =
  "font-family: Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif;";

function chromeHTML(role: Role, caption: string | null) {
  const size = caption && caption.length > 110 ? 27 : 31;
  return `<html><body style="margin:0;width:${OUTPUT.width}px;height:${OUTPUT.height}px;background:#0f1115;${FONT}">
  <div style="height:${TOP}px;display:flex;align-items:center;gap:18px;padding:0 32px;background:#16181d;border-bottom:4px solid ${role.accent}">
    <div style="width:18px;height:18px;border-radius:50%;background:${role.accent}"></div>
    <div style="color:#fff;font-size:28px;font-weight:700">${html(role.title)}</div>
    <div style="color:#aab0bc;font-size:22px">${html(role.subtitle)}</div>
    <div style="margin-left:auto;color:#6b7280;font-size:20px;letter-spacing:.04em">VETCHIUM</div>
  </div>
  <div style="position:absolute;top:${TOP + FRAME.height}px;left:0;right:0;height:${CAPTION_BAND}px;display:flex;align-items:center;justify-content:center;padding:0 80px;box-sizing:border-box">
    <div style="color:#fff;font-size:${size}px;line-height:1.3;text-align:center;font-weight:500">${caption ? html(caption) : ""}</div>
  </div></body></html>`;
}

function castHTML(roles: Role[]) {
  return `<div style="margin-top:56px;display:grid;grid-template-columns:repeat(2, 640px);gap:18px 48px">${roles
    .map(
      (
        r,
      ) => `<div style="display:flex;align-items:center;gap:18px;padding:14px 22px;border-radius:14px;background:${r.theme === "dark" ? "#0b0c10" : "#f5f6f8"};border-left:10px solid ${r.accent}">
      <div style="width:22px;height:22px;border-radius:50%;background:${r.accent};flex:none"></div>
      <div><div style="font-size:30px;font-weight:700;color:${r.theme === "dark" ? "#fff" : "#16181d"}">${html(r.title)}</div>
      <div style="font-size:21px;color:${r.theme === "dark" ? "#aab0bc" : "#4b5563"}">${html(r.part)} · ${r.theme} mode</div></div></div>`,
    )
    .join("")}</div>`;
}

function cardHTML(card: Card, roles: Role[]) {
  const titleSize = card.cast ? 60 : 72;
  return `<html><body style="margin:0;width:${OUTPUT.width}px;height:${OUTPUT.height}px;background:linear-gradient(135deg,#16181d,#2a1215 55%,#1d1530);${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff">
  <div style="font-size:30px;letter-spacing:.3em;color:#f5c542;margin-bottom:28px">VETCHIUM</div>
  <div style="font-size:${titleSize}px;font-weight:800;text-align:center;max-width:1600px;line-height:1.15">${html(card.title)}</div>
  <div style="margin-top:32px;font-size:30px;color:#c9ced8;text-align:center;line-height:1.55">${card.lines.map(html).join("<br/>")}</div>
  ${card.cast ? castHTML(roles) : ""}
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: OUTPUT });
const stills = new Map<string, string>();
async function still(key: string, markup: string): Promise<string> {
  const known = stills.get(key);
  if (known) return known;
  const file = join(work, `still${stills.size}.png`);
  await page.setContent(markup);
  await page.screenshot({ path: file });
  stills.set(key, file);
  return file;
}

const roles = new Map<string, Role>(timeline.windows.map((r) => [r.id, r]));

interface Cue {
  text: string;
  from: number;
  to: number;
}

/** Captions on one segment's own clock: wall time inside the segment, or
 * its start for a caption set while it was preparing. */
function segmentCues(segment: Segment, length: number): Cue[] {
  const start = segment.frames[0]?.ts ?? segment.end;
  const local = (wall: number) => Math.min(Math.max(0, wall - start), length);
  const cues: Cue[] = [];
  let open: Cue | null = null;
  for (const caption of timeline.captions) {
    if (caption.at < start - 0.5 || caption.at > segment.end + 0.01) continue;
    const t = local(caption.at);
    if (open) {
      open.to = t;
      if (open.to - open.from > 0.2) cues.push(open);
      open = null;
    }
    if (caption.text) open = { text: caption.text, from: t, to: length };
  }
  if (open) cues.push(open);
  return cues;
}

/** One recorded segment as a full 1920x1080 clip with its chrome. */
async function recorded(segment: Segment, i: number) {
  const role = roles.get(segment.window);
  if (!role) throw new Error(`no role for window ${segment.window}`);
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
  const body = join(work, `segment${i}-body.mp4`);
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
    body,
  ]);
  const length = duration(body);
  const cues = segmentCues(segment, length);
  const cuts = new Set<number>([0, length]);
  for (const c of cues) {
    cuts.add(c.from);
    cuts.add(c.to);
  }
  const times = [...cuts].sort((a, b) => a - b);
  const chromeLines: string[] = [];
  let from = 0;
  for (const to of times.slice(1)) {
    // A sliver this short folds into the next interval.
    if (to - from < 0.001) continue;
    const mid = (from + to) / 2;
    const cue = cues.find((c) => mid >= c.from && mid < c.to);
    const file = await still(
      `${role.id}|${cue?.text ?? ""}`,
      chromeHTML(role, cue?.text ?? null),
    );
    chromeLines.push(`file '${file}'`, `duration ${(to - from).toFixed(4)}`);
    from = to;
  }
  chromeLines.push(chromeLines.at(-2) ?? "");
  const chromeList = join(work, `segment${i}-chrome.txt`);
  concatList(chromeList, chromeLines);
  const chrome = join(work, `segment${i}-chrome.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", chromeList, ...ENCODE, chrome]);
  const clip = join(work, `segment${i}.mp4`);
  ffmpeg([
    "-i",
    chrome,
    "-i",
    body,
    "-filter_complex",
    `[0:v][1:v]overlay=0:${TOP}:shortest=1`,
    ...ENCODE,
    clip,
  ]);
  return { clip, length: duration(clip), cues };
}

async function carded(card: Card, i: number) {
  const image = await still(`card${i}`, cardHTML(card, timeline.windows));
  const clip = join(work, `segment${i}.mp4`);
  ffmpeg([
    "-loop",
    "1",
    "-t",
    String(card.seconds),
    "-i",
    image,
    "-vf",
    "fade=in:0:12",
    ...ENCODE,
    clip,
  ]);
  const spoken = `${card.title}. ${card.lines.join(" ")}`;
  return {
    clip,
    length: duration(clip),
    cues: [{ text: spoken, from: 0, to: card.seconds }],
  };
}

const clips: string[] = [];
const all: Cue[] = [];
let offset = 0;
for (const [i, segment] of timeline.segments.entries()) {
  const part = segment.card
    ? await carded(segment.card, i)
    : segment.frames.length > 0
      ? await recorded(segment, i)
      : null;
  if (!part) continue;
  clips.push(part.clip);
  for (const c of part.cues) {
    all.push({ text: c.text, from: c.from + offset, to: c.to + offset });
  }
  offset += part.length;
}
await browser.close();

const allList = join(work, "all.txt");
concatList(
  allList,
  clips.map((f) => `file '${f}'`),
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

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
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
  `wrote ${FINAL} (${offset.toFixed(1)}s, ${all.length} captions, ${clips.length} clips)`,
);
