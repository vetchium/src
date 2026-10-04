import assert from "node:assert/strict";
import test from "node:test";
import {
  base64URL,
  classifyTXTAnswer,
  decodeTXTAnswer,
  encodeTXTQuery,
} from "./dnsMessage.ts";

const name = "_vetchium.acme.test";

function strings(...values: string[]): number[] {
  return values.flatMap((value) => [
    value.length,
    ...new TextEncoder().encode(value),
  ]);
}

function record(type: number, data: number[]): number[] {
  // A compression pointer to the question name at offset 12.
  return [0xc0, 12, 0, type, 0, 1, 0, 0, 0, 60, 0, data.length, ...data];
}

function response(rcode: number, ...answers: number[][]): Uint8Array {
  const question = Array.from(encodeTXTQuery(name).subarray(12));
  return Uint8Array.from([
    0,
    0,
    0x81,
    0x80 | rcode,
    0,
    1,
    0,
    answers.length,
    0,
    0,
    0,
    0,
    ...question,
    ...answers.flat(),
  ]);
}

test("encodes one recursive TXT question with id 0", () => {
  assert.deepEqual(
    Array.from(encodeTXTQuery("Ab.c.")),
    [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 97, 98, 1, 99, 0, 0, 16, 0, 1],
  );
  assert.throws(() => encodeTXTQuery("a..b"));
  assert.throws(() => encodeTXTQuery(`${"a".repeat(64)}.test`));
});

test("encodes unpadded base64url", () => {
  assert.equal(base64URL(Uint8Array.from([0xfb, 0xff])), "-_8");
});

test("joins each TXT record's strings and skips other types", () => {
  const answer = decodeTXTAnswer(
    response(
      0,
      record(5, [0xc0, 12]),
      record(16, strings("vetchium-verify=", "abc")),
      record(16, strings("other")),
    ),
  );
  assert.deepEqual(answer, {
    rcode: 0,
    values: ["vetchium-verify=abc", "other"],
  });
});

test("classifies answers the way the server does", () => {
  const expected = "vetchium-verify=abc";
  const decode = (message: Uint8Array) =>
    classifyTXTAnswer(decodeTXTAnswer(message), expected);
  assert.equal(decode(response(0, record(16, strings(expected)))), "present");
  assert.equal(
    decode(response(0, record(16, strings("vetchium-verify=old")))),
    "absent",
  );
  assert.equal(decode(response(0)), "absent");
  assert.equal(decode(response(3)), "absent");
  assert.equal(decode(response(2)), "inconclusive");
  assert.equal(decode(response(5)), "inconclusive");
});

test("rejects a malformed message", () => {
  const whole = response(0, record(16, strings("vetchium-verify=abc")));
  for (const length of [0, 11, 20, whole.length - 1]) {
    assert.throws(() => decodeTXTAnswer(whole.subarray(0, length)));
  }
  const overlong = response(0, record(16, [9, 97]));
  assert.throws(() => decodeTXTAnswer(overlong));
});
