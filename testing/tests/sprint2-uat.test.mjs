import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

const vectors = await readJson("../../sprint-zero/golden-test-vectors.json");

describe("Sprint 2 UAT: Salary, HRA, LTA, and House Property", () => {
  it("TC-S2-001 computes gross salary from basic and eligible allowance components", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: {
        salary: {
          basic_salary: 500000,
          dearness_allowance_retirement_benefit: 50000,
          turnover_commission: 100000
        }
      }
    }));

    assert.equal(result.summary.salary.salary_for_hra, 650000);
    assert.equal(result.summary.salary.gross_salary, 650000);
    assert.equal(result.summary.salary.taxable_salary, 650000);
  });

  it("TC-S2-002 applies the old-regime metro HRA least-of formula", async () => {
    const result = await computeTax(vector("TV-015").input);

    assert.equal(result.summary.exemptions.hra.actual_hra, 300000);
    assert.equal(result.summary.exemptions.hra.rent_minus_10_percent_salary, 180000);
    assert.equal(result.summary.exemptions.hra.metro_salary_percent, 300000);
    assert.equal(result.summary.exemptions.hra.allowed, 180000);
  });

  it("TC-S2-003 applies the non-metro 40 percent HRA salary condition", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: {
        salary: {
          basic_salary: 600000,
          hra_received: 300000,
          rent_paid: 300000,
          metro_city: false
        }
      }
    }));

    assert.equal(result.summary.exemptions.hra.metro_salary_percent, 240000);
    assert.equal(result.summary.exemptions.hra.allowed, 240000);
  });

  it("TC-S2-004 blocks an old-regime HRA claim when rent is missing", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      income: {
        salary: {
          basic_salary: 600000,
          hra_received: 120000,
          rent_paid: 0
        }
      }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_HRA_RENT_REQUIRED", "blocker", "income.salary.rent_paid");
  });

  it("TC-S2-005 disallows HRA exemption under the new regime", async () => {
    const result = await computeTax(vector("TV-016").input);

    assert.equal(result.summary.exemptions.hra.allowed, 0);
    assert.equal(result.validation.hra_new_regime, true);
    assert.ok(result.warnings.includes("WARN_HRA_NOT_AVAILABLE_NEW_REGIME"));
  });

  it("TC-S2-006 warns when annual rent crosses the landlord PAN threshold", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      income: {
        salary: {
          basic_salary: 700000,
          hra_received: 180000,
          rent_paid: 120000
        }
      }
    }));

    assertHasValidation(report, "WARN_LANDLORD_PAN_MAY_BE_REQUIRED", "warning", "income.salary.rent_paid");
  });

  it("TC-S2-007 allows a valid LTA claim up to the lower of allowance received and claimed amount", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: { salary: { gross_salary: 800000, lta_received: 80000 } },
      claims: {
        lta: {
          journeys_already_claimed_in_block: 1,
          current_claim_amount: 65000
        }
      }
    }));

    assert.equal(result.summary.exemptions.lta.claimed, 65000);
    assert.equal(result.summary.exemptions.lta.allowed, 65000);
  });

  it("TC-S2-008 blocks LTA once the journey block is exhausted", async () => {
    const result = await computeTax(vector("TV-017").input);

    assert.equal(result.summary.exemptions.lta.allowed, 0);
    assert.equal(result.validation.lta_block_limit, true);
    assert.ok(result.warnings.includes("WARN_LTA_BLOCK_LIMIT_EXCEEDED"));
  });

  it("TC-S2-009 caps self-occupied house-property interest at Rs. 2 lakh", async () => {
    const result = await computeTax(vector("TV-018").input);

    assert.equal(result.summary.house_property[0].interest_allowed, 200000);
    assert.equal(result.summary.house_property[0].income_from_house_property, -200000);
  });

  it("TC-S2-010 caps let-out house-property loss set-off in the old regime", async () => {
    const result = await computeTax(vector("TV-019").input);

    assert.equal(result.summary.house_property_loss_setoff_against_other_heads, 200000);
    assert.equal(result.summary.house_property_loss_carry_forward, 100000);
  });

  it("TC-S2-011 blocks let-out loss set-off under the new regime", async () => {
    const result = await computeTax(vector("TV-020").input);

    assert.equal(result.summary.house_property_loss_setoff_against_other_heads, 0);
    assert.ok(result.warnings.includes("WARN_HOUSE_PROPERTY_LOSS_SET_OFF_NOT_AVAILABLE_NEW_REGIME"));
  });

  it("TC-S2-012 segregates self-occupied and let-out house-property treatments", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: {
        house_property: [
          { property_type: "self_occupied", interest_paid: 280000 },
          { property_type: "let_out", computed_loss: 300000 }
        ]
      }
    }));

    assert.equal(result.summary.house_property.length, 2);
    assert.equal(result.summary.house_property[0].interest_allowed, 200000);
    assert.equal(result.summary.house_property[1].loss_setoff_against_other_heads, 200000);
    assert.equal(result.summary.house_property_loss_carry_forward, 100000);
  });

  it("TC-S2-013 keeps TV-015 to TV-020 salary and house-property golden vectors passing", async () => {
    for (const id of ["TV-015", "TV-016", "TV-017", "TV-018", "TV-019", "TV-020"]) {
      await assertGoldenVector(id);
    }
  });
});

