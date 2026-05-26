import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toRupees } from "./money.mjs";

const IMPORT_VERSION = "sprint6-v1";
const MAX_IMPORT_SIZE_BYTES = 256 * 1024;
const STRUCTURED_IMPORT_EXTENSIONS = [".csv", ".json"];
const ARTIFACT_DIR = path.join(tmpdir(), "tax-calculator-import-artifacts");
const ENCRYPTION_KEY = scryptSync(process.env.IMPORT_ARTIFACT_SECRET ?? "development-import-artifact-secret", "tax-calculator-imports", 32);
const KNOWN_ASSET_TYPES = new Set(["equity", "equity_share", "listed_equity", "mutual_fund", "debt_fund", "land", "building", "property", "other"]);

const TEMPLATE_DEFINITIONS = [
  {
    import_type: "form16",
    label: "Form 16 summary",
    supported_formats: ["csv", "json", "searchable_pdf"],
    template_headers: ["gross_salary", "tds", "deduction_80c", "employer_name"],
    maps_to: ["income.salary.gross_salary", "tax_credits.tds", "deductions.chapter_via.80C"]
  },
  {
    import_type: "interest_dividend",
    label: "Interest and dividend income",
    supported_formats: ["csv", "json"],
    template_headers: ["type", "amount", "payer"],
    maps_to: ["income.other_sources"]
  },
  {
    import_type: "deductions",
    label: "Investment and deduction claims",
    supported_formats: ["csv", "json"],
    template_headers: ["section", "amount", "premium", "preventive_checkup", "bucket", "senior"],
    maps_to: ["deductions.chapter_via"]
  },
  {
    import_type: "capital_gains",
    label: "Capital-gains schedule",
    supported_formats: ["csv", "json"],
    template_headers: ["section", "transfer_date", "net_gain", "stt_paid", "asset_type"],
    maps_to: ["income.capital_gains"]
  },
  {
    import_type: "xlsx_template",
    label: "Spreadsheet templates",
    supported_formats: ["xlsx_template_only"],
    template_headers: ["Use CSV with the same headers until XLSX parsing dependencies are available."],
    maps_to: []
  }
];

export function getImportTemplates() {
  return {
    status: "ok",
    import_version: IMPORT_VERSION,
    file_policy: {
      allowed_extensions: STRUCTURED_IMPORT_EXTENSIONS,
      structured_preview_extensions: STRUCTURED_IMPORT_EXTENSIONS,
      max_size_bytes: MAX_IMPORT_SIZE_BYTES,
      pdf_extract: {
        allowed_extensions: [".pdf"],
        endpoint: "/api/v1/imports/pdf-extract",
        supported_import_types: ["form16"],
        ocr_default_enabled: false,
        note: "Searchable Form 16 PDFs are extracted into structured preview content before confirmation. Offline OCR stays optional and disabled by default."
      },
      malware_scan: "placeholder_hook",
      artifact_storage: "encrypted_local_artifact_with_retention_metadata"
    },
    templates: TEMPLATE_DEFINITIONS
  };
}

