import { expect, test } from "@playwright/test";
import { HUB_PORTAL } from "../lib/portals.ts";

// Profiles and Organization pages are sign-in-gated or placeholders, so the
// static Hub portal tells crawlers not to index them before any script runs.
for (const path of [
  "/u/x",
  "/u/perso000-00000000001",
  "/org/x",
  "/org/example.com",
]) {
  test(`the Hub portal serves ${path} with X-Robots-Tag noindex`, async ({
    request,
  }) => {
    const response = await request.get(`${HUB_PORTAL}${path}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["x-robots-tag"]).toBe("noindex");
  });
}

for (const path of ["/", "/login", "/signup", "/reset-password"]) {
  test(`the Hub portal serves ${path} without X-Robots-Tag`, async ({
    request,
  }) => {
    const response = await request.get(`${HUB_PORTAL}${path}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()).not.toHaveProperty("x-robots-tag");
  });
}