describe("Sprint 2 UAT: Chapter VI-A Deduction Engine", () => {
  it("TC-S2-014 caps an 80C claim at Rs. 1.5 lakh", async () => {
    const result = await computeTax(vector("TV-021").input);

    assert.equal(result.summary.deductions["80C"].allowed, 150000);
    assert.ok(result.warnings.includes("WARN_80C_CAP_APPLIED"));
  });

  it("TC-S2-015 enforces the combined 80C, 80CCC, and 80CCD(1) cap", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: {
        chapter_via: [
          { section: "80C", amount: 100000 },
          { section: "80CCC", amount: 40000 },
          { section: "80CCD(1)", amount: 60000 }
        ]
      }
    }));

    assert.equal(result.summary.deductions["80C"].claimed, 200000);
    assert.equal(result.summary.deductions["80C"].allowed, 150000);
    assert.equal(result.summary.chapter_via_allowed, 150000);
    assert.ok(result.warnings.includes("WARN_80C_CAP_APPLIED"));
  });

  it("TC-S2-016 allows the additional 80CCD(1B) NPS deduction up to Rs. 50,000", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: { chapter_via: [{ section: "80CCD(1B)", amount: 75000 }] }
    }));

    assert.equal(result.summary.deductions["80CCD(1B)"].claimed, 75000);
    assert.equal(result.summary.deductions["80CCD(1B)"].allowed, 50000);
  });

  it("TC-S2-017 caps 80CCD(2) employer contribution by eligible salary percentage", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: {
        chapter_via: [
          {
            section: "80CCD(2)",
            employer_contribution: 120000,
            eligible_salary: 1000000,
            employer_type: "private"
          }
        ]
      }
    }));

    assert.equal(result.summary.deductions["80CCD(2)"].cap, 100000);
    assert.equal(result.summary.deductions["80CCD(2)"].allowed, 100000);
  });

  it("TC-S2-018 enforces the 80D self/family bucket cap", async () => {
    const result = await computeTax(vector("TV-022").input);

    assert.equal(result.summary.deductions["80D"].self_family_allowed, 25000);
  });

  it("TC-S2-019 enforces the 80D senior-parent bucket cap", async () => {
    const result = await computeTax(vector("TV-022").input);

    assert.equal(result.summary.deductions["80D"].parents_allowed, 50000);
    assert.equal(result.summary.deductions["80D"].total_allowed, 75000);
  });

  it("TC-S2-020 applies the 80DD severe-disability flat deduction", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: { chapter_via: [{ section: "80DD", disability_severity: "severe" }] }
    }));

    assert.equal(result.summary.deductions["80DD"].allowed, 125000);
  });

  it("TC-S2-021 applies the 80DDB age-based cap after reimbursement", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: {
        chapter_via: [
          {
            section: "80DDB",
            senior: true,
            medical_treatment_paid: 120000,
            reimbursement: 10000
          }
        ]
      }
    }));

    assert.equal(result.summary.deductions["80DDB"].cap, 100000);
    assert.equal(result.summary.deductions["80DDB"].allowed, 100000);
  });

  it("TC-S2-022 allows full eligible 80E education-loan interest", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: { chapter_via: [{ section: "80E", interest_paid: 180000 }] }
    }));

    assert.equal(result.summary.deductions["80E"].allowed, 180000);
  });

  it("TC-S2-023 blocks simultaneous 80EE and 80EEA claims", () => {
    const report = validateTaxRequest(vector("TV-025").input);

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "WARN_80EE_80EEA_MUTUAL_EXCLUSION", "blocker", "deductions.chapter_via");
  });

  it("TC-S2-024 applies the 80GG least-of formula", async () => {
    const result = await computeTax(vector("TV-023").input);

    assert.equal(result.summary.deductions["80GG"].rent_minus_10_percent_total_income, 120000);
    assert.equal(result.summary.deductions["80GG"].monthly_cap, 60000);
    assert.equal(result.summary.deductions["80GG"].allowed, 60000);
  });

  it("TC-S2-025 caps non-senior 80TTA savings-interest deduction", async () => {
    const result = await computeTax(vector("TV-024").input);

    assert.equal(result.cases.non_senior.summary.deductions["80TTA"].allowed, 10000);
  });

  it("TC-S2-026 caps resident senior 80TTB deduction", async () => {
    const result = await computeTax(vector("TV-024").input);

    assert.equal(result.cases.senior.summary.deductions["80TTB"].allowed, 50000);
  });

  it("TC-S2-027 blocks 80TTB for a non-resident senior", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      residency: "non_resident",
      age_years: 70,
      deductions: { chapter_via: [{ section: "80TTB", amount: 50000 }] }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_80TTB_RESIDENT_SENIOR_REQUIRED", "blocker", "deductions.chapter_via[0]");
  });

  it("TC-S2-028 restricts 80G cash donations above Rs. 2,000", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      deductions: { chapter_via: [{ section: "80G", amount: 5000, payment_mode: "cash" }] }
    }));

    assert.equal(result.summary.deductions["80G"].allowed, 0);
    assert.equal(result.validation["80G_cash_limit_applied"], true);
    assert.ok(result.warnings.includes("WARN_80G_CASH_LIMIT_APPLIED"));
  });

  it("TC-S2-029 ignores unavailable Chapter VI-A deductions under the new regime", async () => {
    const result = await computeTax(baseRequest({
      regime: "new",
      deductions: { chapter_via: [{ section: "80C", amount: 150000 }] }
    }));

    assert.equal(result.summary.chapter_via_allowed, 0);
    assert.ok(result.warnings.includes("WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME"));
  });

  it("TC-S2-030 keeps TV-021 to TV-025 deduction golden vectors passing", async () => {
    for (const id of ["TV-021", "TV-022", "TV-023", "TV-024", "TV-025"]) {
      await assertGoldenVector(id);
    }
  });
});

