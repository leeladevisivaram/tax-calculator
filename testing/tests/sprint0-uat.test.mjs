import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";
import { validateRulepack as runtimeValidateRulepack } from "../../src/rulepack-loader.mjs";

const ruleSchema = await readJson("../../sprint-zero/rule-schema.schema.json");
const supportedProvisions = await readJson("../../sprint-zero/v1-supported-provisions.json");
const goldenVectors = await readJson("../../sprint-zero/golden-test-vectors.json");
const sourceRegister = await readJson("../../sprint-zero/source-register.json");
const rulepack2026 = await readJson("../../data/rulepacks/ay-2026-27-v1.json");

const sourceIds = new Set(sourceRegister.sources.map((source) => source.source_id));
const requiredRulepackFields = ruleSchema.required;
const requiredRuleFields = ruleSchema.$defs.rule.required;
const allowedPeriodTypes = new Set(ruleSchema.properties.period_type.enum);
const allowedActs = new Set(ruleSchema.properties.act.enum);
const allowedRulepackStatuses = new Set(ruleSchema.properties.status.enum);
const allowedRuleTypes = new Set(ruleSchema.$defs.rule.properties.rule_type.enum);
const allowedRuleStatuses = new Set(ruleSchema.$defs.rule.properties.status.enum);
const allowedSourceConfidences = new Set(["primary", "primary_with_note", "secondary", "requires_manual_review"]);
const allowedProvisionDecisions = new Set([
  "supported",
  "supported_with_guardrails",
  "supported_as_warnings",
  "supported_summary",
  "supported_core",
  "excluded_v1"
]);

describe("Sprint 0 UAT: Machine-Readable Rule Schema", () => {
  it("TC-S0-001 rejects missing mandatory rulepack identity fields", () => {
    const invalid = clone(rulepack2026);
    delete invalid.rulepack_id;
    delete invalid.period;
    delete invalid.status;

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /missing required field rulepack_id/);
    assertHasError(errors, /missing required field period/);
    assertHasError(errors, /missing required field status/);
  });

  it("TC-S0-002 accepts a valid rulepack identity", () => {
    const errors = validateRulepackArtifact(rulepack2026);

    assert.deepEqual(errors, []);
    assert.equal(rulepack2026.rulepack_id, "ay-2026-27-v1");
    assert.equal(rulepack2026.period, "2026-27");
    assert.equal(rulepack2026.status, "active");
  });

  it("TC-S0-003 rejects unsupported period type values", () => {
    const invalid = clone(rulepack2026);
    invalid.period_type = "financial_year";

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /invalid period_type financial_year/);
  });

  it("TC-S0-004 rejects unsupported taxpayer selector values in rule applicability", () => {
    const invalid = clone(rulepack2026);
    invalid.rules[0].applies_to.taxpayer_type = ["company"];

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /invalid applies_to\.taxpayer_type company/);
  });

  it("TC-S0-005 accepts old and new regimes and rejects unsupported regimes", () => {
    assert.deepEqual(validateRulepackArtifact(rulepack2026), []);

    const invalid = clone(rulepack2026);
    invalid.rules[0].applies_to.regime = ["hybrid"];

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /invalid applies_to\.regime hybrid/);
  });

  it("TC-S0-006 validates income-head mapping values without silent fallback", () => {
    const incomeHeadEnum = ruleSchema.$defs.rule.properties.applies_to.properties.income_head.items.enum;

    assert.ok(incomeHeadEnum.includes("salary"));
    assert.ok(incomeHeadEnum.includes("house_property"));
    assert.ok(incomeHeadEnum.includes("capital_gains"));
    assert.ok(incomeHeadEnum.includes("business_profession"));

    const invalid = clone(rulepack2026);
    invalid.rules[0].applies_to.income_head = ["freelance"];

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /invalid applies_to\.income_head freelance/);
  });

  it("TC-S0-007 validates rule entity completeness for active rule records", () => {
    const invalid = clone(rulepack2026);
    delete invalid.rules[0].calculation;

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /missing required rule field calculation/);
    assert.equal(validateRulepackArtifact(rulepack2026).length, 0);
  });

  it("TC-S0-008 rejects duplicate stable rule IDs", () => {
    const invalid = clone(rulepack2026);
    invalid.rules.push({ ...clone(invalid.rules[0]) });

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /duplicate rule_id slab\.new\.ay2026\.individual_huf/);
  });

  it("TC-S0-009 rejects rules that do not reference official sources", () => {
    const invalid = clone(rulepack2026);
    invalid.rules[0].sources = [];

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /must reference at least one source/);
  });

  it("TC-S0-010 rejects invalid effective date ranges", () => {
    const invalid = clone(rulepack2026);
    invalid.effective_from = "2026-04-01";
    invalid.effective_to = "2025-03-31";
    invalid.rules[0].effective_from = "2026-04-01";
    invalid.rules[0].effective_to = "2025-03-31";

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /rulepack effective_from must not be after effective_to/);
    assertHasError(errors, /effective_from must not be after effective_to/);
  });

  it("TC-S0-011 preserves paise-safe precision and deterministic final rupee output", async () => {
    const result = await computeTax(vector("TV-002").input);

    assert.equal(rulepack2026.rounding.internal_precision, "paise");
    assert.equal(rulepack2026.rounding.display_precision, "rupee");
    assert.equal(result.summary.tax_after_marginal_relief_before_cess, 5000);
    assert.equal(result.summary.cess, 200);
    assert.equal(result.summary.net_tax_liability, 5200);
  });

  it("TC-S0-012 validates a large rulepack artifact within the UAT threshold", () => {
    const large = clone(rulepack2026);
    large.rules = Array.from({ length: 2000 }, (_, index) => ({
      ...clone(rulepack2026.rules[index % rulepack2026.rules.length]),
      rule_id: `${rulepack2026.rules[index % rulepack2026.rules.length].rule_id}.perf${index}`
    }));

    const startedAt = performance.now();
    const errors = validateRulepackArtifact(large);
    const elapsedMs = performance.now() - startedAt;

    assert.deepEqual(errors, []);
    assert.ok(elapsedMs < 1000, `large rulepack validation took ${elapsedMs}ms`);
  });

  it("TC-S0-013 fails closed for an unknown future rule type", () => {
    const invalid = clone(rulepack2026);
    invalid.rules[0].rule_type = "crypto_tax";

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /unsupported rule_type crypto_tax/);
  });

  it("TC-S0-014 validates the AY 2026-27 seed fixture with runtime and UAT validators", () => {
    assert.equal(runtimeValidateRulepack(rulepack2026), rulepack2026);
    assert.deepEqual(validateRulepackArtifact(rulepack2026), []);
  });
});

