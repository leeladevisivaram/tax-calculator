import { createHash } from "node:crypto";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { ImportError, previewImport } from "./import-engine.mjs";
import { toRupees } from "./money.mjs";

export const PDF_IMPORT_VERSION = "pdf-import-v1";
export const MAX_PDF_IMPORT_SIZE_BYTES = 384 * 1024;
const DEFAULT_HF_PDF_MODEL = "Xenova/all-MiniLM-L6-v2";
const SUPPORTED_PDF_IMPORT_TYPES = new Set(["form16"]);
const PDF_TEXT_PREVIEW_LIMIT = 1000;

const FORM16_FIELD_DEFINITIONS = [
  {
    field: "gross_salary",
    label: "Gross salary",
    required: true,
    linePatterns: [
      /gross\s+salary/i,
      /salary\s+as\s+per\s+provisions/i,
      /income\s+chargeable\s+under\s+the\s+head\s+salar/i,
      /total\s+salary/i
    ]
  },
  {
    field: "tds",
    label: "TDS",
    required: true,
    linePatterns: [
      /tax\s+deducted\s+at\s+source/i,
      /\btds\b/i,
      /total\s+tax\s+deducted/i,
      /amount\s+of\s+tax\s+deducted/i
    ]
  },
  {
    field: "deduction_80c",
    label: "Deduction 80C",
    required: false,
    linePatterns: [
      /80\s*c/i,
      /section\s+80c/i,
      /deduction\s+under\s+chapter\s+vi-?a/i
    ]
  },
  {
    field: "employer_name",
    label: "Employer name",
    required: false,
    textPatterns: [
      /(?:name\s+and\s+address\s+of\s+employer|employer\s+name|deductor\s+name)\s*[:\-]?\s*([^\n]+)/i
    ]
  }
];

let pdfFeatureExtractorPromise;
let pdfFeatureExtractorModel = "";

export function getPdfImportCapabilities() {
  return {
    pdf_import_version: PDF_IMPORT_VERSION,
    supported_import_types: [...SUPPORTED_PDF_IMPORT_TYPES],
    max_pdf_size_bytes: MAX_PDF_IMPORT_SIZE_BYTES,
    extraction_modes: [
      "searchable_pdf_text",
      "regex_form16_mapping",
      "optional_huggingface_embedding_match"
    ],
    huggingface: {
      default_model: DEFAULT_HF_PDF_MODEL,
      token_env: "HF_TOKEN or HF_ACCESS_TOKEN",
      enabled_env: "PDF_IMPORT_AI_ENABLED=true"
    },
    ocr: getOcrCapability(),
    required_fields: FORM16_FIELD_DEFINITIONS.filter((field) => field.required).map((field) => field.field)
  };
}

export async function extractPdfImport(request = {}, options = {}) {
  const startedAt = new Date();
  const importType = String(request.import_type ?? "form16");
  if (!SUPPORTED_PDF_IMPORT_TYPES.has(importType)) {
    throw new ImportError("PDF extraction currently supports Form 16 summary imports only.", {
      import_type: importType,
      supported_import_types: [...SUPPORTED_PDF_IMPORT_TYPES]
    });
  }

  const filename = validatePdfFilename(request.filename ?? "form16.pdf");
  const bytes = decodePdfBytes(request);
  const extractedText = normalizePdfText(extractTextFromPdfBytes(bytes));
  if (!extractedText) {
    if (isOcrRequested(request, options)) {
      throw new ImportError("PDF OCR is optional and not configured in this local build.", {
        error_code: "PDF_OCR_NOT_CONFIGURED",
        filename,
        ocr: getOcrCapability(),
        remediation: "Use a searchable PDF or paste CSV/JSON values in Imports."
      });
    }
    throw new ImportError("Could not extract readable text from this PDF.", {
      filename,
      remediation: "Use a searchable PDF or paste CSV/JSON values in Imports."
    });
  }

  const extraction = await extractForm16FieldsFromText(extractedText, options);
  const structuredContent = buildForm16Csv(extraction.fields);
  const convertedFilename = `${path.basename(filename, path.extname(filename))}-extracted.csv`;
  const preview = await previewImport({
    import_type: importType,
    filename: convertedFilename,
    content: structuredContent,
    user_confirmed: request.user_confirmed === true,
    rejected_groups: request.rejected_groups
  });

  return {
    status: extraction.errors.length ? "needs_review" : preview.status,
    import_version: preview.import_version,
    pdf_import_version: PDF_IMPORT_VERSION,
    import_type: importType,
    filename,
    converted_filename: convertedFilename,
    structured_content: structuredContent,
    source_pdf: {
      content_hash: sha256(bytes),
      size_bytes: bytes.length,
      text_characters: extractedText.length
    },
    extraction: {
      ...extraction,
      extracted_text_preview: extractedText.slice(0, PDF_TEXT_PREVIEW_LIMIT)
    },
    preview
  };
}