describe("Sprint 2 UAT: Capital Gains Engine", () => {
  it("TC-S2-031 applies the 111A pre-split 15 percent rate", async () => {
    const result = await computeTax(vector("TV-007").input);

    assert.equal(result.summary.special_rate_tax["111A"].rate, 0.15);
    assert.equal(result.summary.special_rate_tax["111A"].tax_before_cess, 30000);
  });

  it("TC-S2-032 applies the 111A post-split 20 percent rate", async () => {
    const result = await computeTax(vector("TV-006").input);

    assert.equal(result.summary.special_rate_tax["111A"].rate, 0.2);
    assert.equal(result.summary.special_rate_tax["111A"].tax_before_cess, 40000);
  });

  it("TC-S2-033 applies the 112A pre-split threshold and review warning", async () => {
    const result = await computeTax(vector("TV-009").input);

    assert.equal(result.summary.special_rate_tax["112A"].rate, 0.1);
    assert.equal(result.summary.special_rate_tax["112A"].exemption_threshold, 100000);
    assert.equal(result.summary.special_rate_tax["112A"].tax_before_cess, 20000);
    assert.ok(result.warnings.includes("WARN_112A_PRE_2024_07_23_THRESHOLD_REVIEW"));
  });

  it("TC-S2-034 applies the 112A post-split threshold and 12.5 percent rate", async () => {
    const result = await computeTax(vector("TV-008").input);

    assert.equal(result.summary.special_rate_tax["112A"].exemption_threshold, 125000);
    assert.equal(result.summary.special_rate_tax["112A"].tax_before_cess, 21875);
  });

  it("TC-S2-035 applies the general 112 LTCG 12.5 percent rate after the split date", async () => {
    const result = await computeTax(vector("TV-010").input);

    assert.equal(result.summary.special_rate_tax["112"].rate, 0.125);
    assert.equal(result.summary.special_rate_tax["112"].tax_before_cess, 50000);
  });

  it("TC-S2-036 chooses the lower land/building 112 tax method", async () => {
    const result = await computeTax(vector("TV-011").input);

    assert.equal(result.summary.special_rate_tax["112"].new_law_tax, 100000);
    assert.equal(result.summary.special_rate_tax["112"].old_law_indexed_tax, 100000);
    assert.equal(result.summary.special_rate_tax["112"].final_tax_before_cess, 100000);
  });

  it("TC-S2-037 classifies Section 50AA gains as short-term applicable-rate gains", async () => {
    const result = await computeTax(vector("TV-012").input);

    assert.equal(result.summary.capital_gains[0].classification, "short_term");
    assert.equal(result.summary.capital_gains[0].tax_rate_type, "applicable_rate");
  });

  it("TC-S2-038 applies resident basic-exemption adjustment to eligible special-rate gains", async () => {
    const result = await computeTax(vector("TV-013").input);

    assert.equal(result.summary.basic_exemption_adjustment.applied, true);
    assert.equal(result.summary.basic_exemption_adjustment.available_amount, 150000);
    assert.equal(result.summary.special_rate_tax["111A"].taxable_after_basic_exemption_adjustment, 50000);
  });

  it("TC-S2-039 does not apply basic-exemption adjustment to non-resident special gains", async () => {
    const result = await computeTax(vector("TV-014").input);

    assert.equal(result.summary.basic_exemption_adjustment.applied, false);
    assert.ok(result.warnings.includes("WARN_BASIC_EXEMPTION_ADJUSTMENT_NOT_AVAILABLE"));
  });

  it("TC-S2-040 blocks a positive capital-gain row with no sale date", () => {
    const report = validateTaxRequest(baseRequest({
      income: { capital_gains: [{ section: "112A", net_gain: 300000 }] }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_CAPITAL_GAIN_TRANSFER_DATE_REQUIRED", "blocker", "income.capital_gains[0].transfer_date");
  });

  it("TC-S2-041 blocks an acquisition date after the sale date", () => {
    const report = validateTaxRequest(baseRequest({
      income: {
        capital_gains: [
          {
            section: "112",
            acquisition_date: "2025-09-01",
            transfer_date: "2025-08-15",
            net_gain: 100000
          }
        ]
      }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_CAPITAL_GAIN_DATE_ORDER", "blocker", "income.capital_gains[0].acquisition_date");
  });

  it("TC-S2-042 returns zero 112A tax when the gain exactly equals the threshold", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: { capital_gains: [{ section: "112A", transfer_date: "2024-07-23", net_gain: 125000 }] }
    }));

    assert.equal(result.summary.special_rate_tax["112A"].taxable_gain, 0);
    assert.equal(result.summary.special_rate_tax["112A"].tax_before_cess, 0);
  });

  it("TC-S2-043 records a loss transaction without producing negative tax", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      income: { capital_gains: [{ section: "112A", transfer_date: "2024-07-23", net_gain: -50000 }] }
    }));

    assert.equal(result.summary.capital_gains[0].tax_rate_type, "loss_or_nil");
    assert.equal(result.summary.gross_total_income, 0);
    assert.equal(result.summary.net_tax_liability, 0);
  });

  it("TC-S2-044 keeps TV-005 to TV-014 capital-gains golden vectors passing", async () => {
    for (const id of ["TV-005", "TV-006", "TV-007", "TV-008", "TV-009", "TV-010", "TV-011", "TV-012", "TV-013", "TV-014"]) {
      await assertGoldenVector(id);
    }
  });
});

