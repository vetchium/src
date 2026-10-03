import { crc32 } from "node:zlib";
import { makePNG } from "./profile-picture-fixture.ts";

export { makePNG };

/**
 * A 128x128 baseline JPEG, encoded once by Go's standard encoder, so tests
 * need no JPEG library and no committed binary.
 */
const jpeg128 =
  "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";

export function makeJPEG128(): Buffer {
  return Buffer.from(jpeg128, "base64");
}

/** Adds a valid tEXt chunk after the header chunk, as a camera or editor
 * would leave metadata in an image. */
export function withTextChunk(
  png: Buffer,
  keyword: string,
  text: string,
): Buffer {
  const data = Buffer.concat([Buffer.from(`${keyword}\0${text}`, "latin1")]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from("tEXt", "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  const chunk = Buffer.concat([length, typeAndData, checksum]);
  // 8-byte signature + 25-byte IHDR chunk.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
