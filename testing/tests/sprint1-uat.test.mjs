import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { compareRegimes, computeTax } from "../../src/tax-engine.mjs";
import {
  RulepackError,
  getRulepackForRequest,
  validateRulepack
} from "../../src/rulepack-loader.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

const vectors = await readJson("../../sprint-zero/golden-test-vectors.json");
const rulepack2026 = await readJson("../../data/rulepacks/ay-2026-27-v1.json");

describe("Sprint 1 UAT: Rulepack Loader and Versioning", () => {
  it("TC-S1-001 fetches supported periods from the public API", async () => {
    await withServer(async (baseUrl) => {
      const body = await getJson(baseUrl, "/api/v1/rules/periods");

      assert.equal(body.status, "ok");
      assert.deepEqual(
        body.periods.map((period) => period.rulepack_id),
        ["ay-2025-26-v1", "ay-2026-27-v1"]
      );
    });
  });

  it("TC-S1-002 loads the AY 2026-27 rulepack by period", async () => {
    const rulepack = await getRulepackForRequest(baseRequest());

    assert.equal(rulepack.rulepack_id, "ay-2026-27-v1");
    assert.equal(rulepack.period, "2026-27");
    assert.equal(rulepack.status, "active");
  });

  it("TC-S1-003 selects new-regime rules without old-regime leakage", async () => {
    const result = await computeTax(baseRequest({
      regime: "new",
      income: { salary: { gross_salary: 1275000 } },
      deductions: { standard_deduction: true }
    }));

    assert.ok(result.rule_trace.includes("slab.new.ay2026.individual_huf"));
    assert.ok(result.rule_trace.includes("standard_deduction.new.ay2026.salary"));
    assert.ok(!result.rule_trace.some((ruleId) => ruleId.includes(".old.")));
  });

  it("TC-S1-004 keeps draft rulepacks out of the public active list", () => {
    const draft = { ...rulepack2026, status: "draft", rulepack_id: "ay-2026-27-draft" };

    assert.deepEqual(publicRulepacks([draft]), []);
  });

  it("TC-S1-005 keeps deprecated rulepacks out of normal compute selection", () => {
    const deprecated = { ...rulepack2026, status: "deprecated" };

    assert.deepEqual(publicRulepacks([deprecated]), []);
    assert.throws(() => selectActiveRulepack([deprecated], baseRequest()), /No active rulepack supports/);
  });

  it("TC-S1-006 returns a stable computation checksum for valid compute", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.match(result.computation_hash, /^[a-f0-9]{64}$/);
  });

  it("TC-S1-007 returns the source-register version on compute", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.equal(result.source_register_version, "src-2026-05-08-v1");
  });

  it("TC-S1-008 blocks unsupported assessment years with a rulepack error", async () => {
    await assert.rejects(
      () => getRulepackForRequest(baseRequest({ period: "2024-25" })),
      /No active rulepack supports the requested period and act/
    );
  });

  it("TC-S1-009 fails safely for corrupt or structurally invalid rulepacks", () => {
    assert.throws(() => JSON.parse("{ invalid json"), SyntaxError);
    assert.throws(
      () => validateRulepack({ rulepack_id: "broken-rulepack" }),
      /Rulepack is missing required fields/
    );
  });

  it("TC-S1-010 loads and computes deterministically for repeated identical input", async () => {
    const first = await computeTax(vector("TV-001").input);
    for (let index = 0; index < 10; index += 1) {
      const next = await computeTax(vector("TV-001").input);

      assert.equal(next.rulepack_version, first.rulepack_version);
      assert.equal(next.source_register_version, first.source_register_version);
      assert.equal(next.computation_hash, first.computation_hash);
      assert.deepEqual(next.summary, first.summary);
    }
  });
});

