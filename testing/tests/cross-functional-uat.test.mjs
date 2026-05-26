import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { compareRegimes, computeTax } from "../../src/tax-engine.mjs";
import { previewImport } from "../../src/import-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

describe("Cross-Functional UAT: Test Data Variations", () => {
  it("covers income variations: zero, low, threshold, above-threshold, high, decimal, and negative", async () => {
    const zero = await computeTax(request({ income: { salary: { gross_salary: 0 } } }));
    const low = await computeTax(request({ income: { salary: { gross_salary: 300000 } } }));
    const threshold = await computeTax(request({ income: { salary: { gross_salary: 1275000 } } }));
    const justAbove = await computeTax(request({ income: { salary: { gross_salary: 1280000 } } }));
    const high = await computeTax(request({ income: { salary: { gross_salary: 5000000 } } }));
    const decimal = await computeTax(request({ income: { salary: { gross_salary: 1000000.75 } } }));
    const negative = validateTaxRequest(request({ income: { salary: { gross_salary: -1 } } }));

    assert.equal(zero.summary.net_tax_liability, 0);
    assert.equal(low.summary.net_tax_liability, 0);
    assert.equal(threshold.summary.net_tax_liability, 0);
    assert.ok(justAbove.summary.net_tax_liability > 0);
    assert.ok(high.summary.net_tax_liability > justAbove.summary.net_tax_liability);
    assert.equal(Number.isInteger(decimal.summary.refund_or_payable), true);
    assertValidation(negative, "VAL_SALARY_AMOUNT_NEGATIVE", "income.salary.gross_salary");
  });

  it("covers regime variations: old, new, compare regimes, and missing regime", async () => {
    const newRegime = await computeTax(request({ regime: "new", income: { salary: { gross_salary: 1275000 } } }));
    const oldRegime = await computeTax(request({
      regime: "old",
      income: { salary: { gross_salary: 900000 } },
      deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
    }));
    const comparison = await compareRegimes(request({ income: { salary: { gross_salary: 1275000 } } }));
    const missing = validateTaxRequest(request({ regime: "" }));

    assert.equal(newRegime.status, "ok");
    assert.equal(oldRegime.status, "ok");
    assert.equal(comparison.status, "ok");
    assert.ok(["old", "new"].includes(comparison.recommended_regime));
    assertValidation(missing, "VAL_REGIME_UNSUPPORTED", "regime");
  });

  it("covers taxpayer variations: individual, HUF, senior, super senior, and unsupported taxpayer", async () => {
    const individual = await computeTax(request({ taxpayer_type: "individual", income: { salary: { gross_salary: 650000 } } }));
    const huf = await computeTax(request({ taxpayer_type: "huf", regime: "old", income: { other_sources: [{ type: "interest", amount: 650000 }] } }));
    const senior = await computeTax(request({ regime: "old", age_years: 65, income: { salary: { gross_salary: 650000 } } }));
    const superSenior = await computeTax(request({ regime: "old", age_years: 82, income: { salary: { gross_salary: 650000 } } }));
    const unsupported = validateTaxRequest(request({ taxpayer_type: "company" }));

    assert.equal(individual.status, "ok");
    assert.equal(huf.status, "ok");
    assert.ok(senior.rule_trace.includes("slab.old.ay2026.individual.senior"));
    assert.ok(superSenior.rule_trace.includes("slab.old.ay2026.individual.super_senior"));
    assertValidation(unsupported, "VAL_TAXPAYER_TYPE_UNSUPPORTED", "taxpayer_type");
  });

  it("covers residency variations: resident, non-resident, and unsupported residency", async () => {
    const resident = await computeTax(request({ residency: "resident", income: { salary: { gross_salary: 900000 } } }));
    const nonResident = await computeTax(request({ residency: "non_resident", income: { salary: { gross_salary: 900000 } } }));
    const unsupported = validateTaxRequest(request({ residency: "ordinarily_resident_only" }));

    assert.equal(resident.status, "ok");
    assert.equal(nonResident.status, "ok");
    assertValidation(unsupported, "VAL_RESIDENCY_REQUIRED", "residency");
  });

  it("covers deduction variations: none, max, over-limit, and unavailable by regime", async () => {
    const none = await computeTax(request({ regime: "old", income: { salary: { gross_salary: 900000 } }, deductions: { standard_deduction: true } }));
    const max = await computeTax(request({
      regime: "old",
      income: { salary: { gross_salary: 900000 } },
      deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
    }));
    const overLimit = await computeTax(request({
      regime: "old",
      income: { salary: { gross_salary: 900000 } },
      deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 250000 }] }
    }));
    const unavailable = validateTaxRequest(request({
      regime: "new",
      deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
    }));

    assert.equal(none.summary.deductions["80C"], undefined);
    assert.equal(max.summary.deductions["80C"].allowed, 150000);
    assert.equal(overLimit.summary.deductions["80C"].allowed, 150000);
    assertValidation(unavailable, "WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME", "deductions.chapter_via");
  });

  it("covers capital-gains variations: 111A, 112A, 112, 50AA, date split, gain, loss, and missing date", async () => {
    const gains = await computeTax(request({
      income: {
        capital_gains: [
          { section: "111A", transfer_date: "2024-07-22", net_gain: 100000, stt_paid: true },
          { section: "111A", transfer_date: "2024-07-23", net_gain: 100000, stt_paid: true },
          { section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true },
          { section: "112", transfer_date: "2025-08-15", net_gain: 200000 },
          { section: "50AA", transfer_date: "2025-08-15", net_gain: 50000 },
          { section: "112A", transfer_date: "2025-08-15", net_gain: -50000, stt_paid: true }
        ]
      }
    }));
    const missingDate = validateTaxRequest(request({ income: { capital_gains: [{ section: "112A", net_gain: 300000 }] } }));

    assert.equal(gains.summary.capital_gains.find((item) => item.section === "111A" && item.transfer_date === "2024-07-22").classification, "short_term");
    assert.equal(gains.summary.special_rate_tax["112A"].taxable_gain, 175000);
    assert.equal(gains.summary.special_rate_tax["112"].taxable_gain, 200000);
    assert.equal(gains.summary.capital_gains.find((item) => item.section === "50AA").tax_rate_type, "applicable_rate");
    assert.equal(gains.summary.capital_gains.find((item) => item.net_gain === -50000).tax_rate_type, "loss_or_nil");
    assertValidation(missingDate, "VAL_CAPITAL_GAIN_TRANSFER_DATE_REQUIRED", "income.capital_gains[0].transfer_date");
  });

  it("covers presumptive variations: 44AD, 44ADA, 44AE, thresholds, cash <=5%, and cash >5%", async () => {
    const fortyFourAd = await computeTax(request({
      income: { business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }] }
    }));
    const fortyFourAda = await computeTax(request({
      income: { business_profession: [{ section: "44ADA", gross_receipts: 7000000, cash_receipts: 100000 }] }
    }));
    const fortyFourAe = await computeTax(request({
      income: { business_profession: [{ section: "44AE", vehicle_count: 2, months_owned: 9, monthly_deemed_income: 7500 }] }
    }));
    const threshold = await computeTax(request({
      income: { business_profession: [{ section: "44AD", turnover: 30000000, cash_receipts: 1500000, digital_receipts: 28500000 }] }
    }));
    const highCash = await computeTax(request({
      income: { business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 2000000, digital_receipts: 23000000 }] }
    }));
    const tooManyVehicles = validateTaxRequest(request({
      income: { business_profession: [{ section: "44AE", vehicle_count: 11 }] }
    }));

    assert.equal(fortyFourAd.summary.business_profession["44AD"].deemed_income, 1520000);
    assert.equal(fortyFourAda.summary.business_profession["44ADA"].deemed_income, 3500000);
    assert.equal(fortyFourAe.summary.business_profession["44AE"].deemed_income, 135000);
    assert.equal(threshold.summary.business_profession["44AD"].enhanced_threshold_available, true);
    assert.ok(highCash.warnings.includes("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE"));
    assertValidation(tooManyVehicles, "VAL_44AE_VEHICLE_LIMIT_EXCEEDED", "income.business_profession[0].vehicle_count");
  });

  it("covers credit variations: no credits, partial credits, full credits, and excess credits", async () => {
    const noCredits = await computeTax(request({ income: { salary: { gross_salary: 2000000 } }, tax_credits: {} }));
    const liability = noCredits.summary.net_tax_liability;
    const partial = await computeTax(request({ income: { salary: { gross_salary: 2000000 } }, tax_credits: { tds: Math.floor(liability / 2) } }));
    const full = await computeTax(request({ income: { salary: { gross_salary: 2000000 } }, tax_credits: { tds: liability } }));
    const excess = await computeTax(request({ income: { salary: { gross_salary: 2000000 } }, tax_credits: { tds: liability + 50000 } }));

    assert.ok(noCredits.summary.refund_or_payable > 0);
    assert.ok(partial.summary.refund_or_payable > 0);
    assert.equal(full.summary.refund_or_payable, 0);
    assert.ok(excess.summary.refund_or_payable < 0);
  });

  it("covers import variations: valid, invalid, empty, duplicate, ambiguous, and unsupported columns", async () => {
    const valid = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
    });
    const empty = await previewImport({ import_type: "form16", filename: "form16.csv", content: "" });
    const duplicate = await previewImport({
      import_type: "capital_gains",
      filename: "capital_gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,2025-08-15,300000,true,equity\n112A,2025-08-15,300000,true,equity"
    });
    const ambiguous = await previewImport({
      import_type: "capital_gains",
      filename: "capital_gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,2025-08-15,300000,true,crypto"
    });
    const unsupportedColumns = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,unknown_column\n900000,45000,ignored"
    });

    assert.equal(valid.status, "ok");
    await assert.rejects(
      () => previewImport({ import_type: "form16", filename: "form16.exe", content: "gross_salary\n900000" }),
      /Unsupported import file extension/
    );
    assert.equal(empty.status, "needs_review");
    assert.ok(empty.errors.includes("ERR_IMPORT_EMPTY_FILE"));
    assert.ok(duplicate.warnings.includes("WARN_IMPORT_ROW_3_DUPLICATE_ROW"));
    assert.ok(ambiguous.warnings.includes("WARN_IMPORT_ROW_2_AMBIGUOUS_ASSET_TYPE"));
    assert.deepEqual(unsupportedColumns.unknown_fields, ["unknown_column"]);
    assert.ok(unsupportedColumns.warnings.includes("WARN_IMPORT_UNKNOWN_FIELDS"));
  });
});

describe("Cross-Functional UAT: Recommended Priority Classification", () => {
  it("documents critical, high, medium, and low priority classifications with expected scope", async () => {
    const markdown = await readFile(new URL("../../docs/testing/UAT_TEST_CASES.md", import.meta.url), "utf8");

    assert.match(markdown, /\| Critical \| Tax calculation correctness, golden vectors, rulepack loading, source traceability, compute API, security blockers \|/);
    assert.match(markdown, /\| High \| Validation engine, result display, imports confirmation, reports, ITR recommendation \|/);
    assert.match(markdown, /\| Medium \| UI usability, draft save\/restore, language layout, warnings \|/);
    assert.match(markdown, /\| Low \| Cosmetic issues, minor formatting, non-blocking content improvements \|/);
  });
});

function request(overrides = {}) {
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

function assertValidation(report, code, fieldPath) {
  assert.ok(
    report.results.some((result) => result.code === code && result.field_path === fieldPath),
    `expected ${code} on ${fieldPath}; received ${JSON.stringify(report.results)}`
  );
}