describe("Sprint 0 UAT: V1 Supported Provision Sign-Off", () => {
  it("TC-S0-015 accepts only approved provision status values", () => {
    assert.deepEqual(validateProvisionArtifact(supportedProvisions), []);

    const invalid = clone(supportedProvisions);
    invalid.decisions[0].v1_decision = "maybe_later";

    const errors = validateProvisionArtifact(invalid);

    assertHasError(errors, /invalid v1_decision maybe_later/);
  });

  it("TC-S0-016 blocks implementation readiness when an approval owner or reviewer is missing", () => {
    const approvedButIncomplete = clone(supportedProvisions);
    approvedButIncomplete.signoff.product.status = "approved";
    approvedButIncomplete.signoff.product.owner = "";
    approvedButIncomplete.signoff.product.date = "2026-05-08";

    const readiness = evaluateProvisionImplementationReadiness(approvedButIncomplete);

    assert.equal(readiness.ready, false);
    assertHasError(readiness.blockers, /product owner is required/);
  });

  it("TC-S0-017 keeps NRI and DTAA outside v1 with an explicit fail-closed message", () => {
    const nriProvision = provision("nri.dtaa");

    assert.equal(nriProvision.v1_decision, "excluded_v1");
    assert.match(nriProvision.fail_closed_message, /outside v1 supported scope/i);
  });

  it("TC-S0-018 blocks GST from the direct-tax v1 scope", () => {
    const gstProvision = provision("gst.calculation");

    assert.equal(gstProvision.v1_decision, "excluded_v1");
    assert.match(gstProvision.fail_closed_message, /GST is outside direct-tax v1 scope/);
  });

  it("TC-S0-019 blocks supported provisions that lack source evidence", () => {
    const invalid = clone(supportedProvisions);
    invalid.decisions[0].source_ids = [];

    const errors = validateProvisionArtifact(invalid);

    assertHasError(errors, /period\.selector\.ay_ty supported provision requires source evidence/);
  });

  it("TC-S0-020 requires product, tax-domain, and engineering approvals before implementation readiness", () => {
    const readiness = evaluateProvisionImplementationReadiness(supportedProvisions);

    assert.equal(readiness.ready, false);
    assertHasError(readiness.blockers, /product approval is pending/);
    assertHasError(readiness.blockers, /tax_domain approval is pending/);
    assertHasError(readiness.blockers, /engineering approval is pending/);
  });

  it("TC-S0-021 blocks ambiguous provisions unless manual decision notes are documented", () => {
    const invalid = clone(supportedProvisions);
    const rebate = invalid.decisions.find((decision) => decision.provision_id === "rebate.87a");
    rebate.domain_review_required = true;
    delete rebate.notes;

    const errors = validateProvisionArtifact(invalid);

    assertHasError(errors, /rebate\.87a requires manual decision notes/);
  });
});