export async function previewImport(request = {}) {
  const startedAt = new Date();
  const importType = request.import_type;
  const template = TEMPLATE_DEFINITIONS.find((item) => item.import_type === importType);
  if (!template || importType === "xlsx_template") {
    throw new ImportError("Unsupported import_type.", { import_type: importType });
  }

  const filename = request.filename ?? `${importType}.csv`;
  const content = String(request.content ?? "");
  const filePolicy = validateFilePolicy(filename, content);
  const rows = parseImportContent(filename, content);
  const mapping = rows.length === 0 ? emptyMapping() : mapRows(importType, rows);
  const artifact = await storeEncryptedArtifact({
    import_type: importType,
    filename,
    content,
    parsed_rows: rows,
    warnings: mapping.warnings,
    unknown_fields: mapping.unknown_fields
  }, startedAt);

  const userConfirmed = request.user_confirmed === true;
  const rejectedGroups = normalizeRejectedGroups(request.rejected_groups);
  const confirmedPatch = userConfirmed && mapping.errors.length === 0
    ? filterPatchByRejectedGroups(mapping.request_patch, rejectedGroups)
    : {};
  return {
    status: mapping.errors.length ? "needs_review" : "ok",
    import_version: IMPORT_VERSION,
    import_id: artifact.import_id,
    import_type: importType,
    filename,
    file_policy: filePolicy,
    malware_scan: {
      status: "placeholder_pass",
      scanner: "not_configured_in_dependency_free_build"
    },
    parsed_rows: rows,
    review_items: mapping.review_items.map((item) => ({
      ...item,
      confirmation_status: userConfirmed
        ? rejectedGroups.includes(item.group) ? "rejected_by_user" : "confirmed"
        : "requires_user_confirmation"
    })),
    review_groups: buildReviewGroups(mapping.review_items, rejectedGroups, userConfirmed),
    proposed_request_patch: mapping.request_patch,
    confirmed_request_patch: confirmedPatch,
    confirmation_required: !userConfirmed,
    rejected_groups: rejectedGroups,
    confirmed_at: userConfirmed ? startedAt.toISOString() : null,
    unknown_fields: mapping.unknown_fields,
    warnings: mapping.warnings,
    errors: mapping.errors,
    audit_trace: {
      content_hash: sha256(content),
      artifact_id: artifact.import_id,
      artifact_path: artifact.artifact_path,
      received_at: startedAt.toISOString(),
      retention_expires_on: retentionDate(startedAt),
      confirmation_required: !userConfirmed,
      confirmed_at: userConfirmed ? startedAt.toISOString() : null
    },
    artifact_storage: {
      status: "stored_encrypted",
      algorithm: "aes-256-gcm",
      path: artifact.artifact_path,
      retention_expires_on: retentionDate(startedAt)
    }
  };
}

export class ImportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImportError";
    this.details = details;
  }
}

function validateFilePolicy(filename, content) {
  const extension = path.extname(filename).toLowerCase();
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (filename !== path.basename(filename) || filename.includes("\\") || filename.includes("\0")) {
    throw new ImportError("Import filename must not include path separators.", {
      filename
    });
  }
  if (!STRUCTURED_IMPORT_EXTENSIONS.includes(extension)) {
    throw new ImportError("Unsupported import file extension.", {
      filename,
      allowed_extensions: STRUCTURED_IMPORT_EXTENSIONS
    });
  }
  if (sizeBytes > MAX_IMPORT_SIZE_BYTES) {
    throw new ImportError("Import file exceeds size limit.", {
      filename,
      size_bytes: sizeBytes,
      max_size_bytes: MAX_IMPORT_SIZE_BYTES
    });
  }

  return {
    accepted: true,
    extension,
    size_bytes: sizeBytes,
    max_size_bytes: MAX_IMPORT_SIZE_BYTES
  };
}

