import { roundRupee, toRupees } from "./money.mjs";

const VALIDATION_VERSION = "sprint3-v1";
const SUPPORTED_ASSESSMENT_YEARS = new Set(["2025-26", "2026-27"]);
const CAPITAL_GAINS_RATE_CHANGE_DATE = "2024-07-23";

export function validateTaxRequest(request = {}) {
  const collector = createCollector();

  validateEnvelope(request, collector);
  validateYearLawRegime(request, collector);

  if (Array.isArray(request.cases)) {
    validateCaseSet(request, collector);
  } else {
    validateSalary(request, collector);
    validateHouseProperty(request, collector);
    validateChapterVia(request, collector);
    validateCapitalGains(request, collector);
    validatePresumptiveBusiness(request, collector);
  }

  if (request.options?.include_advisory_info && request.regime === "new") {
    collector.add({
      code: "INFO_NEW_REGIME_DEFAULT",
      severity: "info",
      field_path: "regime",
      message_key: "validation.regime.new_default",
      source_rule: "regime.115bac.default",
      remediation_hint: "Run old-vs-new comparison before filing if old-regime deductions or exemptions are available."
    });
  }

  return collector.toReport();
}

function validateEnvelope(request, collector) {
  for (const [fieldPath, rawValue] of [
    ["period_type", request.period_type],
    ["period", request.period],
    ["act", request.act],
    ["taxpayer_type", request.taxpayer_type],
    ["residency", request.residency],
    ["regime", request.regime]
  ]) {
    if (containsUnsafeMarkup(rawValue)) {
      collector.add({
        code: "VAL_INPUT_UNSAFE_MARKUP",
        severity: "blocker",
        field_path: fieldPath,
        message_key: "validation.input.unsafe_markup",
        source_rule: "security.input_sanitization",
        remediation_hint: "Remove markup or script-like characters before submitting."
      });
    }
  }

  if (!["assessment_year", "tax_year"].includes(request.period_type)) {
    collector.add({
      code: "VAL_PERIOD_TYPE_UNSUPPORTED",
      severity: "blocker",
      field_path: "period_type",
      message_key: "validation.period_type.unsupported",
      source_rule: "period.selector",
      remediation_hint: "Select assessment_year or tax_year."
    });
  }

  if (request.period_type === "assessment_year" && !SUPPORTED_ASSESSMENT_YEARS.has(request.period)) {
    collector.add({
      code: "VAL_PERIOD_UNSUPPORTED",
      severity: "blocker",
      field_path: "period",
      message_key: "validation.period.unsupported",
      source_rule: "rulepack.periods.active",
      remediation_hint: "Use one of the active rulepack periods: 2025-26 or 2026-27."
    });
  }

  if (Array.isArray(request.cases)) {
    return;
  }

  if (!["individual", "huf"].includes(request.taxpayer_type)) {
    collector.add({
      code: "VAL_TAXPAYER_TYPE_UNSUPPORTED",
      severity: "blocker",
      field_path: "taxpayer_type",
      message_key: "validation.taxpayer_type.unsupported",
      source_rule: "scope.taxpayer.v1",
      remediation_hint: "This calculation currently supports individual and HUF taxpayers only."
    });
  }

  if (!["resident", "non_resident"].includes(request.residency)) {
    collector.add({
      code: "VAL_RESIDENCY_REQUIRED",
      severity: "blocker",
      field_path: "residency",
      message_key: "validation.residency.required",
      source_rule: "scope.residency.v1",
      remediation_hint: "Provide resident or non_resident."
    });
  }

  if (!["old", "new"].includes(request.regime)) {
    collector.add({
      code: "VAL_REGIME_UNSUPPORTED",
      severity: "blocker",
      field_path: "regime",
      message_key: "validation.regime.unsupported",
      source_rule: "regime.selector",
      remediation_hint: "Choose old or new regime."
    });
  }

  if (!Number.isFinite(request.age_years) || request.age_years < 0) {
    collector.add({
      code: "VAL_AGE_REQUIRED",
      severity: "blocker",
      field_path: "age_years",
      message_key: "validation.age.required",
      source_rule: "scope.age_band",
      remediation_hint: "Provide a non-negative age in completed years."
    });
  }
}