describe("Sprint 0 UAT: Golden Test Vectors", () => {
  it("TC-S0-022 rejects malformed golden vector definitions", () => {
    assert.deepEqual(validateGoldenVectors(goldenVectors), []);

    const invalid = clone(goldenVectors);
    delete invalid.vectors[0].expected.assertions;

    const errors = validateGoldenVectors(invalid);

    assertHasError(errors, /TV-001 expected\.assertions must be a non-empty array/);
  });

  it("TC-S0-023 executes TV-001 and returns zero net tax", async () => {
    const result = await computeTax(vector("TV-001").input);

    assert.equal(result.summary.net_tax_liability, 0);
    assertGoldenAssertions(result, vector("TV-001"));
  });

  it("TC-S0-024 executes TV-002 and applies marginal relief plus cess", async () => {
    const result = await computeTax(vector("TV-002").input);

    assert.equal(result.summary.tax_after_marginal_relief_before_cess, 5000);
    assert.equal(result.summary.cess, 200);
    assertGoldenAssertions(result, vector("TV-002"));
  });

  it("TC-S0-025 blocks unsupported taxpayer type inputs before computation", () => {
    const report = validateTaxRequest({
      ...vector("TV-001").input,
      taxpayer_type: "company"
    });

    assert.equal(report.status, "blocked");
    assert.ok(report.results.some((result) => result.code === "VAL_TAXPAYER_TYPE_UNSUPPORTED"));
  });

  it("TC-S0-026 executes TV-003 and TV-004 regime/year rebate vectors", async () => {
    for (const id of ["TV-003", "TV-004"]) {
      const result = await computeTax(vector(id).input);

      assert.equal(result.summary.net_tax_liability, 0, `${id} should reduce tax to zero`);
      assertGoldenAssertions(result, vector(id));
    }
  });

  it("TC-S0-027 selects the correct capital-gains rates around 23 Jul 2024", async () => {
    for (const id of ["TV-006", "TV-007", "TV-008", "TV-009"]) {
      const result = await computeTax(vector(id).input);

      assertGoldenAssertions(result, vector(id));
    }
  });

  it("TC-S0-028 applies 44AD threshold and warning behavior from golden vectors", async () => {
    const eligible = await computeTax(vector("TV-026").input);
    const overCashLimit = await computeTax(vector("TV-027").input);

    assert.equal(eligible.summary.business_profession["44AD"].deemed_income, 1520000);
    assertGoldenAssertions(eligible, vector("TV-026"));
    assert.ok(overCashLimit.warnings.includes("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE"));
    assertGoldenAssertions(overCashLimit, vector("TV-027"));
  });

  it("TC-S0-029 runs every Sprint 0 golden vector with 100 percent pass requirement", async () => {
    for (const testVector of goldenVectors.vectors) {
      const result = await computeTax(testVector.input);

      assertGoldenAssertions(result, testVector);
      assert.deepEqual(new Set(result.warnings), new Set(testVector.expected.warnings), `${testVector.id} warnings`);
    }
  });

  it("TC-S0-030 rounds the boundary marginal-relief vector deterministically", async () => {
    const result = await computeTax(vector("TV-002").input);

    assert.equal(Number.isInteger(result.summary.cess), true);
    assert.equal(result.summary.cess, 200);
    assert.equal(result.summary.net_tax_liability, 5200);
  });
});

