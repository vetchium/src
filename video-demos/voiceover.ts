// Adds a spoken voiceover to a composed demo: each line of narration.srt is
// spoken by Kokoro (tts.py, in video-demos/.venv) and placed at its caption's
// start, then the track is mixed under the video as vetchium-demo-voiced.mp4.
// DEMO_VOICE picks another Kokoro voice, such as bm_george or af_heart.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RUN_DIR } from "./cast.ts";
import { HERE } from "./stack.ts";

const INPUT = process.argv[2] ? resolve(process.argv[2]) : RUN_DIR;
const VIDEO = join(INPUT, "vetchium-demo.mp4");
const OUTPUT = join(INPUT, "vetchium-demo-voiced.mp4");
const VOICE = process.env.DEMO_VOICE ?? "bf_emma";
const SPEED = 1;
const RATE = 24_000;
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

const probe = (file: string) =>
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
const length = probe(VIDEO);
const voiceDir = join(INPUT, "voice");
mkdirSync(voiceDir, { recursive: true });

// Each line is kept by a hash of what was spoken, so a re-run only speaks
// lines whose text or voice changed.
const lines = cues.map((cue) => {
  const key = createHash("sha256")
    .update(`${VOICE}|${SPEED}|${cue.text}`)
    .digest("hex")
    .slice(0, 16);
  return { ...cue, file: join(voiceDir, `${key}.wav`) };
});
const missing = lines.filter((line) => !existsSync(line.file));
if (missing.length > 0) {
  const job = join(voiceDir, "job.json");
  writeFileSync(
    job,
    JSON.stringify({
      voice: VOICE,
      speed: SPEED,
      items: missing.map((line) => ({ text: line.text, out: line.file })),
    }),
  );
  console.log(`speaking ${missing.length} of ${lines.length} lines`);
  execFileSync(
    join(HERE, ".venv", "bin", "python"),
    [join(HERE, "tts.py"), job],
    {
      stdio: "inherit",
    },
  );
}

const track = new Float32Array(Math.ceil(length * RATE));
let squeezed = 0;
for (const [i, line] of lines.entries()) {
  const next = lines[i + 1]?.from ?? length;
  const room = Math.max(0.5, next - line.from - GAP_SECONDS);
  const spoken = probe(line.file);
  const tempo = Math.min(MAX_TEMPO, Math.max(1, spoken / room));
  if (tempo > 1) {
    squeezed += 1;
    console.log(
      `line ${i + 1} sped up ${tempo.toFixed(2)}x: ${line.text.slice(0, 60)}`,
    );
  }
  const audio = samples(line.file, tempo);
  track.set(
    audio.subarray(0, track.length - Math.round(line.from * RATE)),
    Math.round(line.from * RATE),
  );
}

const raw = join(voiceDir, "track.f32");
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
    OUTPUT,
  ],
  { stdio: "inherit" },
);
console.log(
  `wrote ${OUTPUT} (${lines.length} lines, ${squeezed} sped up, voice ${VOICE})`,
);
