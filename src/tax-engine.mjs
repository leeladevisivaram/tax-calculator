import { createHash } from "node:crypto";
import { findOptionalRule, findRule, getRulepackForRequest, rulepackChecksum } from "./rulepack-loader.mjs";
import { validateTaxRequest } from "./validation-engine.mjs";
import { roundFinalRupee, roundRupee, toRupees } from "./money.mjs";

const SUPPORTED_CHAPTER_VIA_CAPS = {
  "80C_FAMILY": 150000,
  "80CCD(1B)": 50000,
  "80EE": 50000,
  "80EEA": 150000
};

const CAPITAL_GAINS_RATE_CHANGE_DATE = "2024-07-23";

export async function computeTax(request) {
  let response;
  if (Array.isArray(request.cases)) {
    response = computeCaseSet(request);
  } else {
    const rulepack = await getRulepackForRequest(request);
    response = computeWithRulepack(request, rulepack);
  }

  return attachStructuredValidation(request, response);
}

export async function compareRegimes(request) {
  const oldRegime = await computeTax({ ...request, regime: "old" });
  const newRegime = await computeTax({ ...request, regime: "new" });
  const oldLiability = oldRegime.summary.net_tax_liability;
  const newLiability = newRegime.summary.net_tax_liability;

  return {
    status: "ok",
    period_type: request.period_type,
    period: request.period,
    act: request.act,
    recommended_regime: newLiability <= oldLiability ? "new" : "old",
    old: oldRegime.summary,
    new: newRegime.summary,
    delta: oldLiability - newLiability,
    rulepacks: {
      old: oldRegime.rulepack_version,
      new: newRegime.rulepack_version
    }
  };
}