describe("Sprint 2 UAT: Business, Presumptive Tax, and Audit Checks", () => {
  it("TC-S2-045 applies the 44AD enhanced threshold for low-cash receipts", async () => {
    const result = await computeTax(vector("TV-026").input);

    assert.equal(result.summary.business_profession["44AD"].enhanced_threshold_available, true);
    assert.equal(result.summary.business_profession["44AD"].deemed_income, 1520000);
  });

  it("TC-S2-046 warns when 44AD cash receipts breach the enhanced-threshold condition", async () => {
    const result = await computeTax(vector("TV-027").input);

    assert.equal(result.summary.business_profession["44AD"].enhanced_threshold_available, false);
    assert.ok(result.warnings.includes("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE"));
  });

  it("TC-S2-047 applies separate 44AD digital and cash receipt rates", async () => {
    const result = await computeTax(baseRequest({
      income: {
        business_profession: [
          {
            section: "44AD",
            turnover: 10000000,
            digital_receipts: 8000000,
            cash_receipts: 2000000
          }
        ]
      }
    }));

    assert.equal(result.summary.business_profession["44AD"].deemed_income, 640000);
  });

  it("TC-S2-048 applies the 44ADA enhanced threshold where cash is within 5 percent", async () => {
    const result = await computeTax(vector("TV-028").input);

    assert.equal(result.summary.business_profession["44ADA"].enhanced_threshold_available, true);
    assert.equal(result.summary.business_profession["44ADA"].deemed_income, 3500000);
  });

  it("TC-S2-049 warns when 44ADA cash receipts breach the enhanced-threshold condition", async () => {
    const result = await computeTax(vector("TV-029").input);

    assert.equal(result.summary.business_profession["44ADA"].enhanced_threshold_available, false);
    assert.ok(result.warnings.includes("WARN_44ADA_ENHANCED_THRESHOLD_UNAVAILABLE"));
  });

  it("TC-S2-050 computes 44AE deemed income by vehicle and month", async () => {
    const result = await computeTax(baseRequest({
      income: {
        business_profession: [
          {
            section: "44AE",
            vehicles: [
              { months_owned: 12 },
              { months_owned: 6 }
            ]
          }
        ]
      }
    }));

    assert.equal(result.summary.business_profession["44AE"].vehicle_count, 2);
    assert.equal(result.summary.business_profession["44AE"].deemed_income, 135000);
  });

  it("TC-S2-051 blocks 44AE when vehicle count exceeds ten", () => {
    const report = validateTaxRequest(baseRequest({
      income: { business_profession: [{ section: "44AE", vehicle_count: 11 }] }
    }));

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_44AE_VEHICLE_LIMIT_EXCEEDED", "blocker", "income.business_profession[0].vehicle_count");
  });

  it("TC-S2-052 warns when declared income is lower than presumptive 44AD income", () => {
    const report = validateTaxRequest(baseRequest({
      income: {
        business_profession: [
          {
            section: "44AD",
            turnover: 10000000,
            digital_receipts: 10000000,
            cash_receipts: 0,
            declared_income: 500000
          }
        ]
      }
    }));

    assertHasValidation(report, "WARN_PRESUMPTIVE_LOWER_INCOME_AUDIT_REVIEW", "warning", "income.business_profession[0].declared_income");
  });

  it("TC-S2-053 applies the presumptive advance-tax schedule", async () => {
    const result = await computeTax(vector("TV-030").input);

    assert.equal(result.cases.presumptive.validation.advance_tax_schedule, "single_100_percent_by_15_march");
  });

  it("TC-S2-054 handles 44AD turnover exactly at threshold boundaries", async () => {
    const standard = await computeTax(baseRequest({
      income: { business_profession: [{ section: "44AD", turnover: 20000000, cash_receipts: 2000000, digital_receipts: 18000000 }] }
    }));
    const enhanced = await computeTax(baseRequest({
      income: { business_profession: [{ section: "44AD", turnover: 30000000, cash_receipts: 1500000, digital_receipts: 28500000 }] }
    }));

    assert.equal(standard.summary.business_profession["44AD"].standard_threshold_available, true);
    assert.equal(standard.summary.business_profession["44AD"].eligible_under_turnover_limit, true);
    assert.equal(enhanced.summary.business_profession["44AD"].enhanced_threshold_available, true);
    assert.equal(enhanced.summary.business_profession["44AD"].eligible_under_turnover_limit, true);
    assert.ok(!standard.warnings.includes("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE"));
    assert.ok(!enhanced.warnings.includes("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE"));
  });

  it("TC-S2-055 keeps TV-026 to TV-030 business golden vectors passing", async () => {
    for (const id of ["TV-026", "TV-027", "TV-028", "TV-029", "TV-030"]) {
      await assertGoldenVector(id);
    }
  });
});

