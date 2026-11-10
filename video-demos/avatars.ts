// Illustrated profile pictures for the Hub users, drawn as SVG and rendered
// to PNG by Chromium, so the video needs no outside images. A picture must be
// at least 400 px on each side (backend/internal/profilepicture).
import { writeFileSync } from "node:fs";
import type { Browser } from "@playwright/test";
import type { HubName } from "./cast.ts";

const SIZE = 512;

interface Look {
  background: string;
  skin: string;
  hair: string;
  brows?: string;
  /** Two scarf stripe colors. */
  scarf: [string, string];
  /** Hair drawn behind the head. */
  back: string;
  /** Hair drawn over the forehead. */
  front: string;
  mouth: string;
  extra?: string;
}

const curls = (points: [number, number, number][], fill: string) =>
  points
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`)
    .join("");

const LOOKS: Record<HubName, Look> = {
  hermione: {
    background: "#f3d9e6",
    skin: "#f1c7a5",
    hair: "#6b4226",
    scarf: ["#8b1a1a", "#d4a017"],
    back: curls(
      [
        [150, 210, 70],
        [362, 210, 70],
        [140, 300, 66],
        [372, 300, 66],
        [160, 380, 56],
        [352, 380, 56],
        [200, 140, 70],
        [312, 140, 70],
        [256, 120, 72],
      ],
      "#6b4226",
    ),
    front: curls(
      [
        [200, 150, 44],
        [256, 135, 48],
        [312, 150, 44],
        [172, 190, 34],
        [340, 190, 34],
      ],
      "#7a4b2b",
    ),
    mouth: `<path d="M226 290 Q256 314 286 290" stroke="#9b3b3b" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  },
  ron: {
    background: "#fde3cf",
    skin: "#f6d2b8",
    hair: "#d2561c",
    scarf: ["#8b1a1a", "#d4a017"],
    back: "",
    front: `<path d="M160 215 Q150 120 256 110 Q362 120 352 215 Q330 165 300 170 Q270 150 240 172 Q205 158 160 215 Z" fill="#d2561c"/>
      <path d="M190 160 L172 128 L214 146 Z M300 150 L322 118 L330 160 Z" fill="#d2561c"/>`,
    mouth: `<path d="M224 292 Q256 320 288 292" stroke="#9b3b3b" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    extra: curls(
      [
        [204, 262, 4],
        [218, 270, 4],
        [196, 276, 4],
        [308, 262, 4],
        [294, 270, 4],
        [316, 276, 4],
      ],
      "#c9774a",
    ),
  },
  draco: {
    background: "#d9eadf",
    skin: "#f4dccb",
    hair: "#ece4c4",
    brows: "#a8976a",
    scarf: ["#1a5e33", "#b8bcc2"],
    back: "",
    front: `<path d="M162 220 Q158 118 256 112 Q354 118 350 220 Q340 160 256 150 Q190 152 162 220 Z" fill="#ece4c4"/>
      <path d="M200 140 Q256 128 320 150" stroke="#d6cca3" stroke-width="6" fill="none"/>`,
    mouth: `<path d="M232 296 Q262 300 290 284" stroke="#9b3b3b" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  },
};

function svg(look: Look): string {
  const [stripeA, stripeB] = look.scarf;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${look.background}"/>
  ${look.back}
  <path d="M86 512 Q100 390 256 380 Q412 390 426 512 Z" fill="#1d1d22"/>
  <rect x="226" y="320" width="60" height="70" fill="${look.skin}"/>
  <path d="M180 392 Q256 430 332 392 L338 420 Q256 460 174 420 Z" fill="${stripeA}"/>
  <path d="M184 404 Q256 440 328 404 L330 414 Q256 450 182 414 Z" fill="${stripeB}"/>
  <rect x="270" y="410" width="34" height="100" fill="${stripeA}"/>
  <rect x="270" y="440" width="34" height="14" fill="${stripeB}"/>
  <rect x="270" y="476" width="34" height="14" fill="${stripeB}"/>
  <ellipse cx="164" cy="245" rx="16" ry="24" fill="${look.skin}"/>
  <ellipse cx="348" cy="245" rx="16" ry="24" fill="${look.skin}"/>
  <ellipse cx="256" cy="235" rx="94" ry="110" fill="${look.skin}"/>
  <path d="M206 214 Q222 204 238 212" stroke="${look.brows ?? look.hair}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M274 212 Q290 204 306 214" stroke="${look.brows ?? look.hair}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <circle cx="222" cy="238" r="9" fill="#2b2b2b"/>
  <circle cx="290" cy="238" r="9" fill="#2b2b2b"/>
  <path d="M256 248 Q248 270 258 274" stroke="#c99a7c" stroke-width="5" fill="none" stroke-linecap="round"/>
  ${look.extra ?? ""}
  ${look.mouth}
  ${look.front}
</svg>`;
}

/** Writes `<name>.png` for each Hub user into `dir` and returns the names. */
export async function writeAvatars(
  browser: Browser,
  dir: string,
): Promise<Record<HubName, string>> {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  const files = {} as Record<HubName, string>;
  for (const [name, look] of Object.entries(LOOKS) as [HubName, Look][]) {
    await page.setContent(
      `<html><body style="margin:0">${svg(look)}</body></html>`,
    );
    const file = `${name}.png`;
    writeFileSync(`${dir}/${file}`, await page.screenshot());
    files[name] = file;
  }
  await page.close();
  return files;
}