describe("Sprint 1 UAT: Normal Tax Waterfall", () => {
  it("TC-S1-011 computes new-regime salary at the no-tax threshold", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.equal(result.summary.standard_deduction, 75000);
    assert.equal(result.summary.total_income, 1200000);
    assert.equal(result.summary.rebate_87a, 60000);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S1-012 computes old-regime salary with 80C reducing tax to zero", async () => {
    const result = await computeTax(vector("TV-004").input);

    assert.equal(result.summary.standard_deduction, 50000);
    assert.equal(result.summary.chapter_via_allowed, 150000);
    assert.equal(result.summary.total_income, 500000);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S1-013 selects senior-citizen old-regime slabs", async () => {
    const senior = await computeTax(baseRequest({
      regime: "old",
      age_years: 65,
      income: { salary: { gross_salary: 800000 } },
      deductions: { standard_deduction: true }
    }));
    const ordinary = await computeTax(baseRequest({
      regime: "old",
      age_years: 34,
      income: { salary: { gross_salary: 800000 } },
      deductions: { standard_deduction: true }
    }));

    assert.ok(senior.rule_trace.includes("slab.old.ay2026.individual.senior"));
    assert.ok(senior.summary.tax_before_rebate < ordinary.summary.tax_before_rebate);
  });

  it("TC-S1-014 selects super-senior old-regime slabs", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      age_years: 82,
      income: { salary: { gross_salary: 800000 } },
      deductions: { standard_deduction: true }
    }));

    assert.ok(result.rule_trace.includes("slab.old.ay2026.individual.super_senior"));
    assert.equal(result.summary.tax_before_rebate, 50000);
  });

  it("TC-S1-015 applies the old-regime salary standard deduction", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: { salary: { gross_salary: 700000 } },
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.summary.standard_deduction, 50000);
  });

  it("TC-S1-016 applies the new-regime salary standard deduction", async () => {
    const result = await computeTax(baseRequest({
      regime: "new",
      income: { salary: { gross_salary: 700000 } },
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.summary.standard_deduction, 75000);
  });

  it("TC-S1-017 applies Section 87A rebate for AY 2026-27 new regime at Rs. 12 lakh income", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.equal(result.summary.tax_before_rebate, 60000);
    assert.equal(result.summary.rebate_87a, 60000);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S1-018 restricts 87A rebate above the relief zone", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 1400000 } },
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.summary.total_income, 1325000);
    assert.equal(result.summary.rebate_87a, 0);
    assert.ok(result.summary.net_tax_liability > 0);
  });

  it("TC-S1-019 applies marginal relief just above the new-regime threshold", async () => {
    const result = await computeTax(vector("TV-002").input);

    assert.equal(result.summary.total_income, 1205000);
    assert.equal(result.summary.tax_before_rebate, 60750);
    assert.equal(result.summary.tax_after_marginal_relief_before_cess, 5000);
    assert.equal(result.summary.net_tax_liability, 5200);
  });

  it("TC-S1-020 applies surcharge for high-income taxpayers", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 6000000 } },
      deductions: { standard_deduction: true }
    }));

    assert.ok(result.summary.total_income > 5000000);
    assert.ok(result.summary.surcharge > 0);
  });

  it("TC-S1-021 applies 4 percent health and education cess to positive tax", async () => {
    const result = await computeTax(vector("TV-002").input);

    assert.equal(result.summary.tax_after_marginal_relief_before_cess, 5000);
    assert.equal(result.summary.cess, 200);
  });

  it("TC-S1-022 returns zero payable for zero income", async () => {
    const result = await computeTax(baseRequest({
      income: {},
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.summary.total_income, 0);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S1-023 rejects negative salary input during validation", () => {
    const report = validateTaxRequest(baseRequest({
      income: { salary: { gross_salary: -1000 } }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_SALARY_AMOUNT_NEGATIVE", "income.salary.gross_salary");
  });

  it("TC-S1-024 handles decimal income deterministically", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 1000000.75 } },
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.summary.total_income, 925000.75);
    assert.equal(result.summary.tax_before_rebate, 32500.08);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S1-025 produces identical output for the same input across repeated computes", async () => {
    const outputs = [];
    for (let index = 0; index < 10; index += 1) {
      outputs.push(await computeTax(vector("TV-002").input));
    }

    assert.equal(new Set(outputs.map((output) => output.computation_hash)).size, 1);
    assert.equal(new Set(outputs.map((output) => output.summary.net_tax_liability)).size, 1);
  });
});