function containsUnsafeMarkup(value) {
  return typeof value === "string" && /<[^>]+>|javascript:|on\w+=/i.test(value);
}

function validateYearLawRegime(request, collector) {
  if (request.period_type === "assessment_year" && request.period === "2026-27" && request.act === "Income-tax Act, 2025") {
    collector.add({
      code: "VAL_ACT_PERIOD_MISMATCH",
      severity: "blocker",
      field_path: "act",
      message_key: "validation.act.period_mismatch",
      source_rule: "law.transition.2026",
      remediation_hint: "Use Income-tax Act, 1961 for AY 2026-27 calculations until a tax-year rulepack is active."
    });
  }

  if (request.period_type === "tax_year") {
    collector.add({
      code: "VAL_TAX_YEAR_RULEPACK_NOT_ACTIVE",
      severity: "blocker",
      field_path: "period_type",
      message_key: "validation.tax_year.not_active",
      source_rule: "rulepack.periods.active",
      remediation_hint: "Use assessment_year until tax-year rulepacks are activated."
    });
  }
}

function validateSalary(request, collector) {
  const salary = request.income?.salary;
  if (!salary) return;

  for (const [field, label] of [
    ["gross_salary", "gross salary"],
    ["basic_salary", "basic salary"],
    ["hra_received", "HRA received"],
    ["rent_paid", "rent paid"],
    ["lta_received", "LTA received"],
    ["dearness_allowance_retirement_benefit", "eligible dearness allowance"],
    ["turnover_commission", "turnover commission"]
  ]) {
    if (field in salary && toRupees(salary[field]) < 0) {
      collector.add({
        code: "VAL_SALARY_AMOUNT_NEGATIVE",
        severity: "blocker",
        field_path: `income.salary.${field}`,
        message_key: "validation.salary.negative_amount",
        source_rule: "income.salary.non_negative",
        remediation_hint: `Provide a non-negative ${label} amount.`
      });
    }
  }

  const hraReceived = toRupees(salary.hra_received ?? 0);
  const rentPaid = toRupees(salary.rent_paid ?? 0);
  const salaryBase = toRupees(salary.basic_salary ?? 0) +
    toRupees(salary.dearness_allowance_retirement_benefit ?? 0) +
    toRupees(salary.turnover_commission ?? 0);

  if (hraReceived > 0 || rentPaid > 0) {
    if (request.regime === "new") {
      collector.add({
        code: "WARN_HRA_NOT_AVAILABLE_NEW_REGIME",
        severity: "warning",
        field_path: "income.salary.hra_received",
        message_key: "validation.hra.new_regime",
        source_rule: "salary.hra.regime",
        remediation_hint: "Switch to old regime or remove the HRA exemption claim."
      });
    } else if (salaryBase <= 0) {
      collector.add({
        code: "VAL_HRA_SALARY_BASE_REQUIRED",
        severity: "blocker",
        field_path: "income.salary.basic_salary",
        message_key: "validation.hra.salary_base_required",
        source_rule: "salary.hra.least_of",
        remediation_hint: "Provide basic salary, eligible DA, or turnover commission before claiming HRA."
      });
    } else if (hraReceived > 0 && rentPaid <= 0) {
      collector.add({
        code: "VAL_HRA_RENT_REQUIRED",
        severity: "blocker",
        field_path: "income.salary.rent_paid",
        message_key: "validation.hra.rent_required",
        source_rule: "salary.hra.least_of",
        remediation_hint: "Provide annual rent paid before claiming an HRA exemption."
      });
    }

    if (request.regime !== "new" && rentPaid > 100000) {
      collector.add({
        code: "WARN_LANDLORD_PAN_MAY_BE_REQUIRED",
        severity: "warning",
        field_path: "income.salary.rent_paid",
        message_key: "validation.hra.landlord_pan",
        source_rule: "salary.hra.landlord_pan",
        remediation_hint: "Capture landlord PAN or confirmation before filing."
      });
    }
  }

  const ltaClaim = request.claims?.lta;
  if (ltaClaim || toRupees(salary.lta_received ?? 0) > 0) {
    if (request.regime === "new") {
      collector.add({
        code: "WARN_LTA_NOT_AVAILABLE_NEW_REGIME",
        severity: "warning",
        field_path: "claims.lta",
        message_key: "validation.lta.new_regime",
        source_rule: "salary.lta.regime",
        remediation_hint: "Switch to old regime or remove the LTA exemption claim."
      });
    } else if ((ltaClaim?.journeys_already_claimed_in_block ?? 0) >= 2) {
      collector.add({
        code: "WARN_LTA_BLOCK_LIMIT_EXCEEDED",
        severity: "blocker",
        field_path: "claims.lta.journeys_already_claimed_in_block",
        message_key: "validation.lta.block_limit",
        source_rule: "salary.lta.rule_2b",
        remediation_hint: "Remove the claim or carry it to an eligible block if available."
      });
    }
  }
}

