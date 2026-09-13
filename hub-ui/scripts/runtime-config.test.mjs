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
  const dir = mkdtempSync(path.join(tmpdir(), "hub-ui-runtime-config-"));
  const outputPath = path.join(dir, "runtime-config.js");
  try {
    const result = spawnSync("sh", [scriptPath], {
      env: { ...process.env, VETCHIUM_RUNTIME_CONFIG_PATH: outputPath, ...env },
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

const validEnv = {
  VETCHIUM_TENANT_ID: "sgp",
  VETCHIUM_HUB_PLANS: "hub-free-tier,hub-silver-tier",
};

test("rejects a missing VETCHIUM_TENANT_ID", () => {
  const env = { ...validEnv };
  delete env.VETCHIUM_TENANT_ID;
  const result = run(env);
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects an uppercase VETCHIUM_TENANT_ID", () => {
  const result = run({ ...validEnv, VETCHIUM_TENANT_ID: "SGP" });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a VETCHIUM_TENANT_ID containing a slash", () => {
  const result = run({ ...validEnv, VETCHIUM_TENANT_ID: "sg/p" });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a missing VETCHIUM_HUB_PLANS", () => {
  const env = { ...validEnv };
  delete env.VETCHIUM_HUB_PLANS;
  const result = run(env);
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects an empty item in VETCHIUM_HUB_PLANS", () => {
  const result = run({
    ...validEnv,
    VETCHIUM_HUB_PLANS: "hub-free-tier,,hub-silver-tier",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a leading comma in VETCHIUM_HUB_PLANS", () => {
  const result = run({
    ...validEnv,
    VETCHIUM_HUB_PLANS: ",hub-free-tier",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a trailing comma in VETCHIUM_HUB_PLANS", () => {
  const result = run({
    ...validEnv,
    VETCHIUM_HUB_PLANS: "hub-free-tier,",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects an unknown plan", () => {
  const result = run({ ...validEnv, VETCHIUM_HUB_PLANS: "hub-gold-tier" });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a duplicate plan", () => {
  const result = run({
    ...validEnv,
    VETCHIUM_HUB_PLANS: "hub-free-tier,hub-free-tier",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("rejects a plan list without hub-free-tier", () => {
  const result = run({ ...validEnv, VETCHIUM_HUB_PLANS: "hub-silver-tier" });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("still enforces the existing language check", () => {
  const result = run({ ...validEnv, VETCHIUM_DEFAULT_LANGUAGE: "fr-FR" });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputExists, false);
});

test("writes a frozen runtime config on success", () => {
  const result = run(validEnv);
  assert.equal(result.status, 0);
  assert.equal(result.outputExists, true);
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(result.outputContents, sandbox);
  const config = sandbox.__VETCHIUM_CONFIG__;
  assert.equal(config.defaultLanguage, "en-US");
  assert.equal(config.tenantId, "sgp");
  assert.deepEqual([...config.hubPlans], ["hub-free-tier", "hub-silver-tier"]);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.hubPlans), true);
});

test("accepts a single-plan tenant", () => {
  const result = run({
    VETCHIUM_TENANT_ID: "usa1",
    VETCHIUM_HUB_PLANS: "hub-free-tier",
  });
  assert.equal(result.status, 0);
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(result.outputContents, sandbox);
  assert.deepEqual(
    [...sandbox.__VETCHIUM_CONFIG__.hubPlans],
    ["hub-free-tier"],
  );
});
