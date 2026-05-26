import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rulepackDir = path.join(rootDir, "data", "rulepacks");

const requiredRulepackFields = [
  "rulepack_id",
  "period_type",
  "period",
  "act",
  "status",
  "currency",
  "rounding",
  "source_register_version",
  "rules"
];

const requiredRuleFields = ["rule_id", "rule_type", "status", "applies_to", "calculation", "sources"];

export class RulepackError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RulepackError";
    this.details = details;
  }
}

export async function listRulepackFiles() {
  const files = await readdir(rulepackDir);
  return files.filter((file) => file.endsWith(".json")).sort();
}

export async function loadAllRulepacks() {
  const files = await listRulepackFiles();
  return Promise.all(files.map((file) => loadRulepackFile(path.join(rulepackDir, file))));
}

export async function listSupportedPeriods() {
  const rulepacks = await loadAllRulepacks();
  return rulepacks
    .filter((rulepack) => rulepack.status === "active")
    .map(({ rulepack_id, period_type, period, act, status, source_register_version }) => ({
      rulepack_id,
      period_type,
      period,
      act,
      status,
      source_register_version
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export async function getRulepackForRequest(request) {
  const rulepacks = await loadAllRulepacks();
  const match = rulepacks.find(
    (rulepack) =>
      rulepack.status === "active" &&
      rulepack.period_type === request.period_type &&
      rulepack.period === request.period &&
      rulepack.act === request.act
  );

  if (!match) {
    throw new RulepackError("No active rulepack supports the requested period and act.", {
      period_type: request.period_type,
      period: request.period,
      act: request.act
    });
  }

  return match;
}

export function rulepackChecksum(rulepack) {
  return createHash("sha256").update(stableStringify(rulepack)).digest("hex");
}

export function validateRulepack(rulepack) {
  const missing = requiredRulepackFields.filter((field) => !(field in rulepack));
  if (missing.length) {
    throw new RulepackError("Rulepack is missing required fields.", { missing });
  }

  if (!Array.isArray(rulepack.rules) || rulepack.rules.length === 0) {
    throw new RulepackError("Rulepack must contain at least one rule.", {
      rulepack_id: rulepack.rulepack_id
    });
  }

  for (const rule of rulepack.rules) {
    const missingRuleFields = requiredRuleFields.filter((field) => !(field in rule));
    if (missingRuleFields.length) {
      throw new RulepackError("Rule is missing required fields.", {
        rulepack_id: rulepack.rulepack_id,
        rule_id: rule.rule_id,
        missing: missingRuleFields
      });
    }

    if (!Array.isArray(rule.sources) || rule.sources.length === 0) {
      throw new RulepackError("Rule must reference at least one source.", {
        rulepack_id: rulepack.rulepack_id,
        rule_id: rule.rule_id
      });
    }
  }

  return rulepack;
}

export function findRule(rulepack, ruleType, context = {}) {
  const matches = rulepack.rules.filter((rule) => rule.rule_type === ruleType && rule.status === "active" && appliesTo(rule, context));
  if (matches.length === 0) {
    throw new RulepackError(`No active ${ruleType} rule matches the request.`, {
      rulepack_id: rulepack.rulepack_id,
      context
    });
  }
  if (matches.length > 1) {
    throw new RulepackError(`Multiple active ${ruleType} rules match the request.`, {
      rulepack_id: rulepack.rulepack_id,
      rule_ids: matches.map((rule) => rule.rule_id),
      context
    });
  }
  return matches[0];
}

export function findOptionalRule(rulepack, ruleType, context = {}) {
  const matches = rulepack.rules.filter((rule) => rule.rule_type === ruleType && rule.status === "active" && appliesTo(rule, context));
  if (matches.length > 1) {
    throw new RulepackError(`Multiple active ${ruleType} rules match the request.`, {
      rulepack_id: rulepack.rulepack_id,
      rule_ids: matches.map((rule) => rule.rule_id),
      context
    });
  }
  return matches[0] ?? null;
}

function appliesTo(rule, context) {
  const applies = rule.applies_to ?? {};
  return Object.entries(context).every(([key, value]) => {
    const allowed = applies[key];
    if (!allowed || allowed.includes("any")) return true;
    return allowed.includes(value);
  });
}

async function loadRulepackFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return validateRulepack(parsed);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