describe("Sprint 0 UAT: Source Register", () => {
  it("TC-S0-031 rejects duplicate source IDs", () => {
    const invalid = clone(sourceRegister);
    invalid.sources.push({ ...clone(invalid.sources[0]) });

    const errors = validateSourceRegister(invalid);

    assertHasError(errors, /duplicate source_id SRC-TRANSITION-2026/);
  });

  it("TC-S0-032 rejects invalid source confidence values", () => {
    const invalid = clone(sourceRegister);
    invalid.sources[0].confidence = "blog_guess";

    const errors = validateSourceRegister(invalid);

    assertHasError(errors, /invalid confidence blog_guess/);
  });

  it("TC-S0-033 rejects rules that reference unknown source IDs", () => {
    const invalid = clone(rulepack2026);
    invalid.rules[0].sources = ["SRC-DOES-NOT-EXIST"];

    const errors = validateRulepackArtifact(invalid);

    assertHasError(errors, /unknown source_id SRC-DOES-NOT-EXIST/);
  });

  it("TC-S0-034 requires source-register retrieval metadata", () => {
    const invalid = clone(sourceRegister);
    delete invalid.retrieved_on;

    const errors = validateSourceRegister(invalid);

    assertHasError(errors, /retrieved_on is required/);
  });

  it("TC-S0-035 reports source effective-period coverage mismatches", () => {
    const narrowedRegister = clone(sourceRegister);
    narrowedRegister.sources[0].effective_periods = ["2025-26"];
    const narrowedRulepack = clone(rulepack2026);
    narrowedRulepack.rules[0].sources = [narrowedRegister.sources[0].source_id];

    const errors = validateRulepackArtifact(narrowedRulepack, {
      knownSourceIds: new Set(narrowedRegister.sources.map((source) => source.source_id)),
      sourceById: new Map(narrowedRegister.sources.map((source) => [source.source_id, source]))
    });

    assertHasError(errors, /source SRC-TRANSITION-2026 does not cover period 2026-27/);
  });

  it("TC-S0-036 requires contradiction or ambiguity notes before activation", () => {
    assert.deepEqual(validateSourceRegister(sourceRegister), []);

    const invalid = clone(sourceRegister);
    const ambiguous = invalid.sources.find((source) => source.confidence === "primary_with_note");
    delete ambiguous.notes;

    const errors = validateSourceRegister(invalid);

    assertHasError(errors, /primary_with_note source .* requires notes/);
  });
});

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateRulepackArtifact(rulepack, options = {}) {
  const knownSourceIds = options.knownSourceIds ?? sourceIds;
  const sourceById = options.sourceById ?? new Map(sourceRegister.sources.map((source) => [source.source_id, source]));
  const errors = [];

  for (const field of requiredRulepackFields) {
    if (!(field in rulepack)) errors.push(`missing required field ${field}`);
  }

  if (!allowedPeriodTypes.has(rulepack.period_type)) {
    errors.push(`invalid period_type ${rulepack.period_type}`);
  }
  if (typeof rulepack.period !== "string" || !/^[0-9]{4}-[0-9]{2}$/.test(rulepack.period ?? "")) {
    errors.push(`invalid period ${rulepack.period}`);
  }
  if (!allowedActs.has(rulepack.act)) {
    errors.push(`invalid act ${rulepack.act}`);
  }
  if (!allowedRulepackStatuses.has(rulepack.status)) {
    errors.push(`invalid status ${rulepack.status}`);
  }
  if (rulepack.currency !== "INR") {
    errors.push(`invalid currency ${rulepack.currency}`);
  }
  if (rulepack.effective_from && rulepack.effective_to && rulepack.effective_from > rulepack.effective_to) {
    errors.push("rulepack effective_from must not be after effective_to");
  }

  validateRounding(rulepack.rounding, errors);

  if (!Array.isArray(rulepack.rules) || rulepack.rules.length === 0) {
    errors.push("rules must be a non-empty array");
    return errors;
  }

  const seenRuleIds = new Set();
  for (const rule of rulepack.rules) {
    for (const field of requiredRuleFields) {
      if (!(field in rule)) errors.push(`${rule.rule_id ?? "unknown rule"} missing required rule field ${field}`);
    }

    if (seenRuleIds.has(rule.rule_id)) {
      errors.push(`duplicate rule_id ${rule.rule_id}`);
    }
    seenRuleIds.add(rule.rule_id);

    if (!allowedRuleTypes.has(rule.rule_type)) {
      errors.push(`unsupported rule_type ${rule.rule_type}`);
    }
    if (!allowedRuleStatuses.has(rule.status)) {
      errors.push(`${rule.rule_id} invalid rule status ${rule.status}`);
    }
    if (rule.effective_from && rule.effective_to && rule.effective_from > rule.effective_to) {
      errors.push(`${rule.rule_id} effective_from must not be after effective_to`);
    }

    validateAppliesTo(rule, errors);

    if (!Array.isArray(rule.sources) || rule.sources.length === 0) {
      errors.push(`${rule.rule_id} must reference at least one source`);
    } else {
      for (const sourceId of rule.sources) {
        if (!knownSourceIds.has(sourceId)) {
          errors.push(`${rule.rule_id} references unknown source_id ${sourceId}`);
          continue;
        }

        const source = sourceById.get(sourceId);
        if (Array.isArray(source?.effective_periods) && !source.effective_periods.includes(rulepack.period)) {
          errors.push(`source ${sourceId} does not cover period ${rulepack.period}`);
        }
      }
    }
  }

  return errors;
}