function validateHouseProperty(request, collector) {
  for (const [index, property] of (request.income?.house_property ?? []).entries()) {
    if (request.regime === "new" && property.property_type === "let_out" && toRupees(property.computed_loss ?? 0) > 0) {
      collector.add({
        code: "WARN_HOUSE_PROPERTY_LOSS_SET_OFF_NOT_AVAILABLE_NEW_REGIME",
        severity: "warning",
        field_path: `income.house_property[${index}].computed_loss`,
        message_key: "validation.house_property.new_regime_loss_setoff",
        source_rule: "house_property.loss_setoff.regime",
        remediation_hint: "Do not cross-set off this loss under the new regime."
      });
    }
  }
}

function validateChapterVia(request, collector) {
  const deductions = request.deductions?.chapter_via ?? [];
  if (request.regime === "new" && deductions.some(hasPositiveDeductionClaim)) {
    collector.add({
      code: "WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME",
      severity: "warning",
      field_path: "deductions.chapter_via",
      message_key: "validation.chapter_via.new_regime",
      source_rule: "chapter_via.regime",
      remediation_hint: "Switch to old regime or remove Chapter VI-A deductions that are unavailable in the new regime."
    });
  }

  const sections = new Set(deductions.map((deduction) => deduction.section));
  if (sections.has("80EE") && sections.has("80EEA")) {
    collector.add({
      code: "WARN_80EE_80EEA_MUTUAL_EXCLUSION",
      severity: "blocker",
      field_path: "deductions.chapter_via",
      message_key: "validation.80ee_80eea.mutual_exclusion",
      source_rule: "chapter_via.80ee_80eea",
      remediation_hint: "Keep only one of 80EE or 80EEA for the housing-loan claim."
    });
  }

  for (const [index, deduction] of deductions.entries()) {
    if (request.regime === "new") continue;

    if (["80C", "80CCC", "80CCD(1)"].includes(deduction.section) && toRupees(deduction.amount ?? 0) > 150000) {
      collector.add({
        code: "WARN_80C_CAP_APPLIED",
        severity: "warning",
        field_path: `deductions.chapter_via[${index}].amount`,
        message_key: "validation.80c.cap",
        source_rule: "chapter_via.80c.cap",
        remediation_hint: "Cap the combined 80C family deduction at Rs. 1,50,000."
      });
    }

    if (deduction.section === "80TTB" && (request.residency !== "resident" || request.age_years < 60)) {
      collector.add({
        code: "VAL_80TTB_RESIDENT_SENIOR_REQUIRED",
        severity: "blocker",
        field_path: `deductions.chapter_via[${index}]`,
        message_key: "validation.80ttb.resident_senior_required",
        source_rule: "chapter_via.80ttb.scope",
        remediation_hint: "Use 80TTB only for resident senior citizens."
      });
    }

    if (deduction.section === "80G" && deduction.payment_mode === "cash" && toRupees(deduction.amount ?? 0) > 2000) {
      collector.add({
        code: "WARN_80G_CASH_LIMIT_APPLIED",
        severity: "warning",
        field_path: `deductions.chapter_via[${index}].amount`,
        message_key: "validation.80g.cash_limit",
        source_rule: "chapter_via.80g.cash_limit",
        remediation_hint: "Cash donations above Rs. 2,000 are not eligible for deduction."
      });
    }

    if (deduction.section === "80D") {
      const claimed = toRupees(deduction.premium ?? 0) + toRupees(deduction.preventive_checkup ?? 0);
      const cap = deduction.senior ? 50000 : 25000;
      if (toRupees(deduction.preventive_checkup ?? 0) > 0 && claimed > cap) {
        collector.add({
          code: "WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP",
          severity: "warning",
          field_path: `deductions.chapter_via[${index}]`,
          message_key: "validation.80d.bucket_cap",
          source_rule: "chapter_via.80d.bucket",
          remediation_hint: "Keep preventive health check-up inside the applicable 80D bucket cap."
        });
      }
    }
  }
}