describe("Sprint 2 UAT: Credits, Interest, Late Fee, and ITR Recommendation", () => {
  it("TC-S2-056 subtracts TDS credits from the computed payable amount", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 1400000 } },
      tax_credits: { tds: 20000 }
    }));

    assert.equal(result.summary.tax_credits, 20000);
    assert.equal(result.summary.net_tax_liability, result.summary.total_tax - 20000);
  });

  it("TC-S2-057 shows a refund position when credits exceed tax", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 1400000 } },
      tax_credits: { tds: 100000 }
    }));

    assert.equal(result.summary.net_tax_liability, 0);
    assert.equal(result.summary.refund_or_payable, -18100);
  });

  it("TC-S2-058 warns on a regular advance-tax shortfall", async () => {
    const result = await computeTax(vector("TV-030").input);
    const report = validateTaxRequest(vector("TV-030").input);

    assert.ok(result.warnings.includes("WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE"));
    assertHasValidation(report, "WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE", "warning", "cases.regular.advance_tax_paid_by_dates");
  });

  it("TC-S2-059 adds a Section 234F late-fee line when filing is after the due date", async () => {
    const result = await computeTax(baseRequest({
      income: { salary: { gross_salary: 700000 } },
      filing: { filed_after_due_date: true }
    }));

    assert.equal(result.summary.late_filing_fee_234f, 5000);
    assert.equal(result.summary.net_tax_liability, 5000);
    assert.ok(result.warnings.includes("WARN_LATE_FILING_FEE_234F_APPLIED"));
  });

  it("TC-S2-060 recommends ITR-1 for a salary-only supported taxpayer", async () => {
    const result = await computeTax(baseRequest({ income: { salary: { gross_salary: 900000 } } }));

    assert.equal(result.itr_recommendation, "ITR-1");
  });

  it("TC-S2-061 recommends ITR-2 for a taxpayer with capital gains", async () => {
    const result = await computeTax(baseRequest({
      income: { capital_gains: [{ section: "112A", transfer_date: "2024-07-23", net_gain: 125000 }] }
    }));

    assert.equal(result.itr_recommendation, "ITR-2");
  });

  it("TC-S2-062 recommends ITR-3 for a non-presumptive business taxpayer", async () => {
    const result = await computeTax(baseRequest({
      income: { business_profession: [{ type: "normal_business", net_income: 600000 }] }
    }));

    assert.equal(result.itr_recommendation, "ITR-3");
  });

  it("TC-S2-063 recommends ITR-4 for a presumptive taxpayer", async () => {
    const result = await computeTax(baseRequest({
      income: { business_profession: [{ section: "44AD", turnover: 1000000, digital_receipts: 1000000, cash_receipts: 0 }] }
    }));

    assert.equal(result.itr_recommendation, "ITR-4");
  });

  it("TC-S2-064 blocks recommendation and computation for unsupported entity complexity", async () => {
    const request = baseRequest({ taxpayer_type: "company" });
    const report = validateTaxRequest(request);

    assert.equal(report.status, "blocked");
    assertHasValidation(report, "VAL_TAXPAYER_TYPE_UNSUPPORTED", "blocker", "taxpayer_type");
    await assert.rejects(() => computeTax(request), /supports only individual and HUF taxpayers/);
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

async function assertGoldenVector(id) {
  const testVector = vector(id);
  const result = await computeTax(testVector.input);

  assert.equal(result.status, "ok");
  for (const assertion of testVector.expected.assertions) {
    assertGoldenAssertion(result, assertion, id);
  }

  assert.deepEqual(new Set(result.warnings), new Set(testVector.expected.warnings), `${id} warnings`);
}

function assertGoldenAssertion(result, assertion, id) {
  const actual = readPath(result, assertion.path);
  const label = `${id} ${assertion.path}`;

  if (["equals", "caps_at", "disallowed"].includes(assertion.operator)) {
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

function assertHasValidation(report, code, severity, fieldPath) {
  assert.ok(
    report.results.some((result) => result.code === code && result.severity === severity && result.field_path === fieldPath),
    `Expected validation ${code}/${severity} at ${fieldPath}; got ${JSON.stringify(report.results)}`
  );
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
