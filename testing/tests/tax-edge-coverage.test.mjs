import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

describe("Feature: Tax edge coverage - final rupee outputs", () => {
  describe("Task: round final liability and payable amounts deterministically", () => {
    it("rounds a one-rupee 112A taxable gain into whole final rupee outputs", async () => {
      const result = await computeTax(baseRequest({
        income: {
          capital_gains: [{
            section: "112A",
            transfer_date: "2025-08-15",
            net_gain: 125001,
            stt_paid: true
          }]
        }
      }));

      assert.equal(result.summary.special_rate_tax["112A"].taxable_gain, 1);
      assert.equal(result.summary.net_tax_liability, 0);
      assert.equal(result.summary.refund_or_payable, 0);
      assert.equal(Number.isInteger(result.summary.net_tax_liability), true);
      assert.equal(Number.isInteger(result.summary.refund_or_payable), true);
    });

    it("keeps decimal salary inputs from leaking paise into final payable output", async () => {
      const result = await computeTax(baseRequest({
        income: { salary: { gross_salary: 1000000.75 } }
      }));

      assert.equal(Number.isInteger(result.summary.total_tax), true);
      assert.equal(Number.isInteger(result.summary.net_tax_liability), true);
      assert.equal(Number.isInteger(result.summary.refund_or_payable), true);
    });
  });
});

describe("Feature: Tax edge coverage - profile, deduction, and credit boundaries", () => {
  describe("Task: profile boundary values and standard deduction switches", () => {
    it("separates ordinary, senior, and super-senior old-regime slab traces at age boundaries", async () => {
      const ordinary = await computeTax(baseRequest({ regime: "old", age_years: 59, income: { salary: { gross_salary: 900000 } } }));
      const senior = await computeTax(baseRequest({ regime: "old", age_years: 60, income: { salary: { gross_salary: 900000 } } }));
      const superSenior = await computeTax(baseRequest({ regime: "old", age_years: 80, income: { salary: { gross_salary: 900000 } } }));

      assert.ok(ordinary.rule_trace.includes("slab.old.ay2026.individual.ordinary"));
      assert.ok(senior.rule_trace.includes("slab.old.ay2026.individual.senior"));
      assert.ok(superSenior.rule_trace.includes("slab.old.ay2026.individual.super_senior"));
      assert.ok(senior.summary.tax_before_rebate <= ordinary.summary.tax_before_rebate);
      assert.ok(superSenior.summary.tax_before_rebate <= senior.summary.tax_before_rebate);
    });

    it("changes total income when standard deduction is turned off", async () => {
      const withDeduction = await computeTax(baseRequest({
        deductions: { standard_deduction: true },
        income: { salary: { gross_salary: 1275000 } }
      }));
      const withoutDeduction = await computeTax(baseRequest({
        deductions: { standard_deduction: false },
        income: { salary: { gross_salary: 1275000 } }
      }));

      assert.equal(withDeduction.summary.total_income, 1200000);
      assert.equal(withoutDeduction.summary.total_income, 1275000);
      assert.ok(withoutDeduction.summary.net_tax_liability > withDeduction.summary.net_tax_liability);
    });
  });

  describe("Task: deduction and credit boundary combinations", () => {
    it("keeps 80D preventive health check-up inside the applicable bucket caps", async () => {
      const result = await computeTax(baseRequest({
        regime: "old",
        income: { salary: { gross_salary: 1200000 } },
        deductions: {
          standard_deduction: true,
          chapter_via: [
            { section: "80D", bucket: "self_family", premium: 24000, preventive_checkup: 3000, senior: false },
            { section: "80D", bucket: "parents", premium: 48000, preventive_checkup: 5000, senior: true }
          ]
        }
      }));

      assert.equal(result.summary.deductions["80D"].self_family_allowed, 25000);
      assert.equal(result.summary.deductions["80D"].parents_allowed, 50000);
      assert.equal(result.summary.deductions["80D"].total_allowed, 75000);
      assert.ok(result.warnings.includes("WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP"));
    });

    it("keeps manual TDS, TCS, advance tax, and self-assessment tax cumulative in refund math", async () => {
      const result = await computeTax(baseRequest({
        income: { salary: { gross_salary: 2000000 } },
        tax_credits: {
          tds: 50000,
          tcs: 25000,
          advance_tax: 30000,
          self_assessment_tax: 20000
        }
      }));

      assert.equal(result.summary.tax_credits, 125000);
      assert.equal(result.summary.refund_or_payable, result.summary.total_tax - 125000);
    });
  });
});

describe("Feature: Tax edge coverage - validation blockers and warnings", () => {
  describe("Task: validate unsupported or inconsistent profile choices", () => {
    it("reports tax-year rulepacks and act/year mismatches before compute", () => {
      const taxYear = validateTaxRequest(baseRequest({ period_type: "tax_year" }));
      const actMismatch = validateTaxRequest(baseRequest({ act: "Income-tax Act, 2025" }));

      assertValidation(taxYear, "VAL_TAX_YEAR_RULEPACK_NOT_ACTIVE", "period_type");
      assertValidation(actMismatch, "VAL_ACT_PERIOD_MISMATCH", "act");
    });
  });
});

function baseRequest(overrides = {}) {
  return deepMerge({
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true },
    tax_credits: {}
  }, overrides);
}

function deepMerge(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Array.isArray(value)) output[key] = value;
    else if (value && typeof value === "object") output[key] = deepMerge(output[key] ?? {}, value);
    else output[key] = value;
  }
  return output;
}

function assertValidation(report, code, fieldPath) {
  assert.ok(
    report.results.some((result) => result.code === code && result.field_path === fieldPath),
    `expected ${code} on ${fieldPath}; received ${JSON.stringify(report.results)}`
  );
}
