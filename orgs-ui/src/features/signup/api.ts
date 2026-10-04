import { dnsOverHTTPS } from "../../app/regions";
import {
  base64URL,
  classifyTXTAnswer,
  decodeTXTAnswer,
  encodeTXTQuery,
  type RecordCheckResult,
} from "./dnsMessage";

/**
 * Looks the signup's TXT record up through the environment's DNS-over-HTTPS
 * resolver. The answer only advises the user; the region's API looks the
 * record up again when the signup is submitted.
 */
export async function checkSignupRecord(
  name: string,
  value: string,
  signal: AbortSignal,
): Promise<RecordCheckResult> {
  const url = new URL(dnsOverHTTPS);
  url.searchParams.set("dns", base64URL(encodeTXTQuery(name)));
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/dns-message" },
      cache: "no-store",
      credentials: "omit",
      // The page URL carries the private signup token.
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!response.ok) return "inconclusive";
    return classifyTXTAnswer(
      decodeTXTAnswer(new Uint8Array(await response.arrayBuffer())),
      value,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    return "inconclusive";
  }
}
