import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "runtime-config.sh",
);

function run(env) {
  const dir = mkdtempSync(path.join(tmpdir(), "orgs-ui-runtime-config-"));
  const outputPath = path.join(dir, "runtime-config.js");
  const childEnv = {
    ...process.env,
    VETCHIUM_RUNTIME_CONFIG_PATH: outputPath,
    ...env,
  };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  try {
    const result = spawnSync("sh", [scriptPath], {
      env: childEnv,
      encoding: "utf8",
    });
    return {
      status: result.status,
      stderr: result.stderr,
      outputExists: existsSync(outputPath),
      outputContents: existsSync(outputPath)
        ? readFileSync(outputPath, "utf8")
        : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function configFrom(outputContents) {
  const context = { globalThis: {} };
  vm.runInNewContext(outputContents, context);
  return context.globalThis.__VETCHIUM_CONFIG__;
}

test("defaults to en-US when VETCHIUM_DEFAULT_LANGUAGE is unset", () => {
  const result = run({ VETCHIUM_DEFAULT_LANGUAGE: undefined });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(configFrom(result.outputContents).defaultLanguage, "en-US");
});

for (const language of ["en-US", "ta", "de-DE"]) {
  test(`accepts the ${language} locale`, () => {
    const result = run({ VETCHIUM_DEFAULT_LANGUAGE: language });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(configFrom(result.outputContents).defaultLanguage, language);
  });
}

for (const language of ["fr-FR", "en", "de_DE", 'en-US"; alert(1); "']) {
  test(`rejects the unsupported locale ${JSON.stringify(language)}`, () => {
    const result = run({ VETCHIUM_DEFAULT_LANGUAGE: language });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VETCHIUM_DEFAULT_LANGUAGE/);
    assert.equal(result.outputExists, false);
  });
}

test("freezes the published configuration", () => {
  const result = run({ VETCHIUM_DEFAULT_LANGUAGE: "ta" });
  assert.equal(Object.isFrozen(configFrom(result.outputContents)), true);
});
