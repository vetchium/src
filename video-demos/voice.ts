// The narrator's voice: Kokoro (tts.py, in video-demos/.venv) speaking
// af_heart. compose.ts speaks each card's narration to time the card, and
// voiceover.ts speaks every caption for the track. A line is cached under
// `<run>/voice/` by a hash of what is said, so each is spoken once.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./stack.ts";

const VOICE = "af_heart";
const SPEED = 1;
export const RATE = 24_000;
// Words Kokoro guesses wrong, respelled in its inline phoneme markup. A
// possessive is listed before its word. Thambi rhymes with "bee", not "bye".
const PRONUNCIATIONS: Record<string, string> = {
  "Thambi's": "θˈʌmbiz",
  Thambi: "θˈʌmbi",
};

const said = (text: string) =>
  Object.entries(PRONUNCIATIONS).reduce(
    (line, [word, phonemes]) =>
      // Skips a word already inside markup, and a word followed by a
      // possessive, which was replaced first.
      line.replace(
        new RegExp(`(?<![[\\w])${word}(?![\\w']|\\])`, "g"),
        `[${word}](/${phonemes}/)`,
      ),
    text,
  );

export const mediaSeconds = (file: string) =>
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

/** Returns each text's WAV file under `dir`, speaking those not yet there. */
export function speak(dir: string, texts: string[]): string[] {
  mkdirSync(dir, { recursive: true });
  const lines = texts.map((text) => {
    const spoken = said(text);
    const key = createHash("sha256")
      .update(`${VOICE}|${SPEED}|${spoken}`)
      .digest("hex")
      .slice(0, 16);
    return { spoken, file: join(dir, `${key}.wav`) };
  });
  const missing = [
    ...new Map(
      lines
        .filter((line) => !existsSync(line.file))
        .map((line) => [line.file, line]),
    ).values(),
  ];
  if (missing.length > 0) {
    const job = join(dir, "job.json");
    writeFileSync(
      job,
      JSON.stringify({
        voice: VOICE,
        speed: SPEED,
        items: missing.map((line) => ({ text: line.spoken, out: line.file })),
      }),
    );
    console.log(`speaking ${missing.length} of ${lines.length} lines`);
    execFileSync(
      join(HERE, ".venv", "bin", "python"),
      [join(HERE, "tts.py"), job],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  return lines.map((line) => line.file);
}