function parseImportContent(filename, content) {
  if (!content.trim()) return [];
  if (path.extname(filename).toLowerCase() === ".json") {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return parseCsv(content);
}

function parseCsv(content) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => normalizeHeader(header));
  return lines.slice(1).map((line, rowIndex) => {
    const values = splitCsvLine(line);
    const row = { _row: rowIndex + 2 };
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function mapRows(importType, rows) {
  const mapper = {
    form16: mapForm16Rows,
    interest_dividend: mapInterestDividendRows,
    deductions: mapDeductionRows,
    capital_gains: mapCapitalGainRows
  }[importType];
  return mapper(rows);
}

function mapForm16Rows(rows) {
  const patch = { income: { salary: {} }, deductions: { standard_deduction: true, chapter_via: [] }, tax_credits: {} };
  const reviewItems = [];
  const warnings = [];
  const errors = [];
  const unknownFields = collectUnknownFields(rows, ["gross_salary", "tds", "deduction_80c", "employer_name"]);
  const row = rows[0] ?? {};

  addNumberMapping(reviewItems, patch.income.salary, "gross_salary", row.gross_salary, "income.salary.gross_salary", "salary", row._row);
  addNumberMapping(reviewItems, patch.tax_credits, "tds", row.tds, "tax_credits.tds", "credits", row._row);
  const eightyC = toNumber(row.deduction_80c);
  if (eightyC > 0) {
    patch.deductions.chapter_via.push({ section: "80C", amount: eightyC });
    reviewItems.push(reviewItem("deductions.chapter_via[80C].amount", eightyC, "deductions", row._row, "medium"));
  }
  if (row.employer_name) {
    reviewItems.push(reviewItem("import_metadata.employer_name", row.employer_name, "metadata", row._row, "low"));
  }

  return finalizeMapping(patch, reviewItems, warnings, errors, unknownFields);
}

function mapInterestDividendRows(rows) {
  const patch = { income: { other_sources: [] } };
  const reviewItems = [];
  const warnings = [];
  const errors = [];
  const unknownFields = collectUnknownFields(rows, ["type", "amount", "payer"]);

  for (const row of rows) {
    const amount = toNumber(row.amount);
    if (amount <= 0) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_NO_AMOUNT`);
      continue;
    }
    const type = normalizeHeader(row.type || "interest");
    patch.income.other_sources.push({ type, amount });
    reviewItems.push(reviewItem(`income.other_sources[${patch.income.other_sources.length - 1}]`, { type, amount }, "income", row._row, "medium"));
  }

  return finalizeMapping(patch, reviewItems, warnings, errors, unknownFields);
}

function mapDeductionRows(rows) {
  const patch = { deductions: { chapter_via: [] } };
  const reviewItems = [];
  const warnings = [];
  const errors = [];
  const unknownFields = collectUnknownFields(rows, ["section", "amount", "premium", "preventive_checkup", "bucket", "senior"]);

  for (const row of rows) {
    const section = String(row.section ?? "").toUpperCase();
    if (!section) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_MISSING_SECTION`);
      continue;
    }
    const deduction = { section };
    if (section === "80D") {
      deduction.bucket = row.bucket || "self_family";
      deduction.premium = toNumber(row.premium);
      deduction.preventive_checkup = toNumber(row.preventive_checkup);
      deduction.senior = parseBoolean(row.senior);
    } else {
      deduction.amount = toNumber(row.amount);
    }
    patch.deductions.chapter_via.push(deduction);
    reviewItems.push(reviewItem(`deductions.chapter_via[${patch.deductions.chapter_via.length - 1}]`, deduction, "deductions", row._row, "medium"));
  }

  return finalizeMapping(patch, reviewItems, warnings, errors, unknownFields);
}

