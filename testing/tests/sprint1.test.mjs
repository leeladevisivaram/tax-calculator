import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { computeTax } from "../../src/tax-engine.mjs";
import { listSupportedPeriods } from "../../src/rulepack-loader.mjs";
import { buildServer } from "../../src/server.mjs";

const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

describe("Sprint 1 rule engine foundation", () => {
  for (const id of ["TV-001", "TV-002", "TV-003", "TV-004"]) {
    it(`passes ${id}`, async () => {
      const testVector = vector(id);
      const result = await computeTax(testVector.input);

      assert.equal(result.status, "ok");
      assert.equal(result.rulepack_version, testVector.rulepack_id);
      assert.ok(result.computation_hash);

      for (const assertion of testVector.expected.assertions) {
        if (assertion.operator !== "equals") continue;
        assert.equal(readPath(result, assertion.path), assertion.value, `${id} ${assertion.path}`);
      }

      for (const warning of testVector.expected.warnings) {
        assert.ok(result.warnings.includes(warning), `${id} expected warning ${warning}`);
      }
    });
  }

  it("lists active supported periods", async () => {
    const periods = await listSupportedPeriods();
    assert.deepEqual(
      periods.map((period) => period.rulepack_id),
      ["ay-2025-26-v1", "ay-2026-27-v1"]
    );
  });

  it("serves compute and period endpoints", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const periodsResponse = await fetch(`${baseUrl}/api/v1/rules/periods`);
      assert.equal(periodsResponse.status, 200);
      const periodsBody = await periodsResponse.json();
      assert.equal(periodsBody.periods.length, 2);

      const computeResponse = await fetch(`${baseUrl}/api/v1/tax/compute`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(vector("TV-001").input)
      });
      assert.equal(computeResponse.status, 200);
      const computeBody = await computeResponse.json();
      assert.equal(computeBody.summary.net_tax_liability, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

function readPath(value, path) {
  return path.split(".").reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, value);
}