function validateCapitalGains(request, collector) {
  const gains = request.income?.capital_gains ?? [];
  const normalIncome = approximateNormalIncome(request);
  const section112aRows = gains.filter((gain) => gain.section === "112A" && toRupees(gain.net_gain ?? 0) > 0);

  if (section112aRows.length > 1) {
    collector.add({
      code: "WARN_112A_THRESHOLD_AGGREGATION_REQUIRED",
      severity: "warning",
      field_path: "income.capital_gains",
      message_key: "validation.112a.threshold_aggregation",
      source_rule: "capital_gains.112a.threshold",
      remediation_hint: "Aggregate annual 112A gains before applying the exemption threshold."
    });
  }

  for (const [index, gain] of gains.entries()) {
    if (toRupees(gain.net_gain ?? gain.gain_without_indexation ?? 0) > 0 && !gain.transfer_date) {
      collector.add({
        code: "VAL_CAPITAL_GAIN_TRANSFER_DATE_REQUIRED",
        severity: "blocker",
        field_path: `income.capital_gains[${index}].transfer_date`,
        message_key: "validation.capital_gains.transfer_date_required",
        source_rule: "capital_gains.rate_split_date",
        remediation_hint: "Provide the sale or transfer date before computing capital-gains tax."
      });
    }

    if (gain.acquisition_date && gain.transfer_date && gain.acquisition_date > gain.transfer_date) {
      collector.add({
        code: "VAL_CAPITAL_GAIN_DATE_ORDER",
        severity: "blocker",
        field_path: `income.capital_gains[${index}].acquisition_date`,
        message_key: "validation.capital_gains.date_order",
        source_rule: "capital_gains.asset_dates",
        remediation_hint: "Use an acquisition date that is on or before the sale or transfer date."
      });
    }

    if (request.regime === "old" && request.residency !== "resident" && ["111A", "112"].includes(gain.section)) {
      collector.add({
        code: "WARN_BASIC_EXEMPTION_ADJUSTMENT_NOT_AVAILABLE",
        severity: "warning",
        field_path: `income.capital_gains[${index}]`,
        message_key: "validation.capital_gains.basic_exemption_nonresident",
        source_rule: "capital_gains.basic_exemption",
        remediation_hint: "Do not reduce this special-rate gain by unused basic exemption for a non-resident case."
      });
    }

    if (gain.section === "112A" && isBeforeCapitalGainsRateChange(gain.transfer_date)) {
      collector.add({
        code: "WARN_112A_PRE_2024_07_23_THRESHOLD_REVIEW",
        severity: "warning",
        field_path: `income.capital_gains[${index}].transfer_date`,
        message_key: "validation.112a.pre_change_threshold_review",
        source_rule: "capital_gains.112a.pre_2024_07_23",
        remediation_hint: "Confirm the applicable annual threshold before filing."
      });
    }

    if (gain.section === "112A" && request.regime === "new" && request.residency === "resident" && normalIncome > 0) {
      const threshold = isBeforeCapitalGainsRateChange(gain.transfer_date) ? 100000 : 125000;
      if (toRupees(gain.net_gain ?? 0) > threshold) {
        collector.add({
          code: "WARN_REBATE_SPECIAL_RATE_LIMIT",
          severity: "warning",
          field_path: `income.capital_gains[${index}]`,
          message_key: "validation.rebate.special_rate_limit",
          source_rule: "rebate.87a.special_rate",
          remediation_hint: "Keep 112A tax outside the Section 87A normal-income rebate offset."
        });
      }
    }
  }
}