export function extractTextFromPdfBytes(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  const streams = extractPdfStreams(raw);
  const chunks = [];

  for (const stream of streams) {
    const decoded = decodePdfStream(stream);
    const text = extractTextFromPdfStream(decoded);
    if (text) chunks.push(text);
  }

  const fallback = extractPlainTextFallback(raw);
  if (fallback) chunks.push(fallback);

  return chunks.join("\n");
}

export async function extractForm16FieldsFromText(text, options = {}) {
  const lines = normalizePdfText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const fields = {};
  const review = [];
  const warnings = [];
  const errors = [];

  for (const definition of FORM16_FIELD_DEFINITIONS) {
    const match = extractFieldMatch(definition, lines, text);
    if (match.value !== undefined && match.value !== "") {
      fields[definition.field] = match.value;
      review.push(reviewExtraction(definition.field, match.value, "pattern", match.confidence, {
        evidence: match.evidence,
        sourceLabel: match.sourceLabel,
        needsReview: match.needsReview
      }));
    }
  }

  const missingBeforeAi = missingRequiredFields(fields);
  const aiTrace = await fillMissingFieldsWithAi({
    fields,
    missingFields: missingBeforeAi,
    lines,
    options
  });
  review.push(...aiTrace.review);
  warnings.push(...aiTrace.warnings);

  const missingFields = missingRequiredFields(fields);
  if (missingFields.length > 0) {
    errors.push("ERR_PDF_IMPORT_REQUIRED_FIELDS_MISSING");
    warnings.push(`WARN_PDF_IMPORT_MISSING_FIELDS:${missingFields.join(",")}`);
  }
  if (lines.length === 0) {
    errors.push("ERR_PDF_IMPORT_NO_TEXT_LINES");
  }

  return {
    fields,
    review,
    field_confidence: buildFieldConfidence(review),
    missing_fields: missingFields,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
    ai: aiTrace.ai
  };
}

function validatePdfFilename(filename) {
  const safe = String(filename ?? "");
  if (!safe || safe !== path.basename(safe) || safe.includes("\\") || safe.includes("\0")) {
    throw new ImportError("PDF filename must not include path separators.", { filename: safe });
  }
  if (path.extname(safe).toLowerCase() !== ".pdf") {
    throw new ImportError("Unsupported PDF import file extension.", {
      filename: safe,
      allowed_extensions: [".pdf"]
    });
  }
  return safe;
}

function decodePdfBytes(request) {
  const source = request.content_base64 ?? request.content;
  if (!source) {
    throw new ImportError("PDF content is missing.", {
      expected: "content_base64"
    });
  }

  const base64 = String(source).includes(",")
    ? String(source).slice(String(source).indexOf(",") + 1)
    : String(source);
  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new ImportError("PDF content must be base64 encoded.");
  }
  if (bytes.length === 0) {
    throw new ImportError("Uploaded PDF is empty.");
  }
  if (bytes.length > MAX_PDF_IMPORT_SIZE_BYTES) {
    throw new ImportError("PDF import file exceeds size limit.", {
      size_bytes: bytes.length,
      max_size_bytes: MAX_PDF_IMPORT_SIZE_BYTES
    });
  }
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF"))) {
    throw new ImportError("Uploaded file does not look like a PDF.");
  }
  return bytes;
}

function extractPdfStreams(raw) {
  const streams = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;
  while ((match = streamPattern.exec(raw)) !== null) {
    streams.push({
      dictionary: match[1],
      data: match[2]
    });
  }
  return streams;
}

function decodePdfStream(stream) {
  const bytes = Buffer.from(stream.data, "latin1");
  if (/\/FlateDecode\b/.test(stream.dictionary)) {
    try {
      return inflateSync(bytes).toString("latin1");
    } catch {
      return stream.data;
    }
  }
  return stream.data;
}

function extractTextFromPdfStream(streamText) {
  const chunks = [];
  const textOperators = /(\[(?:[^\]]|\\\])*\]|(?:\((?:\\.|[^\\)])*\)|<[\dA-Fa-f\s]+>))\s*(?:Tj|TJ|'|")/g;
  let match;
  while ((match = textOperators.exec(streamText)) !== null) {
    chunks.push(extractPdfTextOperand(match[1]));
  }

  if (chunks.length === 0) {
    const literalPattern = /\((?:\\.|[^\\)]){3,}\)/g;
    while ((match = literalPattern.exec(streamText)) !== null) {
      chunks.push(decodePdfLiteralString(match[0].slice(1, -1)));
    }
  }

  return chunks.filter(Boolean).join("\n");
}