export function computeWithRulepack(request, rulepack) {
  assertSupportedRequest(request);

  const warnings = [];
  const validation = {};
  const ruleTrace = [];
  const ageBand = resolveAgeBand(request);
  const salaryResult = calculateSalary(request, warnings, validation);
  const housePropertyResult = calculateHouseProperty(request, warnings);
  const businessResult = calculateBusinessProfession(request, warnings, validation);
  const otherSourcesResult = calculateOtherSources(request);
  const normalIncomeBeforeDeductions =
    salaryResult.taxable_salary +
    housePropertyResult.normal_income_impact +
    businessResult.normal_income +
    otherSourcesResult.normal_income;

  const capitalGainsResult = calculateCapitalGains(request, normalIncomeBeforeDeductions, warnings, validation);
  const grossTotalIncome = Math.max(0, normalIncomeBeforeDeductions) + capitalGainsResult.gross_special_income;

  const standardDeductionRule = salaryResult.salary_for_standard_deduction > 0 && request.deductions?.standard_deduction !== false
    ? findOptionalRule(rulepack, "standard_deduction", {
        periods: request.period,
        taxpayer_type: request.taxpayer_type,
        regime: request.regime,
        income_head: "salary"
      })
    : null;

  const standardDeduction = standardDeductionRule
    ? Math.min(salaryResult.salary_for_standard_deduction, toRupees(standardDeductionRule.calculation.amount))
    : 0;
  if (standardDeductionRule) {
    ruleTrace.push(standardDeductionRule.rule_id);
  }

  const chapterVia = calculateChapterViaDeductions(request, warnings, validation, {
    normalIncomeBeforeDeductions,
    otherSourcesResult
  });
  const chapterViaDeductions = chapterVia.total;
  const totalDeductions = standardDeduction + chapterViaDeductions;
  const normalIncome = Math.max(0, normalIncomeBeforeDeductions - totalDeductions);
  const totalIncome = normalIncome + capitalGainsResult.gross_special_income;

  const slabRule = findRule(rulepack, "slab", {
    periods: request.period,
    taxpayer_type: request.taxpayer_type,
    residency: request.residency,
    age_band: ageBand,
    regime: request.regime,
    income_head: "normal_income"
  });
  ruleTrace.push(slabRule.rule_id);

  const taxBeforeRebate = calculateSlabTax(normalIncome, slabRule.calculation.slabs);

  const rebateRule = findOptionalRule(rulepack, "rebate", {
    periods: request.period,
    taxpayer_type: request.taxpayer_type,
    residency: request.residency,
    regime: request.regime,
    income_head: "normal_income"
  });

  const rebate87a = rebateRule ? calculateRebate(taxBeforeRebate, normalIncome, rebateRule.calculation) : 0;
  if (rebateRule) {
    ruleTrace.push(rebateRule.rule_id);
  }

  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate87a);
  const specialRateTaxBeforeCess = capitalGainsResult.total_special_tax_before_cess;
  const aggregateTaxBeforeSurcharge = taxAfterRebate + specialRateTaxBeforeCess;

  const surchargeRule = findRule(rulepack, "surcharge", {
    periods: request.period,
    taxpayer_type: request.taxpayer_type,
    regime: request.regime
  });
  ruleTrace.push(surchargeRule.rule_id);
  const surcharge = calculateSurcharge(totalIncome, aggregateTaxBeforeSurcharge, surchargeRule.calculation.tiers);

  const cessRule = findRule(rulepack, "cess", {
    periods: request.period,
    taxpayer_type: request.taxpayer_type,
    regime: request.regime
  });
  ruleTrace.push(cessRule.rule_id);
  const cess = roundFinalRupee((aggregateTaxBeforeSurcharge + surcharge) * cessRule.calculation.rate);

  const lateFilingFee234f = calculateLateFilingFee234f(request, totalIncome);
  if (lateFilingFee234f > 0) {
    warnings.push("WARN_LATE_FILING_FEE_234F_APPLIED");
  }
  const totalTax = roundFinalRupee(aggregateTaxBeforeSurcharge + surcharge + cess + lateFilingFee234f);
  const taxCredits = calculateTaxCredits(request.tax_credits);
  const netTaxLiability = roundFinalRupee(Math.max(0, totalTax - taxCredits));
  const refundOrPayable = roundFinalRupee(totalTax - taxCredits);

  const summary = {
    gross_total_income: grossTotalIncome,
    salary: salaryResult.summary,
    exemptions: salaryResult.exemptions,
    house_property: housePropertyResult.properties,
    house_property_loss_setoff_against_other_heads: housePropertyResult.loss_setoff_against_other_heads,
    house_property_loss_carry_forward: housePropertyResult.loss_carry_forward,
    business_profession: businessResult.summary,
    capital_gains: capitalGainsResult.capital_gains,
    special_rate_tax: capitalGainsResult.special_rate_tax,
    basic_exemption_adjustment: capitalGainsResult.basic_exemption_adjustment,
    rebate_87a_offsets_special_rate_tax: false,
    standard_deduction: standardDeduction,
    chapter_via_allowed: chapterViaDeductions,
    chapter_via_deductions: chapterViaDeductions,
    deductions: chapterVia.details,
    total_deductions: totalDeductions,
    total_income: totalIncome,
    normal_income: normalIncome,
    tax_before_rebate: taxBeforeRebate,
    rebate_87a: rebate87a,
    tax_after_marginal_relief_before_cess: taxAfterRebate + surcharge,
    tax_after_rebate: taxAfterRebate,
    surcharge,
    cess,
    late_filing_fee_234f: lateFilingFee234f,
    total_tax: totalTax,
    tax_credits: taxCredits,
    net_tax_liability: netTaxLiability,
    refund_or_payable: refundOrPayable
  };

  const response = {
    status: "ok",
    rulepack_version: rulepack.rulepack_id,
    source_register_version: rulepack.source_register_version,
    computation_hash: "",
    summary,
    explain: buildExplanation(request, summary),
    warnings,
    validation,
    itr_recommendation: recommendItr(request, summary),
    rule_trace: [...new Set(ruleTrace)]
  };

  response.computation_hash = createHash("sha256")
    .update(JSON.stringify({ request, summary, rulepack_checksum: rulepackChecksum(rulepack) }))
    .digest("hex");

  return response;
}

export function calculateSlabTax(amount, slabs) {
  let tax = 0;
  for (const slab of slabs) {
    const upper = slab.to ?? Number.POSITIVE_INFINITY;
    if (amount <= slab.from) continue;
    const taxableInSlab = Math.min(amount, upper) - slab.from;
    tax += taxableInSlab * slab.rate;
  }
  return roundRupee(tax);
}

function calculateRebate(taxBeforeRebate, totalIncome, rebateCalculation) {
  const threshold = toRupees(rebateCalculation.threshold_total_income);
  const maxRebate = toRupees(rebateCalculation.max_rebate);

  if (totalIncome <= threshold) {
    return Math.min(taxBeforeRebate, maxRebate);
  }

  if (rebateCalculation.marginal_relief) {
    const excessIncome = totalIncome - threshold;
    if (taxBeforeRebate > excessIncome) {
      return roundRupee(taxBeforeRebate - excessIncome);
    }
  }

  return 0;
}

function calculateLateFilingFee234f(request, totalIncome) {
  if (!request.filing?.filed_after_due_date) return 0;
  if (totalIncome <= 0) return 0;
  return totalIncome > 500000 ? 5000 : 1000;
}

function calculateSurcharge(totalIncome, taxAfterRebate, tiers) {
  const tier = tiers.find((candidate) => totalIncome > candidate.from && (candidate.to === null || totalIncome <= candidate.to));
  return roundRupee(taxAfterRebate * (tier?.rate ?? 0));
}