function validatePresumptiveBusiness(request, collector) {
  for (const [index, business] of (request.income?.business_profession ?? []).entries()) {
    if (business.section === "44AD") {
      const turnover = toRupees(business.turnover ?? 0);
      const cashReceipts = toRupees(business.cash_receipts ?? 0);
      const cashRatio = turnover > 0 ? cashReceipts / turnover : 0;
      if (turnover > 30000000) {
        collector.add({
          code: "WARN_44AD_TURNOVER_LIMIT_EXCEEDED",
          severity: "warning",
          field_path: `income.business_profession[${index}].turnover`,
          message_key: "validation.44ad.turnover_limit_exceeded",
          source_rule: "presumptive.44ad.turnover_threshold",
          remediation_hint: "Review regular business computation and audit applicability because turnover exceeds the 44AD enhanced threshold."
        });
      } else if (turnover > 20000000 && cashRatio > 0.05) {
        collector.add({
          code: "WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE",
          severity: "warning",
          field_path: `income.business_profession[${index}].cash_receipts`,
          message_key: "validation.44ad.enhanced_threshold_unavailable",
          source_rule: "presumptive.44ad.cash_threshold",
          remediation_hint: "Use the standard Rs. 2 crore threshold or review audit applicability."
        });
      }

      const declaredIncome = toRupees(business.declared_income ?? business.net_income ?? 0);
      const deemedIncome = calculate44adDeemedIncome(business);
      if (declaredIncome > 0 && declaredIncome < deemedIncome) {
        collector.add({
          code: "WARN_PRESUMPTIVE_LOWER_INCOME_AUDIT_REVIEW",
          severity: "warning",
          field_path: `income.business_profession[${index}].declared_income`,
          message_key: "validation.presumptive.lower_income_audit",
          source_rule: "presumptive.lower_income.audit",
          remediation_hint: "Review audit applicability when declared income is below the presumptive amount."
        });
      }
    }

    if (business.section === "44ADA") {
      const grossReceipts = toRupees(business.gross_receipts ?? 0);
      const cashReceipts = toRupees(business.cash_receipts ?? 0);
      const cashRatio = grossReceipts > 0 ? cashReceipts / grossReceipts : 0;
      if (grossReceipts > 5000000 && cashRatio > 0.05) {
        collector.add({
          code: "WARN_44ADA_ENHANCED_THRESHOLD_UNAVAILABLE",
          severity: "warning",
          field_path: `income.business_profession[${index}].cash_receipts`,
          message_key: "validation.44ada.enhanced_threshold_unavailable",
          source_rule: "presumptive.44ada.cash_threshold",
          remediation_hint: "Use the standard Rs. 50 lakh threshold or review audit applicability."
        });
      }

      const declaredIncome = toRupees(business.declared_income ?? business.net_income ?? 0);
      const deemedIncome = roundRupee(grossReceipts * 0.5);
      if (declaredIncome > 0 && declaredIncome < deemedIncome) {
        collector.add({
          code: "WARN_PRESUMPTIVE_LOWER_INCOME_AUDIT_REVIEW",
          severity: "warning",
          field_path: `income.business_profession[${index}].declared_income`,
          message_key: "validation.presumptive.lower_income_audit",
          source_rule: "presumptive.lower_income.audit",
          remediation_hint: "Review audit applicability when declared income is below the presumptive amount."
        });
      }
    }

    if (business.section === "44AE") {
      const vehicleCount = business.vehicle_count ?? business.vehicles?.length ?? 0;
      if (vehicleCount > 10) {
        collector.add({
          code: "VAL_44AE_VEHICLE_LIMIT_EXCEEDED",
          severity: "blocker",
          field_path: `income.business_profession[${index}].vehicle_count`,
          message_key: "validation.44ae.vehicle_limit",
          source_rule: "presumptive.44ae.vehicle_limit",
          remediation_hint: "Use 44AE only where the goods-carriage vehicle count does not exceed ten."
        });
      }
    }
  }
}

