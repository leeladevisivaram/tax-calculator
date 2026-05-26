import { CHATBOT_KNOWLEDGE, CHATBOT_KNOWLEDGE_CATEGORIES } from "./chatbot-knowledge.mjs";

const RUPEE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const DEFAULT_AI_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_AI_MIN_SCORE = 0.72;
const GENERIC_FALLBACK_REPLY = "I can help with app navigation, field help, missing-entry messages, imports, reports, and supported field fills. Please ask about one of those calculator tasks.";

export const CHATBOT_DATASET = {
  supportedIntents: [
    "app_navigation",
    "field_help",
    "missing_error_help",
    "form_fill",
    "document_import",
    "action_guidance"
  ],
  refusalExamples: [
    "Which mutual fund should I buy?",
    "Give me legal advice for my tax notice.",
    "What is the weather today?",
    "How do I avoid tax?"
  ],
  fieldExamples: [
    "Set gross salary to 900000",
    "Choose old regime",
    "Where do I enter TDS?",
    "Why is Age missing?",
    "Fill 80C as 150000"
  ]
};

export { CHATBOT_KNOWLEDGE, CHATBOT_KNOWLEDGE_CATEGORIES };

export const CHATBOT_AI_CONFIG = {
  default_enabled: true,
  default_min_score: DEFAULT_AI_MIN_SCORE,
  default_model: DEFAULT_AI_MODEL,
  hosted_api_required: false
};

const STEP_GUIDES = {
  profile: {
    label: "Profile",
    target: "usage-guide-profile",
    reply: "Use Profile for Period type, Period, Act, Taxpayer type, Residency, Age, Display language, and Preferred regime."
  },
  imports: {
    label: "Imports",
    target: "usage-guide-imports",
    reply: "Use Imports to choose an import type, upload CSV, JSON, or a searchable Form 16 PDF, preview extracted values, and confirm before applying values."
  },
  income: {
    label: "Income",
    target: "usage-guide-income",
    reply: "Use Income for salary, HRA, LTA, house property, other sources, capital gains, and business or profession values."
  },
  deductions: {
    label: "Deductions",
    target: "usage-guide-deductions",
    reply: "Use Deductions for standard deduction, 80C, 80D, 80GG, 80EE, and 80EEA inputs."
  },
  credits: {
    label: "Credits",
    target: "usage-guide-credits",
    reply: "Use Credits for TDS, TCS, advance tax, and self-assessment tax already paid."
  },
  results: {
    label: "Results",
    target: "usage-guide-results",
    reply: "Use Results to validate, compute, compare regimes, generate explanations, and download reports."
  },
  launch: {
    label: "Readiness",
    target: "usage-guide-readiness",
    reply: "Use Readiness for beta-plan, regression, launch-readiness, support, and feedback triage actions."
  }
};

const SALARY_INCOME_HEAD_ACTION = { type: "set_checked", field: "income_head_salary", checked: true, label: "Salary income head", step: "income" };