function calculateSalary(request, warnings, validation) {
  const salary = request.income?.salary ?? {};
  const basicSalary = toRupees(salary.basic_salary ?? 0);
  const dearnessAllowance = toRupees(salary.dearness_allowance_retirement_benefit ?? 0);
  const turnoverCommission = toRupees(salary.turnover_commission ?? 0);
  const salaryForHra = basicSalary + dearnessAllowance + turnoverCommission;
  const hraReceived = toRupees(salary.hra_received ?? 0);
  const ltaReceived = toRupees(salary.lta_received ?? 0);
  const grossSalary = toRupees(salary.gross_salary ?? salaryForHra + hraReceived + ltaReceived);

  const hra = calculateHraExemption(request, salary, salaryForHra, hraReceived, warnings, validation);
  const lta = calculateLtaExemption(request, ltaReceived, warnings, validation);
  const totalExemptions = hra.allowed + lta.allowed;
  const taxableSalary = Math.max(0, grossSalary - totalExemptions);

  return {
    taxable_salary: taxableSalary,
    salary_for_standard_deduction: taxableSalary,
    summary: {
      gross_salary: grossSalary,
      salary_for_hra: salaryForHra,
      taxable_salary: taxableSalary
    },
    exemptions: { hra, lta }
  };
}

function calculateHraExemption(request, salary, salaryForHra, hraReceived, warnings, validation) {
  const rentPaid = toRupees(salary.rent_paid ?? 0);
  if (hraReceived === 0 && rentPaid === 0) {
    return { allowed: 0 };
  }

  if (request.regime === "new") {
    validation.hra_new_regime = true;
    warnings.push("WARN_HRA_NOT_AVAILABLE_NEW_REGIME");
    return {
      actual_hra: hraReceived,
      rent_minus_10_percent_salary: Math.max(0, rentPaid - salaryForHra * 0.1),
      metro_salary_percent: salary.metro_city ? salaryForHra * 0.5 : salaryForHra * 0.4,
      allowed: 0
    };
  }

  const actualHra = hraReceived;
  const rentMinusTenPercentSalary = Math.max(0, rentPaid - salaryForHra * 0.1);
  const salaryPercent = salary.metro_city ? salaryForHra * 0.5 : salaryForHra * 0.4;
  const allowed = roundRupee(Math.min(actualHra, rentMinusTenPercentSalary, salaryPercent));

  if (rentPaid > 100000) {
    warnings.push("WARN_LANDLORD_PAN_MAY_BE_REQUIRED");
  }

  return {
    actual_hra: actualHra,
    rent_minus_10_percent_salary: roundRupee(rentMinusTenPercentSalary),
    metro_salary_percent: roundRupee(salaryPercent),
    allowed
  };
}

function calculateLtaExemption(request, ltaReceived, warnings, validation) {
  const ltaClaim = request.claims?.lta;
  if (!ltaClaim && ltaReceived === 0) {
    return { allowed: 0 };
  }

  if (request.regime === "new") {
    validation.lta_new_regime = true;
    warnings.push("WARN_LTA_NOT_AVAILABLE_NEW_REGIME");
    return { claimed: toRupees(ltaClaim?.current_claim_amount ?? 0), allowed: 0 };
  }

  if ((ltaClaim?.journeys_already_claimed_in_block ?? 0) >= 2) {
    validation.lta_block_limit = true;
    warnings.push("WARN_LTA_BLOCK_LIMIT_EXCEEDED");
    return { claimed: toRupees(ltaClaim?.current_claim_amount ?? 0), allowed: 0 };
  }

  return {
    claimed: toRupees(ltaClaim?.current_claim_amount ?? 0),
    allowed: Math.min(ltaReceived, toRupees(ltaClaim?.current_claim_amount ?? ltaReceived))
  };
}

function calculateHouseProperty(request, warnings) {
  const properties = [];
  let normalIncomeImpact = 0;
  let lossSetoffAgainstOtherHeads = 0;
  let lossCarryForward = 0;

  for (const property of request.income?.house_property ?? []) {
    if (property.property_type === "self_occupied") {
      const interestPaid = toRupees(property.interest_paid ?? 0);
      const interestAllowed = Math.min(interestPaid, 200000);
      normalIncomeImpact -= interestAllowed;
      properties.push({
        ...property,
        interest_allowed: interestAllowed,
        income_from_house_property: -interestAllowed
      });
      continue;
    }

    if (property.property_type === "let_out" && property.computed_loss !== undefined) {
      const computedLoss = toRupees(property.computed_loss);
      if (request.regime === "new") {
        warnings.push("WARN_HOUSE_PROPERTY_LOSS_SET_OFF_NOT_AVAILABLE_NEW_REGIME");
        properties.push({
          ...property,
          loss_setoff_against_other_heads: 0,
          loss_carry_forward: 0
        });
      } else {
        const setoff = Math.min(computedLoss, 200000);
        const carryForward = Math.max(0, computedLoss - setoff);
        normalIncomeImpact -= setoff;
        lossSetoffAgainstOtherHeads += setoff;
        lossCarryForward += carryForward;
        properties.push({
          ...property,
          loss_setoff_against_other_heads: setoff,
          loss_carry_forward: carryForward
        });
      }
      continue;
    }

    const incomeFromHouseProperty = toRupees(property.income_from_house_property ?? 0);
    normalIncomeImpact += incomeFromHouseProperty;
    properties.push({ ...property, income_from_house_property: incomeFromHouseProperty });
  }

  return {
    properties,
    normal_income_impact: normalIncomeImpact,
    loss_setoff_against_other_heads: lossSetoffAgainstOtherHeads,
    loss_carry_forward: lossCarryForward
  };
}