function validateCaseSet(request, collector) {
  for (const testCase of request.cases) {
    if (!testCase.advance_tax_paid_by_dates) continue;
    const businessItems = testCase.business_profession ?? [];
    const presumptive = businessItems.some((business) => ["44AD", "44ADA", "44AE"].includes(business.section));
    if (!presumptive && Object.values(testCase.advance_tax_paid_by_dates).every((amount) => toRupees(amount) === 0)) {
      collector.add({
        code: "WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE",
        severity: "warning",
        field_path: `cases.${testCase.case_id}.advance_tax_paid_by_dates`,
        message_key: "validation.advance_tax.shortfall_regular",
        source_rule: "advance_tax.regular_schedule",
        remediation_hint: "Collect installment-wise advance-tax payments for the regular business case."
      });
    }
  }
}

function approximateNormalIncome(request) {
  const salary = request.income?.salary ?? {};
  const salaryIncome = toRupees(salary.gross_salary ??
    toRupees(salary.basic_salary ?? 0) +
    toRupees(salary.hra_received ?? 0) +
    toRupees(salary.lta_received ?? 0));
  const otherSources = (request.income?.other_sources ?? []).reduce((total, item) => total + toRupees(item.amount ?? 0), 0);
  const business = (request.income?.business_profession ?? []).reduce((total, item) => total + toRupees(item.net_income ?? 0), 0);
  return salaryIncome + otherSources + business;
}

function calculate44adDeemedIncome(business) {
  const turnover = toRupees(business.turnover ?? 0);
  const cashReceipts = toRupees(business.cash_receipts ?? 0);
  const digitalReceipts = toRupees(business.digital_receipts ?? Math.max(0, turnover - cashReceipts));
  const unclassifiedReceipts = Math.max(0, turnover - cashReceipts - digitalReceipts);
  return roundRupee((digitalReceipts * 0.06) + ((cashReceipts + unclassifiedReceipts) * 0.08));
}

function hasPositiveDeductionClaim(deduction) {
  return toRupees(deduction.amount ?? 0) > 0 ||
    toRupees(deduction.premium ?? 0) > 0 ||
    toRupees(deduction.preventive_checkup ?? 0) > 0 ||
    toRupees(deduction.rent_paid ?? 0) > 0 ||
    toRupees(deduction.interest_paid ?? 0) > 0 ||
    toRupees(deduction.medical_treatment_paid ?? 0) > 0 ||
    toRupees(deduction.employer_contribution ?? 0) > 0;
}

function isBeforeCapitalGainsRateChange(transferDate) {
  return Boolean(transferDate) && transferDate < CAPITAL_GAINS_RATE_CHANGE_DATE;
}

function createCollector() {
  const results = [];
  const seen = new Set();
  return {
    add(result) {
      const key = `${result.code}:${result.field_path}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(result);
    },
    toReport() {
      const blockers = results.filter((result) => result.severity === "blocker");
      const warnings = results.filter((result) => result.severity === "warning");
      const infos = results.filter((result) => result.severity === "info");
      return {
        status: blockers.length > 0 ? "blocked" : "ok",
        validation_version: VALIDATION_VERSION,
        summary: {
          blockers: blockers.length,
          warnings: warnings.length,
          infos: infos.length
        },
        codes: results.map((result) => result.code),
        hard_blockers: blockers.map((result) => result.code),
        warnings: warnings.map((result) => result.code),
        informational_notices: infos.map((result) => result.code),
        results
      };
    }
  };
}
