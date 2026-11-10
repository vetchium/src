// Adds the spoken voiceover to a composed demo: each line of narration.srt is
// spoken (voice.ts) and placed at its caption's start, then the track is
// mixed under the video as vetchium-demo-voiced.mp4.
import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { RUN_DIR } from "./cast.ts";
import { mediaSeconds, RATE, speak } from "./voice.ts";

const INPUT = process.argv[2] ? resolve(process.argv[2]) : RUN_DIR;
const VIDEO = join(INPUT, "vetchium-demo.mp4");
const OUTPUT = join(INPUT, "vetchium-demo-voiced.mp4");
// A line that would overrun its caption is sped up, but never past this.
const MAX_TEMPO = 1.25;
// Silence kept before the next line starts.
const GAP_SECONDS = 0.25;

interface Cue {
  from: number;
  to: number;
  text: string;
}

const seconds = (stamp: string) => {
  const [h, m, rest] = stamp.split(":");
  const [s, ms] = (rest ?? "0,0").split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
};

function readCues(file: string): Cue[] {
  return readFileSync(file, "utf8")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const [, timing = "", ...text] = block.split("\n");
      const [from = "", to = ""] = timing.split(" --> ");
      return { from: seconds(from), to: seconds(to), text: text.join(" ") };
    });
}

/** Decodes `file` to mono float samples at RATE, sped up by `tempo`. */
function samples(file: string, tempo: number): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-af",
      `atempo=${tempo.toFixed(4)}`,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      String(RATE),
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const cues = readCues(join(INPUT, "narration.srt"));
const length = mediaSeconds(VIDEO);
const voiceDir = join(INPUT, "voice");
const files = speak(
  voiceDir,
  cues.map((cue) => cue.text),
);

// Lines no caption speaks any more, from older cuts, are dropped.
const used = new Set(files);
for (const name of readdirSync(voiceDir)) {
  const file = join(voiceDir, name);
  if (!used.has(file)) rmSync(file);
}

const track = new Float32Array(Math.ceil(length * RATE));
let squeezed = 0;
for (const [i, cue] of cues.entries()) {
  const file = files[i] as string;
  const next = cues[i + 1]?.from ?? length;
  const room = Math.max(0.5, next - cue.from - GAP_SECONDS);
  const tempo = Math.min(MAX_TEMPO, Math.max(1, mediaSeconds(file) / room));
  if (tempo > 1) {
    squeezed += 1;
    console.log(
      `line ${i + 1} sped up ${tempo.toFixed(2)}x: ${cue.text.slice(0, 60)}`,
    );
  }
  const start = Math.round(cue.from * RATE);
  track.set(samples(file, tempo).subarray(0, track.length - start), start);
}

const raw = join(INPUT, "work", "voice-track.f32");
// Written aside and renamed, so a failed run never leaves a broken video.
const partial = join(INPUT, "work", "voiced.partial.mp4");
writeFileSync(raw, new Uint8Array(track.buffer));
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-i",
    VIDEO,
    "-f",
    "f32le",
    "-ar",
    String(RATE),
    "-ac",
    "1",
    "-i",
    raw,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-af",
    // YouTube plays back near -14 LUFS; speech mastered a little lower.
    "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    partial,
  ],
  { stdio: "inherit" },
);
renameSync(partial, OUTPUT);
rmSync(raw);
console.log(`wrote ${OUTPUT} (${cues.length} lines, ${squeezed} sped up)`);