function calculateBusinessProfession(request, warnings, validation) {
  const summary = {};
  let normalIncome = 0;

  for (const business of request.income?.business_profession ?? []) {
    if (business.section === "44AD") {
      const result = calculate44ad(business, warnings, validation);
      summary["44AD"] = result;
      normalIncome += result.deemed_income;
      continue;
    }

    if (business.section === "44ADA") {
      const result = calculate44ada(business, warnings, validation);
      summary["44ADA"] = result;
      normalIncome += result.deemed_income;
      continue;
    }

    if (business.section === "44AE") {
      const result = calculate44ae(business, warnings, validation);
      summary["44AE"] = result;
      normalIncome += result.deemed_income;
      continue;
    }

    normalIncome += toRupees(business.net_income ?? 0);
    if (business.type) {
      summary[business.type] = { net_income: toRupees(business.net_income ?? 0) };
    }
  }

  return { summary, normal_income: normalIncome };
}

function calculate44ad(business, warnings, validation) {
  const turnover = toRupees(business.turnover ?? 0);
  const cashReceipts = toRupees(business.cash_receipts ?? 0);
  const digitalReceipts = toRupees(business.digital_receipts ?? Math.max(0, turnover - cashReceipts));
  const unclassifiedReceipts = Math.max(0, turnover - cashReceipts - digitalReceipts);
  const cashRatio = turnover > 0 ? cashReceipts / turnover : 0;
  const standardThresholdAvailable = turnover <= 20000000;
  const enhancedThresholdAvailable = turnover <= 30000000 && cashRatio <= 0.05;
  const deemedIncome = roundRupee((digitalReceipts * 0.06) + ((cashReceipts + unclassifiedReceipts) * 0.08));

  if (turnover > 30000000) {
    validation["44AD_turnover_exceeds_max_threshold"] =
      "Turnover exceeds the Rs. 3 crore enhanced 44AD threshold.";
    warnings.push("WARN_44AD_TURNOVER_LIMIT_EXCEEDED");
  } else if (!enhancedThresholdAvailable && turnover > 20000000) {
    validation["44AD_turnover_exceeds_standard_threshold"] =
      "Enhanced Rs. 3 crore threshold unavailable because cash receipts exceed 5 percent.";
    warnings.push("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE");
  }

  return {
    turnover,
    cash_receipts: cashReceipts,
    digital_receipts: digitalReceipts,
    cash_receipts_percent: roundRupee(cashRatio * 100),
    standard_threshold_available: standardThresholdAvailable,
    enhanced_threshold_available: enhancedThresholdAvailable,
    eligible_under_turnover_limit: standardThresholdAvailable || enhancedThresholdAvailable,
    deemed_income: deemedIncome
  };
}

function calculate44ada(business, warnings, validation) {
  const grossReceipts = toRupees(business.gross_receipts ?? 0);
  const cashReceipts = toRupees(business.cash_receipts ?? 0);
  const cashRatio = grossReceipts > 0 ? cashReceipts / grossReceipts : 0;
  const enhancedThresholdAvailable = grossReceipts <= 7500000 && cashRatio <= 0.05;
  const deemedIncome = roundRupee(grossReceipts * 0.5);

  if (!enhancedThresholdAvailable && grossReceipts > 5000000) {
    validation["44ADA_receipts_exceed_standard_threshold"] =
      "Enhanced Rs. 75 lakh threshold unavailable because cash receipts exceed 5 percent.";
    warnings.push("WARN_44ADA_ENHANCED_THRESHOLD_UNAVAILABLE");
  }

  return {
    gross_receipts: grossReceipts,
    cash_receipts: cashReceipts,
    cash_receipts_percent: roundRupee(cashRatio * 100),
    enhanced_threshold_available: enhancedThresholdAvailable,
    deemed_income: deemedIncome
  };
}

