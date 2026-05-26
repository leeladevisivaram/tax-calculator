import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { computeTax } from "../../src/tax-engine.mjs";

const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

describe("Sprint 2 supported provision vectors", () => {
  for (const id of vectors.vectors.map((item) => item.id)) {
    it(`passes ${id}`, async () => {
      const testVector = vector(id);
      const result = await computeTax(testVector.input);

      assert.equal(result.status, "ok");
      if (testVector.rulepack_id && !testVector.input.cases) {
        assert.equal(result.rulepack_version, testVector.rulepack_id);
      }

      for (const assertion of testVector.expected.assertions) {
        assertGoldenAssertion(result, assertion, id);
      }

      for (const warning of testVector.expected.warnings) {
        assert.ok(result.warnings.includes(warning), `${id} expected warning ${warning}`);
      }
      assert.deepEqual(new Set(result.warnings), new Set(testVector.expected.warnings), `${id} warnings`);
    });
  }
});

function assertGoldenAssertion(result, assertion, id) {
  const actual = readPath(result, assertion.path);
  const label = `${id} ${assertion.path}`;

  if (assertion.operator === "equals") {
    assert.equal(actual, assertion.value, label);
    return;
  }

  if (assertion.operator === "caps_at") {
    assert.equal(actual, assertion.value, label);
    return;
  }

  if (assertion.operator === "disallowed") {
    assert.equal(actual, assertion.value, label);
    return;
  }

  if (assertion.operator === "warning_contains") {
    assert.equal(typeof actual, "string", `${label} should be a string`);
    assert.ok(actual.includes(assertion.value), `${label} should contain ${assertion.value}`);
    return;
  }

  if (assertion.operator === "chooses_lower_of") {
    const parent = readPath(result, assertion.path.split(".").slice(0, -1).join("."));
    const candidates = assertion.value.map((key) => parent[key]);
    assert.equal(actual, Math.min(...candidates), label);
    return;
  }

  throw new Error(`Unsupported assertion operator: ${assertion.operator}`);
}

function readPath(value, path) {
  if (!path) return value;
  return path.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    const match = segment.match(/^(.+)\[(\d+)\]$/);
    if (match) {
      return current[match[1]]?.[Number(match[2])];
    }
    return current[segment];
  }, value);
}