function validateRounding(rounding, errors) {
  if (!rounding || typeof rounding !== "object") {
    errors.push("rounding is required");
    return;
  }

  if (rounding.internal_precision !== "paise") {
    errors.push("rounding.internal_precision must be paise");
  }
  if (rounding.display_precision !== "rupee") {
    errors.push("rounding.display_precision must be rupee");
  }
  if (!["nearest_rupee", "nearest_ten_rupees", "none"].includes(rounding.final_tax_rounding)) {
    errors.push(`invalid final_tax_rounding ${rounding.final_tax_rounding}`);
  }
}

function validateAppliesTo(rule, errors) {
  const allowedProperties = ruleSchema.$defs.rule.properties.applies_to.properties;
  for (const [key, allowedDefinition] of Object.entries(allowedProperties)) {
    const values = rule.applies_to?.[key];
    if (!values) continue;
    if (!Array.isArray(values)) {
      errors.push(`${rule.rule_id} applies_to.${key} must be an array`);
      continue;
    }
    const allowedValues = allowedDefinition.items?.enum;
    if (!allowedValues) continue;
    for (const value of values) {
      if (!allowedValues.includes(value)) {
        errors.push(`${rule.rule_id} invalid applies_to.${key} ${value}`);
      }
    }
  }
}

function validateProvisionArtifact(artifact) {
  const errors = [];

  if (!artifact.source_register_version) errors.push("source_register_version is required");
  if (!artifact.signoff) errors.push("signoff is required");
  if (!Array.isArray(artifact.decisions) || artifact.decisions.length === 0) {
    errors.push("decisions must be a non-empty array");
    return errors;
  }

  const seenProvisionIds = new Set();
  for (const decision of artifact.decisions) {
    for (const field of ["provision_id", "name", "v1_decision", "implementation_priority", "source_ids", "review_status"]) {
      if (!(field in decision)) errors.push(`${decision.provision_id ?? "unknown provision"} missing ${field}`);
    }

    if (seenProvisionIds.has(decision.provision_id)) {
      errors.push(`duplicate provision_id ${decision.provision_id}`);
    }
    seenProvisionIds.add(decision.provision_id);

    if (!allowedProvisionDecisions.has(decision.v1_decision)) {
      errors.push(`${decision.provision_id} invalid v1_decision ${decision.v1_decision}`);
    }
    if (decision.v1_decision !== "excluded_v1" && (!Array.isArray(decision.source_ids) || decision.source_ids.length === 0)) {
      errors.push(`${decision.provision_id} supported provision requires source evidence`);
    }
    for (const sourceId of decision.source_ids ?? []) {
      if (!sourceIds.has(sourceId)) {
        errors.push(`${decision.provision_id} references unknown source_id ${sourceId}`);
      }
    }
    if (decision.v1_decision === "excluded_v1" && !decision.fail_closed_message) {
      errors.push(`${decision.provision_id} excluded provision requires fail_closed_message`);
    }
    if (decision.domain_review_required && (!Array.isArray(decision.notes) || decision.notes.length === 0)) {
      errors.push(`${decision.provision_id} requires manual decision notes`);
    }
  }

  return errors;
}