function calculate44ae(business, warnings, validation) {
  const monthlyDeemedIncome = toRupees(business.monthly_deemed_income ?? 7500);
  const vehicles = business.vehicles ?? Array.from(
    { length: business.vehicle_count ?? 0 },
    () => ({ months_owned: business.months_owned ?? 12 })
  );
  const vehicleCount = business.vehicle_count ?? vehicles.length;
  const deemedIncome = vehicles.reduce((total, vehicle) => {
    const monthsOwned = Math.min(12, Math.max(0, toRupees(vehicle.months_owned ?? 12)));
    return total + (monthsOwned * monthlyDeemedIncome);
  }, 0);

  if (vehicleCount > 10) {
    validation["44AE_vehicle_limit_exceeded"] = true;
    warnings.push("WARN_44AE_VEHICLE_LIMIT_EXCEEDED");
  }

  return {
    vehicle_count: vehicleCount,
    monthly_deemed_income: monthlyDeemedIncome,
    deemed_income: roundRupee(deemedIncome),
    eligible_vehicle_limit: vehicleCount <= 10
  };
}

function calculateOtherSources(request) {
  const items = request.income?.other_sources ?? [];
  return {
    normal_income: items.reduce((total, item) => total + toRupees(item.amount ?? 0), 0),
    items
  };
}

function calculateCapitalGains(request, normalIncomeBeforeDeductions, warnings) {
  const capitalGains = [];
  const specialRateTax = {};
  const basicExemptionAdjustment = {
    applied: false,
    available_amount: 0
  };
  let grossSpecialIncome = 0;
  let totalSpecialTaxBeforeCess = 0;
  let remainingBasicExemption = 0;

  if (request.regime === "old" && request.residency === "resident") {
    remainingBasicExemption = Math.max(0, basicExemptionLimit(request) - Math.max(0, normalIncomeBeforeDeductions));
  } else if (request.regime === "old" && request.residency !== "resident" && hasAdjustableSpecialCapitalGain(request)) {
    warnings.push("WARN_BASIC_EXEMPTION_ADJUSTMENT_NOT_AVAILABLE");
  }

  for (const gain of request.income?.capital_gains ?? []) {
    const section = gain.section;
    const netGain = toRupees(gain.net_gain ?? gain.gain_without_indexation ?? 0);
    grossSpecialIncome += Math.max(0, netGain);

    if (netGain <= 0) {
      capitalGains.push({
        ...gain,
        classification: classifyCapitalGainSection(section),
        tax_rate_type: "loss_or_nil"
      });
      continue;
    }

    if (section === "111A") {
      const rate = isBeforeCapitalGainsRateChange(gain.transfer_date) ? 0.15 : 0.2;
      const adjustment = consumeBasicExemption(netGain, remainingBasicExemption);
      remainingBasicExemption = adjustment.remaining_exemption;
      if (adjustment.applied_amount > 0) {
        basicExemptionAdjustment.applied = true;
        basicExemptionAdjustment.available_amount += adjustment.applied_amount;
      }
      const taxableAfterAdjustment = adjustment.taxable_amount;
      const taxBeforeCess = roundRupee(taxableAfterAdjustment * rate);
      totalSpecialTaxBeforeCess += taxBeforeCess;
      specialRateTax["111A"] = {
        rate,
        taxable_gain: netGain,
        taxable_after_basic_exemption_adjustment: taxableAfterAdjustment,
        tax_before_cess: taxBeforeCess
      };
      capitalGains.push({ ...gain, classification: "short_term", tax_rate_type: "special_rate" });
      continue;
    }

    if (section === "112A") {
      const beforeChange = isBeforeCapitalGainsRateChange(gain.transfer_date);
      const rate = beforeChange ? 0.1 : 0.125;
      const exemptionThreshold = beforeChange ? 100000 : 125000;
      const taxableGain = Math.max(0, netGain - exemptionThreshold);
      const taxBeforeCess = roundRupee(taxableGain * rate);
      totalSpecialTaxBeforeCess += taxBeforeCess;
      specialRateTax["112A"] = {
        rate,
        exemption_threshold: exemptionThreshold,
        taxable_gain: taxableGain,
        tax_before_cess: taxBeforeCess
      };
      if (beforeChange) {
        specialRateTax["112A"].threshold_requires_domain_signoff = true;
        warnings.push("WARN_112A_PRE_2024_07_23_THRESHOLD_REVIEW");
      }
      if (request.regime === "new" && request.residency === "resident" && normalIncomeBeforeDeductions > 0 && taxBeforeCess > 0) {
        warnings.push("WARN_REBATE_SPECIAL_RATE_LIMIT");
      }
      capitalGains.push({ ...gain, classification: "long_term", tax_rate_type: "special_rate" });
      continue;
    }

    if (section === "112") {
      const result = calculateSection112Tax(gain);
      totalSpecialTaxBeforeCess += result.tax_before_cess;
      specialRateTax["112"] = result;
      capitalGains.push({ ...gain, classification: "long_term", tax_rate_type: "special_rate" });
      continue;
    }

    if (section === "50AA") {
      capitalGains.push({ ...gain, classification: "short_term", tax_rate_type: "applicable_rate" });
      continue;
    }

    capitalGains.push({ ...gain, classification: "unclassified", tax_rate_type: "manual_review" });
  }

  return {
    capital_gains: capitalGains,
    special_rate_tax: specialRateTax,
    total_special_tax_before_cess: totalSpecialTaxBeforeCess,
    gross_special_income: grossSpecialIncome,
    basic_exemption_adjustment: basicExemptionAdjustment
  };
}