const FIELD_DEFINITIONS = [
  field("gross_salary", "Gross salary", "income", ["gross salary", "salary income", "salary"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("basic_salary", "Basic salary for HRA", "income", ["basic salary", "hra basic"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("hra_received", "HRA received", "income", ["hra received", "hra"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("rent_paid", "Annual rent paid", "income", ["annual rent", "rent paid", "rent"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("lta_received", "LTA received", "income", ["lta received"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("lta_claim", "LTA claim", "income", ["lta claim"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("lta_journeys", "LTA journeys already claimed", "income", ["lta journeys", "journeys claimed"], "number", {
    preActions: [SALARY_INCOME_HEAD_ACTION]
  }),
  field("self_occupied_interest", "Self-occupied interest", "income", ["self occupied interest", "housing interest"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_house", checked: true, label: "House property income head", step: "income" }]
  }),
  field("let_out_loss", "Let-out computed loss", "income", ["let out loss", "house loss"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_house", checked: true, label: "House property income head", step: "income" }]
  }),
  field("interest_income", "Interest income", "income", ["interest income", "interest"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_other_sources", checked: true, label: "Other sources income head", step: "income" }]
  }),
  field("capital_gain_section", "Capital-gains section", "income", ["capital gains section", "capital gain section", "section"], "select", {
    values: ["111A", "112A", "112", "50AA"],
    preActions: [{ type: "set_checked", field: "income_head_capital_gains", checked: true, label: "Capital gains income head", step: "income" }]
  }),
  field("capital_gain_transfer_date", "Capital-gains transfer date", "income", ["transfer date", "capital gains date", "capital gain date"], "date", {
    preActions: [{ type: "set_checked", field: "income_head_capital_gains", checked: true, label: "Capital gains income head", step: "income" }]
  }),
  field("capital_gain_net_gain", "Capital-gains net gain", "income", ["net gain", "capital gain amount", "capital gains amount"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_capital_gains", checked: true, label: "Capital gains income head", step: "income" }]
  }),
  field("business_section", "Business type", "income", ["business type", "business section", "profession type"], "select", {
    values: ["normal_business", "44AD", "44ADA"],
    preActions: [{ type: "set_checked", field: "income_head_business", checked: true, label: "Business income head", step: "income" }]
  }),
  field("business_net_income", "Business net income", "income", ["business net income", "net income"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_business", checked: true, label: "Business income head", step: "income" }]
  }),
  field("business_receipts", "Turnover / gross receipts", "income", ["business receipts", "gross receipts", "turnover"], "number", {
    preActions: [{ type: "set_checked", field: "income_head_business", checked: true, label: "Business income head", step: "income" }]
  }),
  field("business_cash_receipts", "Cash receipts", "income", ["cash receipts"], "number"),
  field("business_digital_receipts", "Digital receipts", "income", ["digital receipts"], "number"),
  field("deduction_80c", "80C family bucket", "deductions", ["80c", "80 c"], "number"),
  field("deduction_80d_self_premium", "80D self/family premium", "deductions", ["80d self premium", "80d family premium"], "number"),
  field("deduction_80d_parent_premium", "80D parent premium", "deductions", ["80d parent premium", "parent premium"], "number"),
  field("deduction_80gg_rent", "80GG rent paid", "deductions", ["80gg", "80gg rent"], "number"),
  field("deduction_80ee", "80EE claim", "deductions", ["80ee"], "number"),
  field("deduction_80eea", "80EEA claim", "deductions", ["80eea"], "number"),
  field("tds", "TDS", "credits", ["tds"], "number"),
  field("tcs", "TCS", "credits", ["tcs"], "number"),
  field("advance_tax", "Advance tax", "credits", ["advance tax"], "number"),
  field("self_assessment_tax", "Self-assessment tax", "credits", ["self assessment tax", "self-assessment tax"], "number"),
  field("age_years", "Age", "profile", ["age"], "number"),
  field("period", "Period", "profile", ["period", "assessment year", "tax year"], "select", { values: ["2026-27", "2025-26"] }),
  field("taxpayer_type", "Taxpayer type", "profile", ["taxpayer type", "taxpayer"], "select", { values: ["individual", "huf"] }),
  field("residency", "Residency", "profile", ["residency"], "select", { values: ["resident", "non_resident"] }),
  field("import_filename", "Filename", "imports", ["filename", "file name"], "text"),
  field("import_content", "CSV, JSON, or extracted PDF content", "imports", ["import content", "csv content", "json content", "pdf content", "extracted pdf"], "text"),
  field("feedback_description", "Feedback", "launch", ["feedback"], "text")
];

const ERROR_GUIDANCE = [
  {
    patterns: ["age missing", "age is missing", "missing age"],
    reply: "The Age message means the Age field in Profile is empty. Enter a whole number such as 34, then run Validate again.",
    step: "profile"
  },
  {
    patterns: ["csv", "json", "content missing", "import content"],
    reply: "The import content message means the CSV, JSON, or extracted PDF content box is empty. Upload a supported file or paste content in Imports before using Preview import.",
    step: "imports"
  },
  {
    patterns: ["import review confirmation", "confirmation missing", "apply import"],
    reply: "The Import review confirmation message means the review checkbox is not selected. Preview the import, review the proposed values, then tick the confirmation checkbox before applying.",
    step: "imports"
  },
  {
    patterns: ["generated explanation report", "json report", "html report", "report missing"],
    reply: "The Generated explanation report message means you need to run Explain before downloading JSON or HTML reports.",
    step: "results"
  },
  {
    patterns: ["zero or more", "negative"],
    reply: "The zero-or-more message means a number field has a negative value. Replace it with 0 or a valid positive INR amount.",
    step: "income"
  },
  {
    patterns: ["feedback missing", "classify feedback"],
    reply: "The Feedback message means the Feedback box in Readiness is empty. Enter the issue or observation before using Classify feedback.",
    step: "launch"
  }
];

const OUT_OF_SCOPE_PATTERNS = [
  "weather",
  "movie",
  "recipe",
  "politics",
  "cricket score",
  "stock",
  "share market",
  "mutual fund",
  "crypto",
  "bitcoin",
  "investment advice",
  "legal advice",
  "avoid tax",
  "evade tax",
  "best tax saving",
  "should i invest",
  "which fund"
];

const QUICK_HELP_PATTERNS = [
  { patterns: ["tds", "tcs", "advance tax", "self assessment"], step: "credits" },
  { patterns: ["salary", "hra", "lta", "rent", "capital gain", "business", "interest income", "house property"], step: "income" },
  { patterns: ["80c", "80d", "80ee", "80eea", "80gg", "deduction"], step: "deductions" },
  { patterns: ["import", "form 16", "csv", "json"], step: "imports" },
  { patterns: ["report", "explain", "compare", "result", "download"], step: "results" },
  { patterns: ["privacy", "profile", "age", "period", "regime", "taxpayer", "residency"], step: "profile" },
  { patterns: ["readiness", "feedback", "support", "regression", "beta"], step: "launch" }
];

export function buildChatbotResponse(request = {}) {
  return buildDeterministicChatbotResponse(request, { includeFallback: true });
}

export async function buildChatbotResponseAsync(request = {}, options = {}) {
  const deterministic = buildDeterministicChatbotResponse(request, { includeFallback: false });
  if (deterministic) return deterministic;

  const retrieval = await buildKnowledgeRetrievalResponse(request, options);
  if (retrieval) return retrieval;

  return response({
    reply: GENERIC_FALLBACK_REPLY,
    confidence: 0.72,
    citations: citation("Application guide", "usage-guide"),
    actions: [],
    match_source: "deterministic_fallback"
  });
}

function buildDeterministicChatbotResponse(request = {}, { includeFallback = true } = {}) {
  const rawMessage = String(request.message ?? "").trim();
  const normalized = normalize(rawMessage);

  if (!normalized) {
    return response({
      reply: "I can help with this calculator. Ask where to enter a value, what an error means, or ask me to fill one supported field.",
      confidence: 0.9,
      citations: citation("Application guide", "usage-guide"),
      match_source: "deterministic"
    });
  }

  if (isOutOfScope(normalized)) {
    return response({
      scope: "out_of_scope",
      reply: "I can help with this calculator, but I can’t answer questions outside the app or provide personal tax, legal, or investment advice.",
      confidence: 0.98,
      citations: [],
      actions: [],
      match_source: "guardrail_refusal"
    });
  }

  const actions = parseActions(normalized, rawMessage);
  if (actions.length > 0) {
    const uniqueActions = dedupeActions(actions);
    const userValueActions = uniqueActions.filter((action) => ["set_value", "set_radio"].includes(action.type));
    const fieldLabels = uniqueActions
      .filter((action) => action.type !== "set_checked" && action.type !== "navigate")
      .map((action) => `${action.label}${action.value !== undefined ? ` to ${formatActionValue(action.value, action.kind)}` : ""}`);
    const replyTarget = fieldLabels.length ? fieldLabels.join(", ") : "the requested app fields";
    const requiresReview = userValueActions.length > 1;
    return response({
      reply: `I can help with that. I found ${replyTarget}. ${requiresReview ? "Please review the suggested changes before applying them." : "I’ll update it now."}`,
      confidence: 0.95,
      citations: citationsForActions(uniqueActions),
      actions: uniqueActions,
      requires_confirmation: requiresReview,
      match_source: "deterministic_action"
    });
  }

  const errorHelp = findErrorHelp(normalized);
  if (errorHelp) {
    return response({
      reply: `I can help with that. ${errorHelp.reply}`,
      confidence: 0.93,
      citations: citation(`${STEP_GUIDES[errorHelp.step].label} page guide`, STEP_GUIDES[errorHelp.step].target),
      actions: [{ type: "navigate", step: errorHelp.step, label: `${STEP_GUIDES[errorHelp.step].label} step` }],
      match_source: "deterministic_error_help"
    });
  }

  const aiReviewHelp = findAiReviewHelp(normalized, request.form_state);
  if (aiReviewHelp) return aiReviewHelp;

  const activeStepHelp = findActiveStepHelp(normalized, request.form_state);
  if (activeStepHelp) return activeStepHelp;

  const resultSummaryHelp = findResultSummaryHelp(normalized, request.form_state);
  if (resultSummaryHelp) return resultSummaryHelp;

  const exactKnowledge = findExactKnowledgeMatch(normalized, CHATBOT_KNOWLEDGE.filter((entry) => !entry.refusal));
  if (exactKnowledge) {
    return knowledgeResponse(exactKnowledge.entry, exactKnowledge.score, "knowledge_exact");
  }

  const helpStep = findHelpStep(normalized);
  if (helpStep) {
    const guide = STEP_GUIDES[helpStep];
    return response({
      reply: `I can help with that. ${guide.reply}`,
      confidence: 0.9,
      citations: citation(`${guide.label} page guide`, guide.target),
      actions: [{ type: "navigate", step: helpStep, label: `${guide.label} step` }],
      match_source: "deterministic_keyword"
    });
  }

  if (!includeFallback) return null;

  return response({
    reply: GENERIC_FALLBACK_REPLY,
    confidence: 0.72,
    citations: citation("Application guide", "usage-guide"),
    actions: [],
    match_source: "deterministic_fallback"
  });
}

let featureExtractorPromise;
let featureExtractorModel = "";
let knowledgeEmbeddingPromise;
let knowledgeEmbeddingModel = "";

async function buildKnowledgeRetrievalResponse(request = {}, options = {}) {
  const rawMessage = String(request.message ?? "").trim();
  const normalized = normalize(rawMessage);
  if (!normalized) return null;

  const config = getAiConfig(options);
  const candidates = CHATBOT_KNOWLEDGE.filter((entry) => !entry.refusal);
  const exactMatch = findExactKnowledgeMatch(normalized, candidates);
  if (exactMatch) return knowledgeResponse(exactMatch.entry, exactMatch.score, "knowledge_exact");

  const keywordMatch = findKeywordKnowledgeMatch(normalized, candidates);
  if (keywordMatch && keywordMatch.score >= 0.88) {
    return knowledgeResponse(keywordMatch.entry, keywordMatch.score, "knowledge_keyword");
  }

  if (typeof options.retriever === "function") {
    const injectedMatch = await options.retriever({
      message: rawMessage,
      normalized,
      entries: candidates,
      minScore: config.minScore
    });
    const entry = resolveKnowledgeEntry(injectedMatch?.entry ?? injectedMatch?.id, candidates);
    if (entry && Number(injectedMatch.score ?? 0) >= config.minScore) {
      return knowledgeResponse(entry, injectedMatch.score, injectedMatch.source ?? "local_ml_retrieval");
    }
  }

  if (!config.enabled) {
    if (keywordMatch && keywordMatch.score >= config.minScore) {
      return knowledgeResponse(keywordMatch.entry, keywordMatch.score, "knowledge_keyword");
    }
    return null;
  }

  try {
    const modelRetriever = options.modelRetriever ?? findModelKnowledgeMatch;
    const modelMatch = await modelRetriever(rawMessage, candidates, config);
    if (modelMatch && modelMatch.score >= config.minScore) {
      return knowledgeResponse(modelMatch.entry, modelMatch.score, "local_ml_retrieval");
    }
  } catch {
    if (keywordMatch && keywordMatch.score >= config.minScore) {
      return knowledgeResponse(keywordMatch.entry, keywordMatch.score, "knowledge_keyword_fallback", "model_fallback");
    }
  }

  if (keywordMatch && keywordMatch.score >= config.minScore) {
    return knowledgeResponse(keywordMatch.entry, keywordMatch.score, "knowledge_keyword");
  }

  return null;
}

function findActiveStepHelp(message, formState = {}) {
  const asksCurrentStep = message.includes("current step") ||
    message.includes("this step") ||
    message.includes("next action");
  if (!asksCurrentStep) return null;

  const step = STEP_GUIDES[String(formState?.active_step ?? "profile")] ? String(formState.active_step) : "profile";
  const guide = STEP_GUIDES[step];
  return response({
    reply: `I can help with that. You are on ${guide.label}. ${guide.reply} When the visible fields look right, use the highlighted next action in the side rail.`,
    confidence: 0.92,
    citations: citation(`${guide.label} page guide`, guide.target),
    actions: [{ type: "navigate", step, label: `${guide.label} step` }],
    match_source: "deterministic_active_step"
  });
}

function findResultSummaryHelp(message, formState = {}) {
  const asksResult = message.includes("explain my result") ||
    message.includes("result summary") ||
    message.includes("why this result") ||
    message.includes("explain the result");
  if (!asksResult) return null;

  const hasCompute = Boolean(formState?.has_compute_result);
  const hasComparison = Boolean(formState?.has_comparison);
  const next = hasCompute
    ? hasComparison
      ? "Review the Plain-English result, Tax waterfall, comparison banner, warnings, and then use Explain for the worksheet and source trace."
      : "Review the Plain-English result and Tax waterfall, then use Compare regimes to see the lower regime for the same inputs."
    : "Run Compute first so the app can show the Plain-English result and Tax waterfall.";

  return response({
    reply: `I can help with that. ${next}`,
    confidence: 0.91,
    citations: citation("Results page guide", "usage-guide-results"),
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    match_source: "deterministic_result_summary"
  });
}

function findAiReviewHelp(message, formState = {}) {
  const asksReview = message.includes("what am i missing") ||
    message.includes("check this step") ||
    message.includes("explain this warning") ||
    message.includes("accuracy review") ||
    message.includes("ai review");
  if (!asksReview) return null;

  const review = formState?.ai_review;
  const findings = Array.isArray(review?.findings) ? review.findings : [];
  const topFinding = findings.find((item) => item.severity === "blocker" || item.severity === "warning") ?? findings[0];
  if (!topFinding) {
    return response({
      reply: "I can help with that. The AI Review Center does not show missing fields or warnings for the latest review. If you changed values, run AI Review again, then Compute or Explain from Results.",
      confidence: 0.9,
      citations: citation("Results page guide", "usage-guide-results"),
      actions: [{ type: "navigate", step: "results", label: "Results step" }],
      match_source: "deterministic_ai_review"
    });
  }

  const step = stepForReviewFinding(topFinding) ?? String(formState.active_step ?? "results");
  const guide = STEP_GUIDES[step] ?? STEP_GUIDES.results;
  return response({
    reply: `I can help with that. AI Review is highlighting: ${topFinding.title}. ${topFinding.message} Next action: ${topFinding.action}`,
    confidence: 0.92,
    citations: citation(`${guide.label} page guide`, guide.target),
    actions: [{ type: "navigate", step, label: `${guide.label} step` }],
    match_source: "deterministic_ai_review"
  });
}

function stepForReviewFinding(finding) {
  const fields = finding?.related_field_ids ?? [];
  if (fields.some((field) => /^period|^act$|^taxpayer|^residency|^age|^regime/.test(String(field)))) return "profile";
  if (fields.some((field) => /^import|pdf|extraction/.test(String(field)))) return "imports";
  if (fields.some((field) => /^income|gross_salary|hra|rent|capital|business|interest/.test(String(field)))) return "income";
  if (fields.some((field) => /^deductions|deduction/.test(String(field)))) return "deductions";
  if (fields.some((field) => /^tax_credits|tds|tcs|advance_tax|self_assessment_tax/.test(String(field)))) return "credits";
  return "results";
}

function findExactKnowledgeMatch(message, entries) {
  for (const entry of entries) {
    for (const question of entry.questions) {
      const candidate = normalize(question);
      if (candidate === message || candidate.includes(message) || message.includes(candidate)) {
        return { entry, score: 1 };
      }
    }
  }
  return null;
}

function findKeywordKnowledgeMatch(message, entries) {
  const queryTokens = tokenSet(message);
  if (queryTokens.size === 0) return null;

  return entries
    .map((entry) => ({ entry, score: scoreKnowledgeEntry(queryTokens, entry) }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function scoreKnowledgeEntry(queryTokens, entry) {
  const searchableTexts = [
    ...entry.questions,
    entry.feature,
    entry.task,
    ...(entry.tags ?? [])
  ];
  return Math.max(...searchableTexts.map((text) => overlapScore(queryTokens, tokenSet(text))), 0);
}

function overlapScore(queryTokens, candidateTokens) {
  if (candidateTokens.size === 0) return 0;
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matches += 1;
  }
  return matches / Math.max(queryTokens.size, 1);
}

async function findModelKnowledgeMatch(message, entries, config) {
  const queryEmbedding = await embedText(message, config.model);
  const entryEmbeddings = await getKnowledgeEmbeddings(entries, config.model);
  let best = null;
  for (const item of entryEmbeddings) {
    const score = cosineSimilarity(queryEmbedding, item.embedding);
    if (!best || score > best.score) best = { entry: item.entry, score };
  }
  return best;
}

async function getKnowledgeEmbeddings(entries, model) {
  if (!knowledgeEmbeddingPromise || knowledgeEmbeddingModel !== model) {
    knowledgeEmbeddingModel = model;
    knowledgeEmbeddingPromise = Promise.all(entries.map(async (entry) => {
      return {
        entry,
        embedding: await embedText(knowledgeEmbeddingText(entry), model)
      };
    }));
  }
  return knowledgeEmbeddingPromise;
}

async function embedText(text, model) {
  const extractor = await getFeatureExtractor(model);
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data ?? output.tolist?.()?.[0] ?? []);
}

async function getFeatureExtractor(model) {
  if (!featureExtractorPromise || featureExtractorModel !== model) {
    featureExtractorModel = model;
    featureExtractorPromise = import("@huggingface/transformers").then(({ pipeline }) => {
      return pipeline("feature-extraction", model, { dtype: "q8" });
    });
  }
  return featureExtractorPromise;
}

function knowledgeEmbeddingText(entry) {
  return [
    entry.feature,
    entry.task,
    ...entry.questions,
    entry.answer,
    ...(entry.tags ?? [])
  ].join(". ");
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function knowledgeResponse(entry, score, matchSource, aiStatus) {
  return response({
    scope: entry.refusal ? "out_of_scope" : "in_scope",
    reply: entry.refusal ? entry.answer : `I can help with that. ${entry.answer}`,
    confidence: score,
    citations: entry.citations,
    actions: entry.actions,
    requires_confirmation: false,
    match_id: entry.id,
    match_source: matchSource,
    ai_status: aiStatus
  });
}

function resolveKnowledgeEntry(entryOrId, entries) {
  if (!entryOrId) return null;
  if (typeof entryOrId === "object") return entryOrId;
  return entries.find((entry) => entry.id === entryOrId) ?? null;
}

function getAiConfig(options = {}) {
  const env = globalThis.process?.env ?? {};
  const parsedMinScore = Number.parseFloat(String(options.minScore ?? env.CHATBOT_AI_MIN_SCORE ?? DEFAULT_AI_MIN_SCORE));
  return {
    enabled: options.aiEnabled ?? parseBoolean(env.CHATBOT_AI_ENABLED, true),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : DEFAULT_AI_MIN_SCORE,
    model: String(options.model ?? env.CHATBOT_AI_MODEL ?? DEFAULT_AI_MODEL)
  };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}

function field(name, label, step, aliases, kind, options = {}) {
  return { name, label, step, aliases, kind, ...options };
}

function response({
  status = "ok",
  scope = "in_scope",
  reply,
  confidence = 0.8,
  citations = [],
  actions = [],
  requires_confirmation = false,
  match_id,
  match_source,
  ai_status
}) {
  const body = {
    status,
    scope,
    reply,
    confidence: roundConfidence(confidence),
    citations,
    actions,
    requires_confirmation: Boolean(requires_confirmation)
  };
  if (match_id) body.match_id = match_id;
  if (match_source) body.match_source = match_source;
  if (ai_status) body.ai_status = ai_status;
  return body;
}

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[₹,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "can",
    "do",
    "does",
    "for",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "should",
    "the",
    "this",
    "to",
    "use",
    "what",
    "where",
    "why"
  ]);
  return new Set(
    normalize(value)
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token))
  );
}

function roundConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function isOutOfScope(message) {
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => message.includes(pattern));
}

function parseActions(normalized, rawMessage) {
  const actions = [];
  const regime = parseRegime(normalized);
  if (regime) {
    actions.push({ type: "set_radio", field: "regime", value: regime, label: "Preferred regime", step: "profile", kind: "select" });
  }

  for (const definition of FIELD_DEFINITIONS) {
    const parsed = parseFieldValue(normalized, rawMessage, definition);
    if (parsed === undefined) continue;
    actions.push(...(definition.preActions ?? []));
    actions.push({
      type: "set_value",
      field: definition.name,
      value: parsed,
      label: definition.label,
      step: definition.step,
      kind: definition.kind
    });
  }

  const navigateStep = parseNavigation(normalized);
  if (navigateStep && actions.length === 0) {
    actions.push({ type: "navigate", step: navigateStep, label: `${STEP_GUIDES[navigateStep].label} step` });
  }

  return actions;
}

function parseRegime(message) {
  if (!hasActionVerb(message)) return "";
  if (/\b(old regime|regime old)\b/.test(message)) return "old";
  if (/\b(new regime|regime new)\b/.test(message)) return "new";
  return "";
}

function parseNavigation(message) {
  if (!/\b(go|open|show|take me|navigate|move)\b/.test(message)) return "";
  return Object.entries(STEP_GUIDES).find(([step, guide]) => {
    return message.includes(step) || message.includes(guide.label.toLowerCase());
  })?.[0] ?? "";
}

function parseFieldValue(normalized, rawMessage, definition) {
  if (!definition.aliases.some((alias) => normalized.includes(alias))) return undefined;
  if (!hasActionVerb(normalized) && !looksLikeAssignment(normalized, definition.aliases)) return undefined;

  if (definition.kind === "number") return parseNumberForAliases(normalized, definition.aliases);
  if (definition.kind === "date") return parseDate(rawMessage);
  if (definition.kind === "select") return parseSelectValue(normalized, definition);
  if (definition.kind === "text") return parseTextValue(rawMessage, definition.aliases);
  return undefined;
}

function hasActionVerb(message) {
  return /\b(set|fill|enter|choose|select|change|update|make|put|use|mark|tick|check|add)\b/.test(message);
}

function looksLikeAssignment(message, aliases) {
  return aliases.some((alias) => new RegExp(`${escapeRegExp(alias)}\\s*(is|=|to|as)\\s+`, "i").test(message));
}

function parseNumberForAliases(message, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(`${escapeRegExp(alias)}(?:\\s+(?:to|as|is|=))?\\s+([0-9]+(?:\\.[0-9]+)?)(?:\\s*(lakh|lac|crore|cr))?`, "i");
    const match = message.match(pattern);
    if (!match) continue;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return undefined;
    const multiplier = ["lakh", "lac"].includes(match[2]) ? 100000 : ["crore", "cr"].includes(match[2]) ? 10000000 : 1;
    return String(Math.round(amount * multiplier));
  }
  const fallback = message.match(/([0-9]+(?:\.[0-9]+)?)(?:\s*(lakh|lac|crore|cr))?/i);
  if (!fallback) return undefined;
  const amount = Number.parseFloat(fallback[1]);
  const multiplier = ["lakh", "lac"].includes(fallback[2]) ? 100000 : ["crore", "cr"].includes(fallback[2]) ? 10000000 : 1;
  return String(Math.round(amount * multiplier));
}

function parseDate(message) {
  return message.match(/\b(20[0-9]{2}-[01][0-9]-[0-3][0-9])\b/)?.[1];
}

function parseSelectValue(message, definition) {
  for (const allowed of definition.values ?? []) {
    if (message.includes(allowed.toLowerCase())) return allowed;
  }
  if (definition.name === "taxpayer_type" && message.includes("huf")) return "huf";
  if (definition.name === "taxpayer_type" && message.includes("individual")) return "individual";
  if (definition.name === "residency" && message.includes("non resident")) return "non_resident";
  if (definition.name === "residency" && message.includes("resident")) return "resident";
  if (definition.name === "business_section" && message.includes("normal")) return "normal_business";
  return undefined;
}

function parseTextValue(rawMessage, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(`${escapeRegExp(alias)}(?:\\s+(?:to|as|is|=))\\s+(.+)$`, "i");
    const match = rawMessage.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function findErrorHelp(message) {
  return ERROR_GUIDANCE.find((item) => item.patterns.some((pattern) => message.includes(pattern)));
}

function findHelpStep(message) {
  if (/\b(where|how|what|help|meaning|mean|enter|use)\b/.test(message)) {
    return QUICK_HELP_PATTERNS.find((item) => item.patterns.some((pattern) => message.includes(pattern)))?.step;
  }
  return "";
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.type}:${action.field ?? action.step}:${action.value ?? action.checked ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function citationsForActions(actions) {
  const targets = new Map();
  for (const action of actions) {
    const step = action.step;
    if (step && STEP_GUIDES[step]) targets.set(STEP_GUIDES[step].target, `${STEP_GUIDES[step].label} page guide`);
  }
  return [...targets.entries()].map(([target, label]) => ({ label, target }));
}

function citation(label, target) {
  return [{ label, target }];
}

function formatActionValue(value, kind) {
  if (kind === "number") return RUPEE_FORMATTER.format(Number(value));
  return String(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