function extractPdfTextOperand(operand) {
  if (operand.startsWith("[")) {
    const parts = [];
    const literalPattern = /\((?:\\.|[^\\)])*\)|<[\dA-Fa-f\s]+>/g;
    let match;
    while ((match = literalPattern.exec(operand)) !== null) {
      parts.push(extractPdfTextOperand(match[0]));
    }
    return parts.join(" ");
  }
  if (operand.startsWith("(")) return decodePdfLiteralString(operand.slice(1, -1));
  if (operand.startsWith("<")) return decodePdfHexString(operand.slice(1, -1));
  return "";
}

function decodePdfLiteralString(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, escaped) => ({
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\"
    }[escaped] ?? escaped))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function decodePdfHexString(value) {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 2 !== 0) return "";
  const bytes = [];
  for (let index = 0; index < compact.length; index += 2) {
    bytes.push(Number.parseInt(compact.slice(index, index + 2), 16));
  }
  return decodeUtf16Be(bytes).replace(/\0/g, "") || Buffer.from(bytes).toString("latin1");
}

function decodeUtf16Be(bytes) {
  if (bytes.length < 2) return "";
  const chars = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    chars.push(String.fromCharCode((bytes[index] << 8) | bytes[index + 1]));
  }
  return chars.join("");
}

function extractPlainTextFallback(raw) {
  const printable = raw
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[A-Za-z]/.test(line) && line.length >= 8 && !/^\/[A-Za-z]+/.test(line));
  return printable.join("\n");
}

function normalizePdfText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function extractFieldMatch(definition, lines, text) {
  if (definition.field === "employer_name") return extractEmployerMatch(definition, lines, text);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!definition.linePatterns.some((pattern) => pattern.test(line))) continue;

    const inlineAmount = extractBestAmount(line);
    if (inlineAmount > 0) {
      return {
        value: inlineAmount,
        evidence: line,
        sourceLabel: "Searchable PDF text",
        confidence: "high",
        needsReview: false
      };
    }

    const nextAmount = extractBestAmount(lines[index + 1] ?? "");
    if (nextAmount > 0) {
      return {
        value: nextAmount,
        evidence: `${line} ${lines[index + 1] ?? ""}`.trim(),
        sourceLabel: "Searchable PDF text",
        confidence: "high",
        needsReview: false
      };
    }
  }

  return { value: undefined };
}

function extractEmployerMatch(definition, lines, text) {
  for (const pattern of definition.textPatterns ?? []) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return {
        value: cleanEmployerName(match[1]),
        evidence: match[0],
        sourceLabel: "Searchable PDF text",
        confidence: "medium",
        needsReview: true
      };
    }
  }

  const index = lines.findIndex((line) => /name\s+and\s+address\s+of\s+employer|employer\s+name|deductor\s+name/i.test(line));
  if (index >= 0 && lines[index + 1]) {
    return {
      value: cleanEmployerName(lines[index + 1]),
      evidence: `${lines[index]} ${lines[index + 1]}`.trim(),
      sourceLabel: "Searchable PDF text",
      confidence: "medium",
      needsReview: true
    };
  }
  return { value: "" };
}

function cleanEmployerName(value) {
  return String(value ?? "")
    .replace(/\b(PAN|TAN|Address)\b.*$/i, "")
    .replace(/[:\-]+$/g, "")
    .trim()
    .slice(0, 120);
}

function extractBestAmount(line) {
  const amounts = [...String(line ?? "").matchAll(/(?:rs\.?|inr|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+|[0-9]{4,})(?:\.\d{1,2})?/gi)]
    .map((match) => toNumber(match[1]))
    .filter((amount) => amount > 0);
  if (amounts.length === 0) return 0;
  return Math.max(...amounts);
}

function toNumber(value) {
  return toRupees(value);
}

function isOcrRequested(request, options) {
  return request.enable_ocr === true ||
    options.enableOcr === true ||
    process.env.PDF_IMPORT_OCR_ENABLED === "true";
}

function getOcrCapability() {
  return {
    status: "optional_not_configured",
    default_enabled: false,
    enabled_env: "PDF_IMPORT_OCR_ENABLED=true",
    supported_runtime: "offline_local_only",
    note: "Core behavior stays limited to searchable PDFs. Offline OCR should remain optional until a bounded local OCR pipeline is configured."
  };
}

function missingRequiredFields(fields) {
  return FORM16_FIELD_DEFINITIONS
    .filter((definition) => definition.required && toNumber(fields[definition.field]) <= 0)
    .map((definition) => definition.field);
}

