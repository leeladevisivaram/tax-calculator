export const API_CONTRACT_VERSION = "api-contracts-v1";

const SHARED_ERROR_CODES = [
  "REQ_MALFORMED_JSON",
  "REQ_JSON_OBJECT_REQUIRED",
  "REQ_JSON_BODY_TOO_LARGE",
  "REQ_UNSUPPORTED_MEDIA_TYPE"
];

const CONTRACTS = [
  contract({
    endpoint: "/api/v1/tax/validate",
    methods: ["POST"],
    layer: "domain",
    request_schema: "TaxScenarioRequest",
    response_schema: "ValidationReport",
    notes: "Validates supported scenario fields without running tax computation."
  }),
  contract({
    endpoint: "/api/v1/tax/compute",
    methods: ["POST"],
    layer: "domain",
    request_schema: "TaxScenarioRequest",
    response_schema: "TaxComputationResponse",
    notes: "Runs tax math only on the backend tax engine."
  }),
  contract({
    endpoint: "/api/v1/tax/compare-regimes",
    methods: ["POST"],
    layer: "domain",
    request_schema: "TaxScenarioRequest",
    response_schema: "RegimeComparisonResponse",
    notes: "Computes old and new regime results through the tax engine."
  }),
  contract({
    endpoint: "/api/v1/imports/pdf-extract",
    methods: ["POST"],
    layer: "ingestion",
    request_schema: "PdfExtractRequest",
    response_schema: "PdfExtractResponse",
    notes: "Extracts searchable Form 16 PDFs into reviewable fields with confidence metadata."
  }),
  contract({
    endpoint: "/api/v1/ai/review-scenario",
    methods: ["POST"],
    layer: "assistant",
    request_schema: "AiReviewRequest",
    response_schema: "AiReviewResponse",
    notes: "Runs local deterministic readiness and anomaly checks; hosted token is not required."
  }),
  contract({
    endpoint: "/api/v1/chatbot/message",
    methods: ["POST"],
    layer: "assistant",
    request_schema: "ChatbotMessageRequest",
    response_schema: "ChatbotMessageResponse",
    notes: "Answers app-help prompts and returns safe field actions where supported."
  })
];

const SCHEMAS = {
  TaxScenarioRequest: {
    type: "object",
    required: ["period_type", "period", "act", "taxpayer_type", "residency", "age_years", "regime"],
    properties: {
      period_type: { enum: ["assessment_year", "tax_year"] },
      period: { type: "string" },
      act: { type: "string" },
      taxpayer_type: { enum: ["individual", "huf"] },
      residency: { enum: ["resident", "non_resident"] },
      age_years: { type: "number", minimum: 0 },
      regime: { enum: ["old", "new"] },
      income: { type: "object" },
      deductions: { type: "object" },
      tax_credits: { type: "object" },
      options: { type: "object" }
    }
  },
  PdfExtractRequest: {
    type: "object",
    required: ["import_type", "filename", "content_base64"],
    properties: {
      import_type: { enum: ["form16"] },
      filename: { type: "string", pattern: "\\.pdf$" },
      content_base64: { type: "string" },
      user_confirmed: { type: "boolean" },
      rejected_groups: { type: "array", items: { type: "string" } }
    }
  },
  AiReviewRequest: {
    type: "object",
    required: ["scenario"],
    properties: {
      scenario: { ref: "TaxScenarioRequest" },
      active_step: { enum: ["profile", "imports", "income", "deductions", "credits", "results", "launch"] },
      import_extraction: { type: "object" },
      previous_scenario: { type: "object" },
      dismissed_finding_ids: { type: "array", items: { type: "string" } }
    }
  },
  ChatbotMessageRequest: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      active_step: { type: "string" },
      form_state: { type: "object" }
    }
  },
  ValidationReport: responseSchema(["status", "summary", "results"]),
  TaxComputationResponse: responseSchema(["status", "summary", "computation_hash", "rule_trace"]),
  RegimeComparisonResponse: responseSchema(["status", "recommended_regime", "old", "new", "delta"]),
  PdfExtractResponse: responseSchema(["status", "extraction", "preview"]),
  AiReviewResponse: responseSchema(["status", "readiness", "confidence_score", "findings", "suggested_actions"]),
  ChatbotMessageResponse: responseSchema(["status", "answer", "actions", "interaction_log"])
};

export function getApiContracts({ endpoint } = {}) {
  const contracts = endpoint
    ? CONTRACTS.filter((item) => item.endpoint === endpoint)
    : CONTRACTS;
  return {
    status: "ok",
    contract_version: API_CONTRACT_VERSION,
    validator_dependency: "not_required_dependency_free_contracts",
    dependency_policy: {
      runtime_validator_adoption: "defer_until_contracts_stable_and_dependency_policy_allows",
      preserve_error_codes: true,
      default_network_requirement: "none"
    },
    shared_error_codes: SHARED_ERROR_CODES,
    schemas: SCHEMAS,
    contracts
  };
}

function contract(definition) {
  return {
    ...definition,
    request_content_type: "application/json",
    stable_error_codes: SHARED_ERROR_CODES,
    audit: "masked"
  };
}

function responseSchema(required) {
  return {
    type: "object",
    required,
    properties: {
      status: { type: "string" },
      audit_id: { type: "string", optional: true }
    }
  };
}