function evaluateProvisionImplementationReadiness(artifact) {
  const blockers = [];
  for (const role of ["product", "tax_domain", "engineering"]) {
    const approval = artifact.signoff?.[role];
    if (!approval) {
      blockers.push(`${role} approval is missing`);
      continue;
    }
    if (approval.status !== "approved") {
      blockers.push(`${role} approval is pending`);
    }
    if (!approval.owner || approval.owner === "TBD") {
      blockers.push(`${role} owner is required`);
    }
    if (!approval.date) {
      blockers.push(`${role} approval date is required`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}

function validateGoldenVectors(artifact) {
  const errors = [];
  if (!Array.isArray(artifact.vectors) || artifact.vectors.length < 25 || artifact.vectors.length > 30) {
    errors.push("vectors must contain 25 to 30 cases");
    return errors;
  }

  const seenIds = new Set();
  for (const testVector of artifact.vectors) {
    for (const field of ["id", "status", "title", "rulepack_id", "source_ids", "input", "expected"]) {
      if (!(field in testVector)) errors.push(`${testVector.id ?? "unknown vector"} missing ${field}`);
    }
    if (seenIds.has(testVector.id)) {
      errors.push(`duplicate vector id ${testVector.id}`);
    }
    seenIds.add(testVector.id);

    if (!Array.isArray(testVector.source_ids) || testVector.source_ids.length === 0) {
      errors.push(`${testVector.id} requires source_ids`);
    }
    for (const sourceId of testVector.source_ids ?? []) {
      if (!sourceIds.has(sourceId)) errors.push(`${testVector.id} references unknown source_id ${sourceId}`);
    }
    if (!Array.isArray(testVector.expected?.assertions) || testVector.expected.assertions.length === 0) {
      errors.push(`${testVector.id} expected.assertions must be a non-empty array`);
    }
    if (!Array.isArray(testVector.expected?.warnings)) {
      errors.push(`${testVector.id} expected.warnings must be an array`);
    }
  }

  return errors;
}

function validateSourceRegister(register) {
  const errors = [];
  if (!register.source_register_version) errors.push("source_register_version is required");
  if (!register.retrieved_on) errors.push("retrieved_on is required");
  if (!Array.isArray(register.sources) || register.sources.length === 0) {
    errors.push("sources must be a non-empty array");
    return errors;
  }

  const seenIds = new Set();
  for (const source of register.sources) {
    for (const field of ["source_id", "title", "publisher", "url", "source_type", "confidence", "covers"]) {
      if (!(field in source)) errors.push(`${source.source_id ?? "unknown source"} missing ${field}`);
    }
    if (seenIds.has(source.source_id)) {
      errors.push(`duplicate source_id ${source.source_id}`);
    }
    seenIds.add(source.source_id);

    if (!allowedSourceConfidences.has(source.confidence)) {
      errors.push(`${source.source_id} invalid confidence ${source.confidence}`);
    }
    if (source.confidence === "primary_with_note" && (!Array.isArray(source.notes) || source.notes.length === 0)) {
      errors.push(`primary_with_note source ${source.source_id} requires notes`);
    }
    if (!Array.isArray(source.covers) || source.covers.length === 0) {
      errors.push(`${source.source_id} must document covered provisions`);
    }
  }

  return errors;
}

function provision(provisionId) {
  const found = supportedProvisions.decisions.find((decision) => decision.provision_id === provisionId);
  if (!found) throw new Error(`Missing provision ${provisionId}`);
  return found;
}

function vector(id) {
  const found = goldenVectors.vectors.find((testVector) => testVector.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

function assertGoldenAssertions(result, testVector) {
  for (const assertion of testVector.expected.assertions) {
    const actual = readPath(result, assertion.path);
    const label = `${testVector.id} ${assertion.path}`;

    if (assertion.operator === "equals" || assertion.operator === "caps_at" || assertion.operator === "disallowed") {
      assert.equal(actual, assertion.value, label);
      continue;
    }
    if (assertion.operator === "warning_contains") {
      assert.equal(typeof actual, "string", `${label} should be a string`);
      assert.ok(actual.includes(assertion.value), `${label} should contain ${assertion.value}`);
      continue;
    }
    if (assertion.operator === "chooses_lower_of") {
      const parent = readPath(result, assertion.path.split(".").slice(0, -1).join("."));
      const candidates = assertion.value.map((key) => parent[key]);
      assert.equal(actual, Math.min(...candidates), label);
      continue;
    }

    throw new Error(`Unsupported assertion operator: ${assertion.operator}`);
  }
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

function assertHasError(errors, pattern) {
  assert.ok(
    errors.some((error) => pattern.test(error)),
    `Expected one of ${JSON.stringify(errors)} to match ${pattern}`
  );
}