function calculateSection112Tax(gain) {
  if (gain.gain_without_indexation !== undefined && gain.gain_with_indexation !== undefined) {
    const newLawTax = roundRupee(toRupees(gain.gain_without_indexation) * 0.125);
    const oldLawIndexedTax = roundRupee(toRupees(gain.gain_with_indexation) * 0.2);
    const finalTaxBeforeCess = Math.min(newLawTax, oldLawIndexedTax);
    return {
      rate: 0.125,
      new_law_tax: newLawTax,
      old_law_indexed_tax: oldLawIndexedTax,
      final_tax_before_cess: finalTaxBeforeCess,
      tax_before_cess: finalTaxBeforeCess
    };
  }

  const taxableGain = toRupees(gain.net_gain ?? 0);
  return {
    rate: isBeforeCapitalGainsRateChange(gain.transfer_date) ? 0.2 : 0.125,
    taxable_gain: taxableGain,
    tax_before_cess: roundRupee(taxableGain * (isBeforeCapitalGainsRateChange(gain.transfer_date) ? 0.2 : 0.125))
  };
}

function classifyCapitalGainSection(section) {
  if (["111A", "50AA"].includes(section)) return "short_term";
  if (["112", "112A"].includes(section)) return "long_term";
  return "unclassified";
}

function consumeBasicExemption(amount, availableExemption) {
  const appliedAmount = Math.min(amount, availableExemption);
  return {
    applied_amount: appliedAmount,
    taxable_amount: Math.max(0, amount - appliedAmount),
    remaining_exemption: Math.max(0, availableExemption - appliedAmount)
  };
}

function hasAdjustableSpecialCapitalGain(request) {
  return (request.income?.capital_gains ?? []).some((gain) => ["111A", "112"].includes(gain.section));
}

