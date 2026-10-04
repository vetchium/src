/**
 * The DNS wire format (RFC 1035) for one TXT question, as DNS-over-HTTPS
 * (RFC 8484) carries it.
 */

const headerSize = 12;
const txtType = 16;
const internetClass = 1;
const recursionDesired = 0x0100;

export const noError = 0;
export const nameError = 3;

export type RecordCheckResult = "present" | "absent" | "inconclusive";

export interface TXTAnswer {
  rcode: number;
  /** Each TXT record's character-strings joined, as the server reads them. */
  values: string[];
}

/** A TXT query for name. The id stays 0 so caches can share answers
 * (RFC 8484 section 4.1). */
export function encodeTXTQuery(name: string): Uint8Array {
  const labels = name.replace(/\.$/, "").toLowerCase().split(".");
  const encoder = new TextEncoder();
  const bytes: number[] = [
    0,
    0,
    recursionDesired >> 8,
    recursionDesired & 0xff,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  for (const label of labels) {
    const encoded = encoder.encode(label);
    if (encoded.length === 0 || encoded.length > 63) {
      throw new Error(`invalid DNS label in ${name}`);
    }
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0, 0, txtType, 0, internetClass);
  return Uint8Array.from(bytes);
}

/** Unpadded base64url, the form of the RFC 8484 `dns` query parameter. */
export function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Reads the response code and every TXT record in the answer section,
 * whichever owner a CNAME chain gave it. Throws on a malformed message. */
export function decodeTXTAnswer(message: Uint8Array): TXTAnswer {
  if (message.length < headerSize) throw new Error("truncated DNS header");
  const view = new DataView(
    message.buffer,
    message.byteOffset,
    message.byteLength,
  );
  const rcode = view.getUint16(2) & 0x000f;
  const questions = view.getUint16(4);
  const answers = view.getUint16(6);
  let offset = headerSize;
  for (let i = 0; i < questions; i++) {
    offset = skipName(message, offset) + 4;
  }
  const decoder = new TextDecoder();
  const values: string[] = [];
  for (let i = 0; i < answers; i++) {
    offset = skipName(message, offset);
    if (offset + 10 > message.length) throw new Error("truncated record");
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 8);
    const start = offset + 10;
    const end = start + length;
    if (end > message.length) throw new Error("truncated record data");
    if (type === txtType) {
      const parts: Uint8Array[] = [];
      let at = start;
      while (at < end) {
        const size = message[at] ?? 0;
        if (at + 1 + size > end) throw new Error("truncated TXT string");
        parts.push(message.subarray(at + 1, at + 1 + size));
        at += 1 + size;
      }
      values.push(parts.map((part) => decoder.decode(part)).join(""));
    }
    offset = end;
  }
  return { rcode, values };
}

/** The same split the server makes: a matching value is present, a name
 * with no matching value is absent, and anything else proves nothing. */
export function classifyTXTAnswer(
  answer: TXTAnswer,
  expected: string,
): RecordCheckResult {
  if (answer.rcode === noError && answer.values.includes(expected)) {
    return "present";
  }
  if (answer.rcode === noError || answer.rcode === nameError) return "absent";
  return "inconclusive";
}

function skipName(message: Uint8Array, start: number): number {
  let offset = start;
  for (;;) {
    const length = message[offset];
    if (length === undefined) throw new Error("truncated name");
    if ((length & 0xc0) === 0xc0) return offset + 2;
    if (length === 0) return offset + 1;
    offset += 1 + length;
  }
}