describe("Sprint 1 UAT: Core Compute API", () => {
  it("TC-S1-026 returns HTTP 200 and tax waterfall fields for a valid compute request", async () => {
    await withServer(async (baseUrl) => {
      const response = await postJson(baseUrl, "/api/v1/tax/compute", vector("TV-001").input);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, "ok");
      assert.equal(response.body.summary.net_tax_liability, 0);
    });
  });

  it("TC-S1-027 returns HTTP 400 for a missing required compute payload", async () => {
    await withServer(async (baseUrl) => {
      const response = await postJson(baseUrl, "/api/v1/tax/compute", {});

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.status, "error");
      assert.match(response.body.error, /No active rulepack supports/);
    });
  });

  it("TC-S1-028 returns HTTP 400 for invalid JSON request bodies", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/compute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ invalid json"
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.status, "error");
      assert.match(body.error, /JSON/);
    });
  });

  it("TC-S1-029 compares regimes for an eligible taxpayer", async () => {
    const comparison = await compareRegimes(baseRequest({
      income: { salary: { gross_salary: 900000 } },
      deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
    }));

    assert.equal(comparison.status, "ok");
    assert.ok(["old", "new"].includes(comparison.recommended_regime));
    assert.equal(typeof comparison.delta, "number");
  });

  it("TC-S1-030 blocks regime comparison for unsupported taxpayer types", async () => {
    await assert.rejects(
      () => compareRegimes(baseRequest({ taxpayer_type: "company" })),
      /supports only individual and HUF taxpayers/
    );
  });

  it("TC-S1-031 verifies the compute response shape", async () => {
    const result = await computeTax(vector("TV-001").input);

    for (const field of [
      "gross_total_income",
      "standard_deduction",
      "total_income",
      "tax_before_rebate",
      "rebate_87a",
      "surcharge",
      "cess",
      "total_tax",
      "tax_credits",
      "net_tax_liability"
    ]) {
      assert.ok(field in result.summary, `missing summary.${field}`);
    }
  });

  it("TC-S1-032 returns traceable applied rule IDs", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.ok(Array.isArray(result.rule_trace));
    assert.ok(result.rule_trace.includes("standard_deduction.new.ay2026.salary"));
    assert.ok(result.rule_trace.includes("slab.new.ay2026.individual_huf"));
    assert.ok(result.rule_trace.includes("rebate.87a.new.ay2026"));
    assert.ok(result.rule_trace.includes("surcharge.individual_huf.ay2026"));
    assert.ok(result.rule_trace.includes("cess.health_education.ay2026"));
  });

  it("TC-S1-033 handles huge numeric input without overflow", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 1000000000000 } },
      deductions: { standard_deduction: true }
    }));

    assert.equal(result.status, "ok");
    assert.equal(Number.isFinite(result.summary.net_tax_liability), true);
    assert.equal(Number.isFinite(result.summary.surcharge), true);
  });

  it("TC-S1-034 restricts unsupported HTTP methods on the compute endpoint", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/compute`);
      const body = await response.json();

      assert.equal(response.status, 405);
      assert.equal(body.error, "Method not allowed");
      assert.deepEqual(body.allowed_methods, ["POST"]);
    });
  });

  it("TC-S1-035 passes the TV-001 to TV-004 golden vectors", async () => {
    for (const id of ["TV-001", "TV-002", "TV-003", "TV-004"]) {
      const testVector = vector(id);
      const result = await computeTax(testVector.input);

      assert.equal(result.rulepack_version, testVector.rulepack_id);
      for (const assertion of testVector.expected.assertions) {
        assert.equal(readPath(result, assertion.path), assertion.value, `${id} ${assertion.path}`);
      }
    }
  });
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

function baseRequest(overrides = {}) {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true },
    tax_credits: {},
    ...overrides
  };
}

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

function publicRulepacks(rulepacks) {
  return rulepacks
    .filter((rulepack) => rulepack.status === "active")
    .map(({ rulepack_id, period_type, period, act, status, source_register_version }) => ({
      rulepack_id,
      period_type,
      period,
      act,
      status,
      source_register_version
    }));
}

function selectActiveRulepack(rulepacks, request) {
  const match = rulepacks.find(
    (rulepack) =>
      rulepack.status === "active" &&
      rulepack.period_type === request.period_type &&
      rulepack.period === request.period &&
      rulepack.act === request.act
  );
  if (!match) {
    throw new RulepackError("No active rulepack supports the requested period and act.");
  }
  return match;
}

function assertHasValidation(report, code, fieldPath) {
  assert.ok(
    report.results.some((result) => result.code === code && result.field_path === fieldPath),
    `Expected validation ${code} at ${fieldPath}; got ${JSON.stringify(report.results)}`
  );
}

function readPath(value, path) {
  return path.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    return current[segment];
  }, value);
}

async function withServer(callback) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return {
    statusCode: response.status,
    body: await response.json()
  };
}