function calculateChapterViaDeductions(request, warnings, validation, context = {}) {
  const deductions = request.deductions?.chapter_via ?? [];
  if (request.regime === "new") {
    const attempted = deductions.filter((deduction) => hasPositiveDeductionClaim(deduction));
    if (attempted.length) {
      warnings.push("WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME");
    }
    return { total: 0, details: {} };
  }

  const details = {};
  let total = 0;
  const sections = new Set(deductions.map((deduction) => deduction.section));
  const housingLoanDoubleClaim = sections.has("80EE") && sections.has("80EEA");
  if (sections.has("80EE") && sections.has("80EEA")) {
    validation["80ee_80eea_double_claim"] = true;
    warnings.push("WARN_80EE_80EEA_MUTUAL_EXCLUSION");
  }

  const family80cClaims = deductions
    .filter((deduction) => ["80C", "80CCC", "80CCD(1)"].includes(deduction.section))
    .map((deduction) => ({ section: deduction.section, claimed: toRupees(deduction.amount ?? 0) }));
  if (family80cClaims.length) {
    const claimed = family80cClaims.reduce((sum, deduction) => sum + deduction.claimed, 0);
    const allowed = Math.min(claimed, SUPPORTED_CHAPTER_VIA_CAPS["80C_FAMILY"]);
    if (claimed > allowed) {
      warnings.push("WARN_80C_CAP_APPLIED");
    }
    details["80C"] = { claimed, allowed, components: family80cClaims };
    total += allowed;
  }

  for (const deduction of deductions) {
    if (["80C", "80CCC", "80CCD(1)"].includes(deduction.section)) continue;

    if (deduction.section === "80D") {
      const result = calculate80d(deduction, warnings);
      const current = details["80D"] ?? { self_family_allowed: 0, parents_allowed: 0, total_allowed: 0 };
      if (deduction.bucket === "parents") {
        current.parents_allowed += result.allowed;
      } else {
        current.self_family_allowed += result.allowed;
      }
      current.total_allowed += result.allowed;
      details["80D"] = current;
      total += result.allowed;
      continue;
    }

    if (deduction.section === "80CCD(1B)") {
      const claimed = toRupees(deduction.amount ?? 0);
      const allowed = Math.min(claimed, SUPPORTED_CHAPTER_VIA_CAPS["80CCD(1B)"]);
      details["80CCD(1B)"] = { claimed, allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80CCD(2)") {
      const claimed = toRupees(deduction.employer_contribution ?? deduction.amount ?? 0);
      const eligibleSalary = toRupees(deduction.eligible_salary ?? deduction.basic_salary ?? context.salaryForDeductions ?? 0);
      const capRate = deduction.employer_type === "government" ? 0.14 : 0.1;
      const cap = roundRupee(eligibleSalary * capRate);
      const allowed = cap > 0 ? Math.min(claimed, cap) : claimed;
      details["80CCD(2)"] = { claimed, cap, allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80GG") {
      const result = calculate80gg(deduction, context);
      details["80GG"] = result;
      total += result.allowed;
      continue;
    }

    if (["80EE", "80EEA"].includes(deduction.section)) {
      const claimed = toRupees(deduction.amount ?? 0);
      const allowed = housingLoanDoubleClaim ? 0 : Math.min(claimed, SUPPORTED_CHAPTER_VIA_CAPS[deduction.section]);
      details[deduction.section] = { claimed, allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80DD") {
      const severe = deduction.disability_severity === "severe" || toRupees(deduction.disability_percent ?? 0) >= 80;
      const allowed = severe ? 125000 : 75000;
      details["80DD"] = { severity: severe ? "severe" : "standard", allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80DDB") {
      const claimed = toRupees(deduction.medical_treatment_paid ?? deduction.amount ?? 0);
      const reimbursement = toRupees(deduction.reimbursement ?? 0);
      const cap = deduction.senior ? 100000 : 40000;
      const allowed = Math.min(Math.max(0, claimed - reimbursement), cap);
      details["80DDB"] = { claimed, reimbursement, cap, allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80E") {
      const allowed = toRupees(deduction.interest_paid ?? deduction.amount ?? 0);
      details["80E"] = { allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80TTA") {
      const allowed = Math.min(toRupees(deduction.amount ?? 0), 10000);
      details["80TTA"] = { claimed: toRupees(deduction.amount ?? 0), allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80TTB") {
      const scoped = request.residency === "resident" && request.age_years >= 60;
      const allowed = scoped ? Math.min(toRupees(deduction.amount ?? 0), 50000) : 0;
      if (!scoped) {
        validation["80TTB_resident_senior_required"] = true;
        warnings.push("WARN_80TTB_RESIDENT_SENIOR_REQUIRED");
      }
      details["80TTB"] = { claimed: toRupees(deduction.amount ?? 0), allowed };
      total += allowed;
      continue;
    }

    if (deduction.section === "80G") {
      const claimed = toRupees(deduction.amount ?? 0);
      const cashRestricted = deduction.payment_mode === "cash" && claimed > 2000;
      const qualifyingPercent = deduction.qualifying_percent ?? 1;
      const allowed = cashRestricted ? 0 : roundRupee(claimed * qualifyingPercent);
      if (cashRestricted) {
        validation["80G_cash_limit_applied"] = true;
        warnings.push("WARN_80G_CASH_LIMIT_APPLIED");
      }
      details["80G"] = { claimed, payment_mode: deduction.payment_mode ?? "non_cash", allowed };
      total += allowed;
      continue;
    }

    warnings.push(`WARN_UNSUPPORTED_DEDUCTION_${deduction.section}`);
  }

  return { total, details };
}

function calculate80d(deduction, warnings) {
  const claimed = toRupees(deduction.premium ?? 0) + toRupees(deduction.preventive_checkup ?? 0);
  const cap = deduction.senior ? 50000 : 25000;
  const allowed = Math.min(claimed, cap);
  if (toRupees(deduction.preventive_checkup ?? 0) > 0 && claimed > allowed) {
    warnings.push("WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP");
  }
  return { claimed, allowed };
}

function calculate80gg(deduction, context) {
  const specifiedTotalIncome = toRupees(deduction.specified_total_income ?? context.normalIncomeBeforeDeductions ?? 0);
  const rentPaid = toRupees(deduction.rent_paid ?? 0);
  const rentMinusTenPercentTotalIncome = Math.max(0, rentPaid - (specifiedTotalIncome * 0.1));
  const monthlyCap = 5000 * 12;
  const twentyFivePercentTotalIncome = specifiedTotalIncome * 0.25;
  const allowed = roundRupee(Math.min(rentMinusTenPercentTotalIncome, monthlyCap, twentyFivePercentTotalIncome));

  return {
    rent_minus_10_percent_total_income: roundRupee(rentMinusTenPercentTotalIncome),
    monthly_cap: monthlyCap,
    twenty_five_percent_total_income: roundRupee(twentyFivePercentTotalIncome),
    allowed
  };
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

function basicExemptionLimit(request) {
  if (request.regime === "new") {
    return request.period === "2026-27" ? 400000 : 300000;
  }
  if (request.residency === "resident" && request.age_years >= 80) return 500000;
  if (request.residency === "resident" && request.age_years >= 60) return 300000;
  return 250000;
}

function isBeforeCapitalGainsRateChange(transferDate) {
  return Boolean(transferDate) && transferDate < CAPITAL_GAINS_RATE_CHANGE_DATE;
}

function recommendItr(request) {
  const businesses = request.income?.business_profession ?? [];
  if (businesses.some((business) => ["44AD", "44ADA", "44AE"].includes(business.section))) return "ITR-4";
  if (businesses.length > 0) return "ITR-3";
  if ((request.income?.capital_gains ?? []).length > 0) return "ITR-2";
  return "ITR-1";
}

function computeCaseSet(request) {
  const cases = {};
  const warnings = [];

  for (const testCase of request.cases) {
    const deductions = {};
    const validation = {};

    if (testCase.interest) {
      const savingsInterest = toRupees(testCase.interest.savings ?? 0);
      const depositInterest = toRupees(testCase.interest.deposit ?? 0);
      if (testCase.residency === "resident" && testCase.age_years >= 60) {
        deductions["80TTB"] = {
          claimed: savingsInterest + depositInterest,
          allowed: Math.min(savingsInterest + depositInterest, 50000)
        };
      } else {
        deductions["80TTA"] = {
          claimed: savingsInterest,
          allowed: Math.min(savingsInterest, 10000)
        };
      }
    }

    if (testCase.advance_tax_paid_by_dates) {
      const businessItems = testCase.business_profession ?? [];
      const presumptive = businessItems.some((business) => ["44AD", "44ADA", "44AE"].includes(business.section));
      validation.advance_tax_schedule = presumptive
        ? "single_100_percent_by_15_march"
        : "quarterly_15_45_75_100";
      if (!presumptive && Object.values(testCase.advance_tax_paid_by_dates).every((amount) => toRupees(amount) === 0)) {
        warnings.push("WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE");
      }
    }

    cases[testCase.case_id] = {
      status: "ok",
      summary: { deductions },
      validation
    };
  }

  return {
    status: "ok",
    period_type: request.period_type,
    period: request.period,
    cases,
    warnings: [...new Set(warnings)]
  };
}

function attachStructuredValidation(request, response) {
  if (!request.options?.include_validation) {
    return response;
  }

  const validationReport = validateTaxRequest(request);
  response.validation_results = validationReport.results;
  response.validation_summary = validationReport.summary;
  response.validation_status = validationReport.status;
  response.warnings = [...new Set([...(response.warnings ?? []), ...validationReport.warnings])];
  return response;
}

function calculateTaxCredits(taxCredits = {}) {
  return toRupees(taxCredits.tds ?? 0) +
    toRupees(taxCredits.tcs ?? 0) +
    toRupees(taxCredits.advance_tax ?? 0) +
    toRupees(taxCredits.self_assessment_tax ?? 0);
}

function buildExplanation(request, summary) {
  const lines = [
    `Gross total income is Rs. ${summary.gross_total_income}.`,
    `Standard deduction allowed is Rs. ${summary.standard_deduction}.`,
    `Total income after deductions is Rs. ${summary.total_income}.`,
    `Normal slab tax before rebate is Rs. ${summary.tax_before_rebate}.`
  ];

  if (summary.rebate_87a > 0) {
    lines.push(`Section 87A rebate allowed is Rs. ${summary.rebate_87a}.`);
  }

  lines.push(`Health and education cess is Rs. ${summary.cess}.`);
  lines.push(`Net tax liability under the ${request.regime} regime is Rs. ${summary.net_tax_liability}.`);
  return lines;
}

function resolveAgeBand(request) {
  if (request.taxpayer_type === "huf") return "not_applicable";
  if (request.residency !== "resident") return "ordinary";
  if (request.age_years >= 80) return "super_senior";
  if (request.age_years >= 60) return "senior";
  return "ordinary";
}

function assertSupportedRequest(request) {
  if (!["assessment_year", "tax_year"].includes(request.period_type)) {
    throw new Error("Unsupported period_type.");
  }
  if (!["individual", "huf"].includes(request.taxpayer_type)) {
    throw new Error("This calculation currently supports only individual and HUF taxpayers.");
  }
  if (!["old", "new"].includes(request.regime)) {
    throw new Error("Unsupported tax regime.");
  }
  if (!Number.isFinite(request.age_years) || request.age_years < 0) {
    throw new Error("age_years must be a non-negative number.");
  }
}
