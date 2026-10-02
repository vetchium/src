import assert from "node:assert/strict";
import test from "node:test";
import {
  contentSecurityPolicy,
  nginxPortalInclude,
  staticHostHeaders,
} from "./security-headers.ts";

const policy = {
  connectSources: ["https://b.api.example.com", "https://a.api.example.com"],
  imageSources: ["https://media.a.example.com"],
  noindexPathPrefixes: ["/u/", "/org/"],
  strictTransportSecurity: false,
};

test("the policy lists every API and media origin", () => {
  const csp = contentSecurityPolicy(policy);
  assert.match(
    csp,
    /connect-src 'self' https:\/\/a\.api\.example\.com https:\/\/b\.api\.example\.com;/,
  );
  assert.match(csp, /img-src 'self' data: https:\/\/media\.a\.example\.com;/);
});

test("a source that is not an origin is rejected", () => {
  assert.throws(
    () =>
      contentSecurityPolicy({
        ...policy,
        connectSources: ["https://a.example.com/api"],
      }),
    /is not an origin/,
  );
  assert.throws(
    () => staticHostHeaders({ ...policy, noindexPathPrefixes: ["/u"] }),
    /single path segment/,
  );
});

test("both renderers mark only the noindex prefixes", () => {
  const headers = staticHostHeaders(policy);
  assert.match(headers, /^\/u\/\*\n {2}X-Robots-Tag: noindex$/m);
  assert.match(headers, /^\/org\/\*\n {2}X-Robots-Tag: noindex$/m);
  assert.equal(headers.match(/X-Robots-Tag/g)?.length, 2);

  const nginx = nginxPortalInclude(policy);
  assert.match(nginx, /location \/u\/ \{[^}]*X-Robots-Tag "noindex"/);
  assert.match(
    nginx,
    /location \/u\/ \{[^}]*try_files \$uri \/index\.html =404;/,
  );
  assert.match(nginx, /location \/org\/ \{[^}]*X-Robots-Tag "noindex"/);
  assert.equal(nginx.match(/X-Robots-Tag/g)?.length, 2);
});

test("every nginx location repeats the security headers", () => {
  const nginx = nginxPortalInclude(policy);
  const locations = nginx.match(/location [^{]+\{[^}]*\}/g) ?? [];
  assert.equal(locations.length, 4);
  for (const location of locations) {
    assert.match(location, /Content-Security-Policy/);
    assert.match(location, /X-Frame-Options/);
  }
});

test("only an HTTPS-only site sends Strict-Transport-Security", () => {
  assert.doesNotMatch(staticHostHeaders(policy), /Strict-Transport-Security/);
  assert.match(
    staticHostHeaders({ ...policy, strictTransportSecurity: true }),
    /^ {2}Strict-Transport-Security: max-age=31536000; includeSubDomains$/m,
  );
});