function mapCapitalGainRows(rows) {
  const patch = { income: { capital_gains: [] } };
  const reviewItems = [];
  const warnings = [];
  const errors = [];
  const unknownFields = collectUnknownFields(rows, ["section", "transfer_date", "net_gain", "stt_paid", "asset_type"]);
  const seenRows = new Set();

  for (const row of rows) {
    const section = String(row.section ?? "").toUpperCase();
    const netGain = toNumber(row.net_gain);
    if (!section || netGain <= 0) {
      errors.push(`ERR_IMPORT_ROW_${row._row}_CAPITAL_GAIN_REQUIRED_FIELDS`);
      continue;
    }
    const duplicateKey = [section, row.transfer_date ?? "", netGain, parseBoolean(row.stt_paid), normalizeHeader(row.asset_type ?? "")].join("|");
    if (seenRows.has(duplicateKey)) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_DUPLICATE_ROW`);
      continue;
    }
    seenRows.add(duplicateKey);

    const hasTransferDate = Boolean(row.transfer_date);
    const validTransferDate = hasTransferDate && isValidIsoDate(row.transfer_date);
    const ambiguousAssetType = Boolean(row.asset_type) && !KNOWN_ASSET_TYPES.has(normalizeHeader(row.asset_type));
    if (!hasTransferDate) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_MISSING_TRANSFER_DATE`);
    }
    if (hasTransferDate && !validTransferDate) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_INVALID_TRANSFER_DATE`);
    }
    if (ambiguousAssetType) {
      warnings.push(`WARN_IMPORT_ROW_${row._row}_AMBIGUOUS_ASSET_TYPE`);
    }
    const gain = {
      section,
      transfer_date: validTransferDate ? row.transfer_date : null,
      net_gain: netGain,
      stt_paid: parseBoolean(row.stt_paid)
    };
    if (row.asset_type) gain.asset_type = row.asset_type;
    patch.income.capital_gains.push(gain);
    reviewItems.push(reviewItem(`income.capital_gains[${patch.income.capital_gains.length - 1}]`, gain, "capital_gains", row._row, validTransferDate && !ambiguousAssetType ? "medium" : "low"));
  }

  return finalizeMapping(patch, reviewItems, warnings, errors, unknownFields);
}

function addNumberMapping(reviewItems, target, key, rawValue, pathName, group, rowNumber) {
  const amount = toNumber(rawValue);
  if (amount <= 0) return;
  target[key] = amount;
  reviewItems.push(reviewItem(pathName, amount, group, rowNumber, "high"));
}

function reviewItem(pathName, proposedValue, group, sourceRow, confidence) {
  return {
    item_id: sha256(`${pathName}:${JSON.stringify(proposedValue)}:${sourceRow}`).slice(0, 16),
    path: pathName,
    proposed_value: proposedValue,
    group,
    source_row: sourceRow ?? null,
    confidence
  };
}

function finalizeMapping(requestPatch, reviewItems, warnings, errors, unknownFields) {
  if (unknownFields.length > 0) {
    warnings.push("WARN_IMPORT_UNKNOWN_FIELDS");
  }
  return {
    request_patch: pruneEmpty(requestPatch),
    review_items: reviewItems,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
    unknown_fields: unknownFields
  };
}

function emptyMapping() {
  return {
    request_patch: {},
    review_items: [],
    warnings: [],
    errors: ["ERR_IMPORT_EMPTY_FILE"],
    unknown_fields: []
  };
}

function normalizeRejectedGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return [...new Set(groups.map((group) => String(group)).filter(Boolean))].sort();
}

function buildReviewGroups(reviewItems, rejectedGroups, userConfirmed) {
  const groups = new Map();
  for (const item of reviewItems) {
    const group = groups.get(item.group) ?? {
      group: item.group,
      item_count: 0,
      confidence: item.confidence,
      confirmation_status: "requires_user_confirmation"
    };
    group.item_count += 1;
    group.confidence = confidenceRank(item.confidence) < confidenceRank(group.confidence) ? item.confidence : group.confidence;
    groups.set(item.group, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    confirmation_status: userConfirmed
      ? rejectedGroups.includes(group.group) ? "rejected_by_user" : "confirmed"
      : "requires_user_confirmation"
  }));
}

function confidenceRank(confidence) {
  return { low: 0, medium: 1, high: 2 }[confidence] ?? 0;
}

function filterPatchByRejectedGroups(patch = {}, rejectedGroups = []) {
  const filtered = structuredClone(patch ?? {});
  if (rejectedGroups.includes("salary")) {
    delete filtered.income?.salary;
  }
  if (rejectedGroups.includes("credits")) {
    delete filtered.tax_credits;
  }
  if (rejectedGroups.includes("deductions")) {
    delete filtered.deductions?.chapter_via;
  }
  if (rejectedGroups.includes("income")) {
    delete filtered.income?.other_sources;
  }
  if (rejectedGroups.includes("capital_gains")) {
    delete filtered.income?.capital_gains;
  }
  return pruneEmpty(filtered) ?? {};
}

function collectUnknownFields(rows, knownFields) {
  const known = new Set([...knownFields, "_row"]);
  const unknown = new Set();
  for (const row of rows) {
    Object.keys(row).forEach((field) => {
      if (!known.has(field)) unknown.add(field);
    });
  }
  return [...unknown].sort();
}

async function storeEncryptedArtifact(payload, startedAt) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const importId = sha256(`${payload.import_type}:${payload.filename}:${payload.content}:${startedAt.toISOString()}`).slice(0, 24);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const plaintext = JSON.stringify({
    ...payload,
    received_at: startedAt.toISOString(),
    retention_expires_on: retentionDate(startedAt)
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const artifact = {
    import_id: importId,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
    created_at: startedAt.toISOString(),
    retention_expires_on: retentionDate(startedAt)
  };
  const artifactPath = path.join(ARTIFACT_DIR, `${importId}.json`);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return { import_id: importId, artifact_path: artifactPath };
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    return value.map(pruneEmpty).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, pruneEmpty(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === undefined || value === null || value === "" ? undefined : value;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "_");
}

function toNumber(value) {
  return toRupees(value);
}

function parseBoolean(value) {
  return ["true", "yes", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function isValidIsoDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function retentionDate(startedAt) {
  const retention = new Date(startedAt);
  retention.setDate(retention.getDate() + 7);
  return retention.toISOString().slice(0, 10);
}