async function fillMissingFieldsWithAi({ fields, missingFields, lines, options }) {
  const ai = {
    enabled: false,
    attempted: false,
    model: options.model ?? process.env.HF_PDF_IMPORT_MODEL ?? DEFAULT_HF_PDF_MODEL,
    source: "not_configured"
  };
  const review = [];
  const warnings = [];
  if (missingFields.length === 0) return { ai, review, warnings };

  const enabled = options.aiEnabled === true ||
    process.env.PDF_IMPORT_AI_ENABLED === "true" ||
    Boolean(process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN);
  if (!enabled && typeof options.fieldResolver !== "function") return { ai, review, warnings };

  ai.enabled = true;
  ai.attempted = true;
  try {
    const resolver = options.fieldResolver ?? resolveFieldsWithHuggingFaceEmbeddings;
    const resolved = await resolver({
      missingFields,
      lines,
      definitions: FORM16_FIELD_DEFINITIONS,
      model: ai.model
    });
    ai.source = resolved?.source ?? "huggingface_embedding_match";
    ai.score = resolved?.score ?? null;

    for (const item of resolved?.fields ?? []) {
      if (!missingFields.includes(item.field)) continue;
      const amount = toNumber(item.value);
      if (amount <= 0) continue;
      fields[item.field] = amount;
      review.push(reviewExtraction(item.field, amount, ai.source, item.confidence ?? "medium", {
        evidence: item.evidence ?? "",
        sourceLabel: "Hugging Face semantic match",
        needsReview: item.confidence !== "high"
      }));
    }
  } catch (error) {
    ai.source = "model_fallback";
    ai.error = error?.message ?? "Model extraction failed";
    warnings.push("WARN_PDF_IMPORT_AI_FALLBACK");
  }
  return { ai, review, warnings };
}

async function resolveFieldsWithHuggingFaceEmbeddings({ missingFields, lines, definitions, model }) {
  const candidates = lines
    .map((line) => ({ line, amount: extractBestAmount(line) }))
    .filter((candidate) => candidate.amount > 0)
    .slice(0, 80);
  if (candidates.length === 0) return { source: "huggingface_embedding_match", fields: [] };

  const extractor = await getPdfFeatureExtractor(model);
  const candidateEmbeddings = await Promise.all(candidates.map((candidate) => embedText(extractor, candidate.line)));
  const fields = [];
  let bestScore = 0;
  for (const field of missingFields) {
    const definition = definitions.find((item) => item.field === field);
    if (!definition) continue;
    const fieldEmbedding = await embedText(extractor, `${definition.label} Form 16 amount`);
    const ranked = candidateEmbeddings
      .map((embedding, index) => ({
        ...candidates[index],
        score: cosineSimilarity(fieldEmbedding, embedding)
      }))
      .sort((a, b) => b.score - a.score)[0];
    if (ranked && ranked.score >= 0.42) {
      fields.push({
        field,
        value: ranked.amount,
        confidence: ranked.score >= 0.62 ? "medium" : "low"
      });
      bestScore = Math.max(bestScore, ranked.score);
    }
  }
  return {
    source: "huggingface_embedding_match",
    score: bestScore,
    fields
  };
}

async function getPdfFeatureExtractor(model) {
  if (!pdfFeatureExtractorPromise || pdfFeatureExtractorModel !== model) {
    pdfFeatureExtractorModel = model;
    pdfFeatureExtractorPromise = import("@huggingface/transformers").then(({ pipeline }) => {
      return pipeline("feature-extraction", model, { dtype: "q8" });
    });
  }
  return pdfFeatureExtractorPromise;
}

async function embedText(extractor, text) {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data ?? output.tolist?.()?.[0] ?? []);
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function reviewExtraction(field, value, source, confidence, metadata = {}) {
  return {
    field,
    value,
    source,
    confidence,
    evidence: metadata.evidence ?? "",
    sourceLabel: metadata.sourceLabel ?? source,
    needsReview: metadata.needsReview ?? confidence !== "high"
  };
}

function buildFieldConfidence(review) {
  return Object.fromEntries(review.map((item) => [
    item.field,
    {
      confidence: item.confidence,
      evidence: item.evidence,
      sourceLabel: item.sourceLabel,
      needsReview: item.needsReview
    }
  ]));
}

function buildForm16Csv(fields) {
  const row = {
    gross_salary: fields.gross_salary ?? "",
    tds: fields.tds ?? "",
    deduction_80c: fields.deduction_80c ?? "",
    employer_name: fields.employer_name ?? ""
  };
  const headers = Object.keys(row);
  return `${headers.join(",")}\n${headers.map((header) => csvCell(row[header])).join(",")}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
