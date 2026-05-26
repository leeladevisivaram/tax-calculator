import {
  renderMissingElementMessage,
  validateActionInputValues,
  validateRequiredElements
} from "./ui-validation.js";
import { isSavedScenario, parseStoredJsonValue } from "./storage-state.js";

const form = document.querySelector("#tax-wizard");
const panels = [...document.querySelectorAll("[data-panel]")];
const tabs = [...document.querySelectorAll("[data-step]")];
const validationOutput = document.querySelector("#validation-output");
const importOutput = document.querySelector("#import-output");
const importFileStatus = document.querySelector("#import-file-status");
const resultOutput = document.querySelector("#result-output");
const comparisonOutput = document.querySelector("#comparison-output");
const reportOutput = document.querySelector("#report-output");
const resultExplainSummary = document.querySelector("#result-explain-summary");
const taxWaterfall = document.querySelector("#tax-waterfall");
const aiReviewCenter = document.querySelector("#ai-review-center");
const privacyOutput = document.querySelector("#privacy-output");
const launchOutput = document.querySelector("#launch-output");
const apiStatus = document.querySelector("#api-status");
const draftStatus = document.querySelector("#draft-status");
const summaryPeriod = document.querySelector("#summary-period");
const summaryRegime = document.querySelector("#summary-regime");
const summaryIncome = document.querySelector("#summary-income");
const summaryPayable = document.querySelector("#summary-payable");
const summaryNote = document.querySelector("#summary-note");
const summaryStepHealth = document.querySelector("#summary-step-health");
const summaryConfidence = document.querySelector("#summary-confidence");
const guidedChecklist = document.querySelector("#guided-checklist");
const nextActionHint = document.querySelector("#next-action-hint");
const scenarioOutput = document.querySelector("#scenario-output");
const guideDialog = document.querySelector("#usage-guide");
const guideCloseButton = document.querySelector("#close-application-guide-button");
const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});
const RULES_LAST_UPDATED = "2026-05-08";

let activeStep = 0;
let lastReport = null;
let lastImportPreview = null;
let lastPdfExtraction = null;
let lastComputeResult = null;
let lastAiReview = null;
let lastComparison = null;
let lastGuideOpener = null;
let selectedPersona = "";
let guidedModeEnabled = true;
let stepHealthState = {};
let savedScenarios = [];
let reviewDismissals = [];

const stepOrder = ["profile", "imports", "income", "deductions", "credits", "results", "launch"];
const personaConfigs = {
  salaried: {
    label: "Salaried",
    firstStep: "income",
    heads: ["salary"],
    checklist: [
      "Confirm Profile, age, residency, and regime.",
      "Enter gross salary and only the allowance values you know.",
      "Add 80C, 80D, and TDS if available.",
      "Run Validate, Compute, Compare regimes, and Explain."
    ],
    values: {}
  },
  investor: {
    label: "Investor",
    firstStep: "income",
    heads: ["capital_gains", "other_sources"],
    checklist: [
      "Confirm Profile first.",
      "Select Capital gains and enter section, transfer date, and net gain.",
      "Add interest income only if applicable.",
      "Run Validate before relying on special-rate results."
    ],
    values: { capital_gain_section: "112A" }
  },
  freelancer: {
    label: "Freelancer",
    firstStep: "income",
    heads: ["business"],
    checklist: [
      "Confirm Profile and regime.",
      "Select 44ADA or normal business based on your records.",
      "Enter receipts, cash receipts, and tax credits.",
      "Use warnings to review presumptive-tax eligibility."
    ],
    values: { business_section: "44ADA" }
  },
  senior: {
    label: "Senior Citizen",
    firstStep: "profile",
    heads: ["salary", "other_sources"],
    checklist: [
      "Set age to the correct senior-citizen band.",
      "Enter pension or salary values if applicable.",
      "Add interest income and senior-related health deduction claims.",
      "Compare regimes after validation."
    ],
    values: { age_years: "61", deduction_80d_parent_senior: true }
  },
  professional: {
    label: "Tax Professional",
    firstStep: "results",
    heads: ["salary", "capital_gains", "business", "other_sources"],
    checklist: [
      "Build the full scenario from source records.",
      "Run Validate and Compute.",
      "Use Explain to inspect worksheet, source register, and computation hash.",
      "Download JSON or HTML for review evidence."
    ],
    values: {}
  }
};
const startupValidation = validateRequiredElements(document);
if (!startupValidation.valid) renderMissingElementMessage(document, startupValidation);

document.addEventListener("DOMContentLoaded", async () => {
  if (!startupValidation.valid) return;
  restoreDraft();
  restoreBeginnerState();
  restoreSavedScenarios();
  restoreAiReviewState();
  bindEvents();
  await checkApi();
  renderStep();
  updateRegimeHints();
  updateIncomeSections();
  updateLanguagePreference();
  updateGuidedChecklist();
  updateStepHealth();
  updateRecommendedAction();
  updateSummary();
});

function bindEvents() {
  bindSkipLinks();
  bindGuideDialog();
  bindBeginnerMode();
  bindActionMenus();

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeStep = stepOrder.indexOf(tab.dataset.step);
      renderStep();
    });
  });

  document.querySelectorAll("[data-jump-step]").forEach((button) => {
    button.addEventListener("click", () => {
      jumpToStep(button.dataset.jumpStep);
    });
  });

  document.querySelectorAll("[data-income-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      updateIncomeSections();
      updateSummary();
    });
  });

  document.querySelector("#prev-step").addEventListener("click", () => {
    activeStep = Math.max(0, activeStep - 1);
    renderStep();
  });

  document.querySelector("#next-step").addEventListener("click", () => {
    activeStep = Math.min(stepOrder.length - 1, activeStep + 1);
    renderStep();
  });

  bindAsyncAction("#validate-button", validateScenario);
  bindAsyncAction("#preview-import-button", previewImport);
  bindAsyncAction("#apply-import-button", applyImport);
  form.import_file.addEventListener("change", handleImportFileSelected);
  bindAsyncAction("#compute-button", computeScenario);
  bindAsyncAction("#ai-review-button", runAiReview);
  bindAsyncAction("#compare-button", compareRegimes);
  bindAsyncAction("#explain-button", explainScenario);
  document.querySelector("#download-json-button").addEventListener("click", downloadJsonReport);
  document.querySelector("#download-html-button").addEventListener("click", downloadHtmlReport);
  bindAsyncAction("#load-privacy-button", loadPrivacyPolicy);
  bindAsyncAction("#export-local-data-button", exportLocalData);
  bindAsyncAction("#delete-local-data-button", deleteLocalData);
  bindAsyncAction("#load-beta-plan-button", loadBetaPlan);
  bindAsyncAction("#run-regression-button", runLaunchRegression);
  bindAsyncAction("#check-readiness-button", checkLaunchReadiness);
  bindAsyncAction("#load-legal-support-button", loadLegalSupport);
  bindAsyncAction("#classify-feedback-button", classifyFeedback);
  document.querySelector("#add-capital-gain-button").addEventListener("click", addCapitalGainRow);
  document.querySelector("#delete-capital-gain-button").addEventListener("click", deleteCapitalGainRow);
  document.querySelector("#scenario-save-button").addEventListener("click", saveWhatIfScenario);
  document.querySelector("#scenario-duplicate-button").addEventListener("click", duplicateLatestScenario);
  document.querySelector("#scenario-compare-button").addEventListener("click", compareWhatIfScenario);
  form.business_section.addEventListener("change", updateBusinessMode);
  form.language.addEventListener("change", updateLanguagePreference);
  document.querySelector("#save-button").addEventListener("click", saveDraft);
  document.querySelector("#reset-button").addEventListener("click", resetDraft);
  form.addEventListener("input", () => {
    draftStatus.textContent = "Draft has unsaved changes";
    form.querySelectorAll("[aria-invalid='true']").forEach((field) => field.removeAttribute("aria-invalid"));
    updateRegimeHints();
    updateStepHealth();
    updateRecommendedAction();
    updateSummary();
  });
}

function bindSkipLinks() {
  document.querySelectorAll(".skip-link[href^='#']").forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      if (target.id === "tax-wizard") {
        document.querySelector("[data-testid='calculator-tab']")?.click();
      }
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      });
    });
  });
}

function bindActionMenus() {
  const menus = [...document.querySelectorAll(".action-menu")];
  menus.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      menus.forEach((candidate) => {
        if (candidate !== menu) candidate.open = false;
      });
    });

    menu.querySelectorAll(".action-menu-panel .button").forEach((button) => {
      button.addEventListener("click", () => {
        menu.open = false;
      });
    });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".action-menu")) return;
    closeActionMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeActionMenus();
  });
}

function closeActionMenus() {
  document.querySelectorAll(".action-menu[open]").forEach((menu) => {
    menu.open = false;
  });
}

function bindBeginnerMode() {
  window.addEventListener("tax-select-start-path", (event) => {
    selectPersona(event.detail?.persona);
  });

  document.querySelectorAll("[data-persona]").forEach((button) => {
    button.addEventListener("click", () => selectPersona(button.dataset.persona));
  });
}

function selectPersona(persona) {
  const config = personaConfigs[persona];
  if (!config) return;
  selectedPersona = persona;
  guidedModeEnabled = true;

  for (const [head, fieldName] of Object.entries({
    salary: "income_head_salary",
    house: "income_head_house",
    other_sources: "income_head_other_sources",
    capital_gains: "income_head_capital_gains",
    business: "income_head_business"
  })) {
    if (form.elements[fieldName]) form.elements[fieldName].checked = config.heads.includes(head);
  }

  for (const [fieldName, fieldValue] of Object.entries(config.values)) {
    const field = form.elements[fieldName];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(fieldValue);
    else field.value = fieldValue;
  }

  persistBeginnerState();
  updatePersonaCards();
  updateIncomeSections();
  updateBusinessMode();
  updateGuidedChecklist();
  updateStepHealth();
  updateRecommendedAction();
  updateSummary();
  jumpToStep(config.firstStep);
  window.dispatchEvent(new CustomEvent("tax-open-tab", { detail: { tab: "calculator" } }));
  draftStatus.textContent = `${config.label} start path selected`;
}

function persistBeginnerState() {
  setStoredItem("guided_mode", JSON.stringify(guidedModeEnabled));
  setStoredItem("selected_persona", selectedPersona);
}

function restoreBeginnerState() {
  const storedGuidedMode = getStoredItem("guided_mode");
  if (storedGuidedMode !== null) {
    guidedModeEnabled = storedGuidedMode !== "false";
  }
  selectedPersona = getStoredItem("selected_persona") ?? "";
  updatePersonaCards();
}

function updatePersonaCards() {
  document.querySelectorAll("[data-persona]").forEach((button) => {
    const selected = button.dataset.persona === selectedPersona;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function updateGuidedChecklist() {
  if (!guidedChecklist) return;
  guidedChecklist.classList.toggle("is-hidden", !guidedModeEnabled);
  if (!guidedModeEnabled) return;

  const config = personaConfigs[selectedPersona];
  const checklist = config?.checklist ?? [
    "Choose a start path to focus the calculator.",
    "Complete Profile and Income before computing.",
    "Use Compare regimes and Explain to review the result."
  ];
  const completeSteps = Object.values(stepHealthState).filter((status) => status === "Complete").length;
  guidedChecklist.innerHTML = `
    <strong>${escapeHtml(config ? `${config.label} checklist` : "Guided checklist")}</strong>
    <ul>${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <small>${completeSteps}/${stepOrder.length} sections currently marked complete.</small>
  `;
}

function bindGuideDialog() {
  document.querySelectorAll("[data-open-guide]").forEach((button) => {
    button.addEventListener("click", () => openGuideDialog(button));
  });

  guideCloseButton.addEventListener("click", closeGuideDialog);
  guideDialog.addEventListener("click", (event) => {
    if (event.target === guideDialog) closeGuideDialog();
  });
  guideDialog.addEventListener("close", () => {
    lastGuideOpener?.focus({ preventScroll: true });
    lastGuideOpener = null;
  });
}

function openGuideDialog(opener) {
  lastGuideOpener = opener;
  if (window.__taxReactShellReady) {
    window.dispatchEvent(new CustomEvent("tax-open-tab", { detail: { tab: "guide" } }));
    return;
  }
  if (!guideDialog.open && typeof guideDialog.showModal === "function") {
    guideDialog.showModal();
  } else {
    guideDialog.setAttribute("open", "");
  }
  guideCloseButton.focus({ preventScroll: true });
}

function closeGuideDialog() {
  if (window.__taxReactShellReady && document.body.dataset.activeTab === "guide") {
    guideDialog.removeAttribute("open");
    window.dispatchEvent(new CustomEvent("tax-open-tab", { detail: { tab: "start" } }));
    lastGuideOpener?.focus({ preventScroll: true });
    lastGuideOpener = null;
    return;
  }
  if (guideDialog.open && typeof guideDialog.close === "function") {
    guideDialog.close();
    return;
  }
  guideDialog.removeAttribute("open");
  lastGuideOpener?.focus({ preventScroll: true });
  lastGuideOpener = null;
}

function cssEscape(valueToEscape) {
  return String(valueToEscape).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function bindAsyncAction(selector, handler) {
  const button = document.querySelector(selector);
  button.addEventListener("click", async () => {
    await runButtonAction(button, handler);
  });
}

async function runButtonAction(button, handler) {
  const browserValidation = validateBrowserControlValues();
  if (!browserValidation.valid) {
    renderActionError(button.id, new Error(browserValidation.message));
    focusFirstInvalidField();
    return;
  }
  const inputValidation = validateActionInputValues(new FormData(form), button.id);
  if (!inputValidation.valid) {
    renderActionError(button.id, new Error(inputValidation.messages.join(" ")));
    focusMissingActionField(inputValidation.missing[0]);
    return;
  }
  setButtonLoading(button, true);
  try {
    await handler();
  } catch (error) {
    renderActionError(button.id, error);
  } finally {
    setButtonLoading(button, false);
  }
}

function focusFirstInvalidField() {
  const field = form.querySelector("[aria-invalid='true']");
  if (!field) return;
  revealFieldStep(field);
  field.focus({ preventScroll: true });
}

function focusMissingActionField(input) {
  if (!input?.name || input.name === "report_ready") return;
  const field = form.elements[input.name];
  const target = field instanceof RadioNodeList ? [...field][0] : field;
  if (!target) return;
  target.setAttribute("aria-invalid", "true");
  revealFieldStep(target);
  target.focus({ preventScroll: true });
}

function revealFieldStep(field) {
  const panel = field.closest("[data-panel]");
  if (!panel) return;
  const index = stepOrder.indexOf(panel.dataset.panel);
  if (index >= 0) {
    activeStep = index;
    renderStep();
  }
}

function setButtonLoading(button, loading) {
  button.classList.toggle("loading", loading);
  button.disabled = loading;
  button.setAttribute("aria-busy", loading ? "true" : "false");
}

function validateBrowserControlValues() {
  for (const field of form.querySelectorAll("input, select, textarea")) {
    if (field.disabled || field.closest("[data-income-section].is-disabled")) continue;
    if (field.checkValidity()) continue;
    field.setAttribute("aria-invalid", "true");
    const label = field.closest("label")?.querySelector("span")?.textContent?.trim() || field.name || "Field";
    const message = field.validity.rangeUnderflow
      ? `${label} must be zero or more.`
      : field.validationMessage || `${label} contains an invalid value.`;
    return { valid: false, message };
  }
  return { valid: true, message: "" };
}

function renderStep() {
  const activeName = stepOrder[activeStep];
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === activeName));
  tabs.forEach((tab) => {
    const selected = tab.dataset.step === activeName;
    tab.classList.toggle("active", selected);
    if (selected) tab.setAttribute("aria-current", "step");
    else tab.removeAttribute("aria-current");
  });
  document.querySelector("#prev-step").disabled = activeStep === 0;
  document.querySelector("#next-step").disabled = activeStep === stepOrder.length - 1;
  updateStepHealth();
  updateRecommendedAction();
  updateSummary();
}

function jumpToStep(stepName) {
  const index = stepOrder.indexOf(stepName);
  if (index === -1) return;
  activeStep = index;
  renderStep();
}

async function checkApi() {
  try {
    const response = await fetch("/health");
    if (!response.ok) throw new Error("API unavailable");
    apiStatus.textContent = "API connected";
    apiStatus.classList.add("ok");
  } catch {
    apiStatus.textContent = "API unavailable";
    apiStatus.classList.remove("ok");
  }
}

async function validateScenario() {
  const payload = buildRequest({ includeAdvisoryInfo: true });
  const report = await postJson("/api/v1/tax/validate", payload);
  renderValidation(report);
  updateStepHealth(report);
  await runAiReview({ skipStepChange: true });
  activeStep = stepOrder.indexOf("results");
  renderStep();
}

async function computeScenario() {
  const payload = buildRequest({ includeValidation: true });
  const result = await postJson("/api/v1/tax/compute", payload);
  const previousResult = lastComputeResult;
  renderValidation({
    status: result.validation_status ?? "ok",
    summary: result.validation_summary ?? { blockers: 0, warnings: result.warnings?.length ?? 0, infos: 0 },
    results: result.validation_results ?? []
  });
  renderResults(result);
  renderTaxWaterfall(result);
  renderResultExplainSummary(result, { previousResult, comparison: lastComparison });
  lastComputeResult = result;
  updateStepHealth({
    status: result.validation_status ?? "ok",
    results: result.validation_results ?? []
  });
  await runAiReview({ skipStepChange: true });
  updateSummary(result);
  activeStep = stepOrder.indexOf("results");
  renderStep();
}

async function runAiReview(options = {}) {
  const review = await postJson("/api/v1/ai/review-scenario", {
    scenario: buildRequest({ includeValidation: true }),
    active_step: stepOrder[activeStep] ?? "profile",
    import_extraction: lastPdfExtraction,
    previous_scenario: savedScenarios[0]?.request ?? null,
    dismissed_finding_ids: reviewDismissals
  });
  lastAiReview = review;
  setStoredItem("ai_review", JSON.stringify(review));
  setStoredItem("review_dismissals", JSON.stringify(reviewDismissals));
  renderAiReview(review);
  updateSummary(lastComputeResult);
  if (!options.skipStepChange) {
    activeStep = stepOrder.indexOf("results");
    renderStep();
  }
  return review;
}

async function compareRegimes() {
  const payload = buildRequest();
  const comparison = await postJson("/api/v1/tax/compare-regimes", payload);
  lastComparison = comparison;
  renderComparison(comparison);
  renderResultExplainSummary(lastComputeResult, { comparison });
  activeStep = stepOrder.indexOf("results");
  renderStep();
}

async function explainScenario() {
  const payload = buildRequest();
  const report = await postJson("/api/v1/reports/explain", payload);
  lastReport = report;
  renderReport(report);
  activeStep = stepOrder.indexOf("results");
  renderStep();
}

async function previewImport() {
  lastPdfExtraction = null;
  const data = new FormData(form);
  const preview = await postJson("/api/v1/imports/preview", {
    import_type: value(data, "import_type"),
    filename: value(data, "import_filename"),
    content: value(data, "import_content"),
    user_confirmed: false,
    rejected_groups: selectedRejectedImportGroups()
  });
  lastImportPreview = preview;
  renderImportPreview(preview);
  await runAiReview({ skipStepChange: true });
}

async function applyImport() {
  const data = new FormData(form);
  const confirmed = form.import_confirmed.checked;
  const preview = await postJson("/api/v1/imports/preview", {
    import_type: value(data, "import_type"),
    filename: value(data, "import_filename"),
    content: value(data, "import_content"),
    user_confirmed: confirmed,
    rejected_groups: selectedRejectedImportGroups()
  });
  lastImportPreview = preview;
  renderImportPreview(preview, lastPdfExtraction);
  if (!confirmed || preview.status !== "ok") return;
  applyRequestPatch(preview.confirmed_request_patch);
  draftStatus.textContent = "Import applied after confirmation";
  await runAiReview({ skipStepChange: true });
  updateSummary();
}

async function handleImportFileSelected() {
  const file = form.import_file.files?.[0];
  if (!file) {
    renderImportFileStatus("No file selected. You can also paste content below.");
    return;
  }

  if (!/\.(csv|json|pdf)$/i.test(file.name)) {
    renderImportFileStatus("Only CSV, JSON, and searchable PDF import files are supported.", "blocker");
    renderActionError("preview-import-button", new Error("Only CSV, JSON, and searchable PDF import files are supported."));
    return;
  }

  try {
    renderImportFileStatus(`Reading ${file.name}...`);
    if (/\.pdf$/i.test(file.name)) {
      await extractPdfImportFile(file);
      return;
    }

    lastPdfExtraction = null;
    const content = await file.text();
    if (!content.trim()) throw new Error("Uploaded import file is empty.");
    form.import_filename.value = file.name;
    form.import_content.value = content;
    form.import_type.value = inferImportTypeFromFile(file.name, content);
    renderImportFileStatus(`Loaded ${file.name}. Preview generated for review before apply.`, "success");
    await previewImport();
  } catch (error) {
    renderImportFileStatus(`Could not read ${file.name}. ${error.message}`, "blocker");
    renderActionError("preview-import-button", error);
  }
}

async function extractPdfImportFile(file) {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("Uploaded PDF is empty.");
  form.import_type.value = "form16";
  renderImportFileStatus(`Extracting Form 16 values from ${file.name}...`);
  const extraction = await postJson("/api/v1/imports/pdf-extract", {
    import_type: "form16",
    filename: file.name,
    content_base64: arrayBufferToBase64(bytes),
    user_confirmed: false,
    rejected_groups: selectedRejectedImportGroups()
  });
  lastPdfExtraction = extraction.extraction;
  lastImportPreview = extraction.preview;
  form.import_filename.value = extraction.converted_filename;
  form.import_content.value = extraction.structured_content;
  const missing = extraction.extraction?.missing_fields ?? [];
  const status = missing.length
    ? `Extracted ${file.name}, but ${missing.join(", ")} needs manual review.`
    : `Extracted ${file.name}. Preview generated for review before apply.`;
  renderImportFileStatus(status, missing.length ? "warning" : "success");
  renderImportPreview(extraction.preview, extraction.extraction);
  await runAiReview({ skipStepChange: true });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function inferImportTypeFromFile(fileName, content) {
  const normalizedName = fileName.toLowerCase();
  const normalizedContent = content.toLowerCase();
  if (normalizedName.includes("capital") || normalizedContent.includes("transfer_date") || normalizedContent.includes("net_gain")) return "capital_gains";
  if (normalizedName.includes("deduction") || normalizedContent.includes("section") && normalizedContent.includes("premium")) return "deductions";
  if (normalizedName.includes("interest") || normalizedContent.includes("payer")) return "interest_dividend";
  return "form16";
}

function renderImportFileStatus(message, kind = "info") {
  importFileStatus.textContent = message;
  importFileStatus.dataset.status = kind;
}

function selectedRejectedImportGroups() {
  return form.import_reject_credits?.checked ? ["credits"] : [];
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await parseJsonResponse(response, path);
  if (!response.ok || body.status === "error") {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

async function fetchJson(path) {
  const response = await fetch(path);
  const body = await parseJsonResponse(response, path);
  if (!response.ok || body.status === "error") {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

async function parseJsonResponse(response, path) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const firstLine = text.trim().split(/\r?\n/)[0] || response.statusText || "non-JSON response";
    throw new Error(`${path} returned ${response.status}: ${firstLine}`);
  }
}

function buildRequest(options = {}) {
  const data = new FormData(form);
  const request = {
    period_type: value(data, "period_type"),
    period: value(data, "period"),
    act: value(data, "act"),
    taxpayer_type: value(data, "taxpayer_type"),
    residency: value(data, "residency"),
    age_years: numberValue(data, "age_years"),
    regime: value(data, "regime"),
    income: {},
    deductions: {
      standard_deduction: form.standard_deduction.checked,
      chapter_via: []
    },
    tax_credits: {
      tds: numberValue(data, "tds"),
      tcs: numberValue(data, "tcs"),
      advance_tax: numberValue(data, "advance_tax"),
      self_assessment_tax: numberValue(data, "self_assessment_tax")
    }
  };

  const salary = isIncomeHeadEnabled("salary") ? buildSalary(data) : {};
  if (Object.keys(salary).length > 0) request.income.salary = salary;

  const houseProperty = isIncomeHeadEnabled("house") ? buildHouseProperty(data) : [];
  if (houseProperty.length > 0) request.income.house_property = houseProperty;

  const otherSources = isIncomeHeadEnabled("other_sources") ? buildOtherSources(data) : [];
  if (otherSources.length > 0) request.income.other_sources = otherSources;

  const capitalGains = isIncomeHeadEnabled("capital_gains") ? buildCapitalGains(data) : [];
  if (capitalGains.length > 0) request.income.capital_gains = capitalGains;

  const business = isIncomeHeadEnabled("business") ? buildBusiness(data) : [];
  if (business.length > 0) request.income.business_profession = business;

  const ltaClaim = numberValue(data, "lta_claim");
  if (ltaClaim > 0 || numberValue(data, "lta_journeys") > 0) {
    request.claims = {
      lta: {
        journeys_already_claimed_in_block: numberValue(data, "lta_journeys"),
        current_claim_amount: ltaClaim
      }
    };
  }

  request.deductions.chapter_via = buildDeductions(data);

  if (options.includeValidation || options.includeAdvisoryInfo) {
    request.options = {};
    if (options.includeValidation) request.options.include_validation = true;
    if (options.includeAdvisoryInfo) request.options.include_advisory_info = true;
  }

  return request;
}

function buildSalary(data) {
  const salary = {};
  assignNumber(salary, "gross_salary", data, "gross_salary");
  assignNumber(salary, "basic_salary", data, "basic_salary");
  assignNumber(salary, "hra_received", data, "hra_received");
  assignNumber(salary, "rent_paid", data, "rent_paid");
  assignNumber(salary, "lta_received", data, "lta_received");
  if (form.metro_city.checked) salary.metro_city = true;
  return removeZeroOnlySalary(salary);
}

function buildHouseProperty(data) {
  const properties = [];
  const selfOccupiedInterest = numberValue(data, "self_occupied_interest");
  const letOutLoss = numberValue(data, "let_out_loss");
  if (selfOccupiedInterest > 0) {
    properties.push({
      property_type: "self_occupied",
      loan_purpose: "purchase",
      interest_paid: selfOccupiedInterest
    });
  }
  if (letOutLoss > 0) {
    properties.push({
      property_type: "let_out",
      computed_loss: letOutLoss
    });
  }
  return properties;
}

function buildOtherSources(data) {
  const interestIncome = numberValue(data, "interest_income");
  return interestIncome > 0 ? [{ type: "interest", amount: interestIncome }] : [];
}

function buildCapitalGains(data) {
  const section = value(data, "capital_gain_section");
  const netGain = numberValue(data, "capital_gain_net_gain");
  if (!section || netGain <= 0) return [];
  return [{
    section,
    transfer_date: value(data, "capital_gain_transfer_date"),
    net_gain: netGain,
    stt_paid: form.capital_gain_stt_paid.checked
  }];
}

function buildBusiness(data) {
  const section = value(data, "business_section");
  if (!section) return [];

  if (section === "44AD") {
    return [{
      section,
      turnover: numberValue(data, "business_receipts"),
      cash_receipts: numberValue(data, "business_cash_receipts"),
      digital_receipts: numberValue(data, "business_digital_receipts")
    }];
  }

  if (section === "44ADA") {
    return [{
      section,
      gross_receipts: numberValue(data, "business_receipts"),
      cash_receipts: numberValue(data, "business_cash_receipts")
    }];
  }

  return [{
    type: section,
    net_income: numberValue(data, "business_net_income")
  }];
}

function buildDeductions(data) {
  const deductions = [];
  pushAmount(deductions, "80C", numberValue(data, "deduction_80c"));

  const selfPremium = numberValue(data, "deduction_80d_self_premium");
  const selfPreventive = numberValue(data, "deduction_80d_self_preventive");
  if (selfPremium > 0 || selfPreventive > 0) {
    deductions.push({
      section: "80D",
      bucket: "self_family",
      premium: selfPremium,
      preventive_checkup: selfPreventive,
      senior: false
    });
  }

  const parentPremium = numberValue(data, "deduction_80d_parent_premium");
  const parentPreventive = numberValue(data, "deduction_80d_parent_preventive");
  if (parentPremium > 0 || parentPreventive > 0) {
    deductions.push({
      section: "80D",
      bucket: "parents",
      premium: parentPremium,
      preventive_checkup: parentPreventive,
      senior: form.deduction_80d_parent_senior.checked
    });
  }

  const eightyGgRent = numberValue(data, "deduction_80gg_rent");
  if (eightyGgRent > 0) {
    deductions.push({
      section: "80GG",
      rent_paid: eightyGgRent,
      specified_total_income: approximateSpecifiedTotalIncome(data),
      form_10ba_acknowledgement: "UI-DRAFT"
    });
  }

  pushAmount(deductions, "80EE", numberValue(data, "deduction_80ee"));
  pushAmount(deductions, "80EEA", numberValue(data, "deduction_80eea"));
  return deductions;
}

function renderValidation(report) {
  const results = report.results ?? [];
  if (results.length === 0) {
    validationOutput.innerHTML = '<div class="notice success" data-testid="validation-success"><strong>No validation messages</strong><span>Inputs are clear for this supported calculation flow.</span></div>';
    return;
  }

  validationOutput.innerHTML = results.map((result) => `
    <div class="notice ${escapeHtml(result.severity)}" data-testid="validation-message">
      <strong>${escapeHtml(result.code)}</strong>
      <span>${escapeHtml(result.field_path)} · ${escapeHtml(result.remediation_hint)}</span>
    </div>
  `).join("");
}

function renderImportPreview(preview, extraction = null) {
  importOutput.classList.remove("empty-state");
  const confidenceByField = extraction?.field_confidence ?? Object.fromEntries((extraction?.review ?? []).map((item) => [item.field, item]));
  const items = preview.review_items.map((item) => `
    <div class="import-review-item" data-testid="import-review-item">
      <strong>${escapeHtml(item.path)}</strong><br>
      <span>${escapeHtml(JSON.stringify(item.proposed_value))}</span><br>
      <small>${escapeHtml(item.confidence)} confidence · ${escapeHtml(item.confirmation_status)}</small>
      ${renderImportFieldConfidence(item, confidenceByField)}
    </div>
  `).join("");
  const warnings = preview.warnings.length ? `<p><strong>Warnings</strong></p><ul>${preview.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
  const errors = preview.errors.length ? `<p><strong>Errors</strong></p><ul>${preview.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : "";
  const unknown = preview.unknown_fields.length ? `<p><strong>Unknown fields</strong> ${escapeHtml(preview.unknown_fields.join(", "))}</p>` : "";
  const rejected = preview.rejected_groups?.length ? `<p><strong>Rejected groups</strong> ${escapeHtml(preview.rejected_groups.join(", "))}</p>` : "";
  const pdfSummary = extraction ? renderPdfExtractionSummary(extraction) : "";

  importOutput.innerHTML = `
    <h3>Import preview</h3>
    <p>${escapeHtml(preview.import_type)} · ${escapeHtml(preview.filename)} · ${escapeHtml(preview.status)}</p>
    ${pdfSummary}
    <p>Artifact ${escapeHtml(preview.import_id)} stored encrypted until ${escapeHtml(preview.artifact_storage.retention_expires_on)}.</p>
    ${items || "<p>No mappable values found.</p>"}
    ${warnings}
    ${errors}
    ${unknown}
    ${rejected}
  `;
}

function renderPdfExtractionSummary(extraction) {
  const fields = Object.entries(extraction.fields ?? {}).map(([field, value]) => `
    <li><strong>${escapeHtml(field)}</strong>: ${escapeHtml(String(value))}</li>
  `).join("");
  const missing = extraction.missing_fields?.length
    ? `<p><strong>Needs manual review</strong> ${escapeHtml(extraction.missing_fields.join(", "))}</p>`
    : "<p><strong>Required fields found</strong> Salary and TDS were extracted from the searchable PDF text.</p>";
  const aiStatus = extraction.ai?.attempted
    ? `AI assist: ${extraction.ai.source}${extraction.ai.model ? ` · ${extraction.ai.model}` : ""}`
    : "Pattern extraction used for this searchable PDF.";
  return `
    <div class="pdf-extract-summary" data-testid="pdf-extract-summary">
      <span class="badge success">PDF reader</span>
      ${missing}
      ${fields ? `<ul>${fields}</ul>` : ""}
      <small>${escapeHtml(aiStatus)}</small>
    </div>
  `;
}

function renderImportFieldConfidence(item, confidenceByField) {
  const field = importPathToPdfField(item.path);
  const confidence = field ? confidenceByField[field] : null;
  if (!confidence) return "";
  const status = confidence.needsReview ? "Needs review" : "Ready";
  const evidence = confidence.evidence ? `<small>Source: ${escapeHtml(confidence.evidence)}</small>` : "";
  return `
    <div class="field-confidence ${confidence.needsReview ? "needs-review" : ""}" data-testid="field-confidence">
      <span>${escapeHtml(status)} · ${escapeHtml(confidence.confidence ?? "low")} confidence · ${escapeHtml(confidence.sourceLabel ?? "PDF extraction")}</span>
      ${evidence}
    </div>
  `;
}

function importPathToPdfField(path) {
  if (path === "income.salary.gross_salary") return "gross_salary";
  if (path === "tax_credits.tds") return "tds";
  if (path.includes("80C")) return "deduction_80c";
  if (path.includes("employer_name")) return "employer_name";
  return "";
}

function renderAiReview(review) {
  if (!review) return;
  const findings = review.findings ?? [];
  const topFindings = findings.slice(0, 5);
  const actions = review.suggested_actions ?? [];
  const scoreKind = review.confidence_label === "high" ? "success" : review.confidence_label === "medium" ? "neutral" : "warning";
  const findingMarkup = topFindings.length
    ? topFindings.map((item) => `
      <div class="ai-finding ${escapeHtml(item.severity)}" data-testid="ai-finding">
        <span class="badge ${item.severity === "blocker" ? "warning" : item.severity === "warning" ? "neutral" : "success"}">${escapeHtml(humanizeLabel(item.severity))}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.message)}</p>
        <small>${escapeHtml(item.action ?? "")}</small>
      </div>
    `).join("")
    : `
      <div class="ai-finding success" data-testid="ai-finding">
        <span class="badge success">Ready</span>
        <strong>No accuracy blockers found</strong>
        <p>The local review did not find missing fields or unusual values for the current scenario.</p>
      </div>
    `;
  const actionMarkup = actions.map((action) => `
    <button type="button" class="button secondary" data-ai-review-action="${escapeHtml(action.step)}" data-testid="ai-next-action">
      ${escapeHtml(action.label)}
    </button>
  `).join("");

  aiReviewCenter.classList.remove("empty-state");
  aiReviewCenter.dataset.readiness = review.readiness;
  aiReviewCenter.innerHTML = `
    <div class="ai-review-header">
      <div>
        <span class="badge ${scoreKind}" data-testid="ai-review-score">Confidence ${Number(review.confidence_score ?? 0)}%</span>
        <h3>AI Review Center</h3>
        <p>${escapeHtml(readinessText(review.readiness))}</p>
      </div>
      <small>Local deterministic review using validation, compute, and import signals.</small>
    </div>
    <div class="ai-review-findings">${findingMarkup}</div>
    ${actionMarkup ? `<div class="ai-review-actions">${actionMarkup}</div>` : ""}
  `;
  aiReviewCenter.querySelectorAll("[data-ai-review-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.aiReviewAction;
      if (step && stepOrder.includes(step)) jumpToStep(step);
    });
  });
}

function readinessText(readiness) {
  return {
    needs_input: "Needs input before the result should be trusted.",
    has_warnings: "Ready with warnings that should be reviewed.",
    ready_to_compute: "Ready to compute with the current supported inputs.",
    complete: "Computed and ready for explanation review."
  }[readiness] ?? "Review the current scenario before relying on it.";
}

function renderResults(result) {
  const summary = result.summary;
  const metrics = [
    ["Payable / refund", summary.refund_or_payable, "primary", "After credits and rebates"],
    ["Gross total income", summary.gross_total_income, "", formatMoneyCompact(summary.gross_total_income)],
    ["Deductions", summary.total_deductions, "", "Allowed under selected regime"],
    ["Total income", summary.total_income, "", formatMoneyCompact(summary.total_income)],
    ["Normal tax", summary.tax_before_rebate],
    ["Special-rate tax", sumSpecialTax(summary.special_rate_tax), sumSpecialTax(summary.special_rate_tax) > 0 ? "warning" : ""],
    ["87A rebate", summary.rebate_87a],
    ["Surcharge", summary.surcharge],
    ["Cess", summary.cess],
    ["Credits", summary.tax_credits],
    ["Net liability", summary.net_tax_liability],
    ["Likely ITR form", result.itr_recommendation]
  ];
  const warnings = result.warnings?.length
    ? `<div class="notice warning" data-testid="result-warnings"><strong>Warnings and assumptions</strong><span>${result.warnings.map(escapeHtml).join(" ")}</span></div>`
    : '<div class="notice info" data-testid="result-assumptions"><strong>Warnings and assumptions</strong><span>No blocker warnings were returned for this supported calculation. Review source trace before filing.</span></div>';

  resultOutput.innerHTML = metrics.map(([label, value, kind, helper]) => `
    <div class="metric ${kind ?? ""}" data-testid="result-metric">
      <span>${escapeHtml(label)}</span>
      <strong ${typeof value === "number" ? 'data-testid="animated-result-amount"' : ""}>${typeof value === "number" ? formatMoney(value) : escapeHtml(value ?? "-")}</strong>
      ${helper ? `<small>${escapeHtml(helper)}</small>` : ""}
    </div>
  `).join("") + warnings;
}

function renderTaxWaterfall(result) {
  const summary = result?.summary;
  if (!summary) return;
  const rows = [
    ["Gross total income", summary.gross_total_income, "positive"],
    ["Allowed deductions", -Math.abs(summary.total_deductions ?? 0), "negative"],
    ["Tax before rebate", (summary.tax_before_rebate ?? 0) + sumSpecialTax(summary.special_rate_tax), "positive"],
    ["87A rebate", -Math.abs(summary.rebate_87a ?? 0), "negative"],
    ["Surcharge and cess", (summary.surcharge ?? 0) + (summary.cess ?? 0), "positive"],
    ["Credits", -Math.abs(summary.tax_credits ?? 0), "negative"],
    ["Payable / refund", summary.refund_or_payable ?? summary.net_tax_liability ?? 0, "final"]
  ];
  const max = Math.max(...rows.map(([, amount]) => Math.abs(Number(amount) || 0)), 1);

  taxWaterfall.classList.remove("empty-state");
  taxWaterfall.innerHTML = `
    <div class="waterfall-header">
      <div>
        <span class="badge neutral">Visual breakdown</span>
        <h3>Tax waterfall</h3>
      </div>
      <small>Amounts come from the backend calculation result.</small>
    </div>
    ${rows.map(([label, amount, kind]) => {
      const width = Math.max(6, Math.round((Math.abs(amount) / max) * 100));
      return `
        <div class="waterfall-row ${kind}">
          <span>${escapeHtml(label)}</span>
          <div class="waterfall-track" aria-hidden="true"><i style="width: ${width}%"></i></div>
          <strong>${formatMoney(amount)}</strong>
        </div>
      `;
    }).join("")}
  `;
}

function renderResultExplainSummary(result, { previousResult = null, comparison = lastComparison } = {}) {
  if (!result?.summary) {
    resultExplainSummary.classList.remove("empty-state");
    resultExplainSummary.innerHTML = `
      <div class="notice info">
        <strong>Compare regimes after compute</strong>
        <span>Compute the scenario first, then compare old and new regimes to see which one is lower for these inputs.</span>
      </div>
    `;
    return;
  }

  const summary = result.summary;
  const payable = summary.refund_or_payable ?? summary.net_tax_liability ?? 0;
  const previousPayable = previousResult?.summary?.refund_or_payable ?? previousResult?.summary?.net_tax_liability;
  const changeText = typeof previousPayable === "number"
    ? `This compute changed payable/refund by ${formatMoney(payable - previousPayable)} from the previous run.`
    : "This is the first computed result for the current browser session.";
  const comparisonText = comparison
    ? `${humanizeLabel(comparison.recommended_regime)} regime is currently lower by ${formatMoney(Math.abs(comparison.delta))}.`
    : "Run Compare regimes to see the lower regime for the same inputs.";
  const deductionText = summary.total_deductions > 0
    ? `${formatMoney(summary.total_deductions)} of deductions were allowed in the selected regime.`
    : "No allowed deductions reduced this result.";
  const creditText = summary.tax_credits > 0
    ? `${formatMoney(summary.tax_credits)} of credits were applied after tax, surcharge, and cess.`
    : "No tax credits were applied.";

  resultExplainSummary.classList.remove("empty-state");
  resultExplainSummary.innerHTML = `
    <div class="result-summary-card">
      <span class="badge success">Plain-English result</span>
      <h3>${payable <= 0 ? "No payable tax for this supported scenario" : `${formatMoney(payable)} payable before filing review`}</h3>
      <p>${escapeHtml(comparisonText)} ${escapeHtml(changeText)}</p>
    </div>
    <div class="result-reasons">
      <div><strong>Income</strong><span>Total income after supported deductions is ${formatMoney(summary.total_income)}.</span></div>
      <div><strong>Deductions</strong><span>${escapeHtml(deductionText)}</span></div>
      <div><strong>Credits</strong><span>${escapeHtml(creditText)}</span></div>
    </div>
  `;
}

function renderComparison(comparison) {
  const recommended = comparison.recommended_regime;
  const oldLiability = comparison.old.net_tax_liability;
  const newLiability = comparison.new.net_tax_liability;
  const lowerText = recommended === "old"
    ? "Old regime is lower for these inputs."
    : "New regime is lower for these inputs.";

  comparisonOutput.innerHTML = `
    <div class="savings-banner" data-testid="regime-savings-banner">
      <strong>${escapeHtml(humanizeLabel(recommended))} regime is lower</strong>
      <span>Estimated difference for this scenario: ${formatMoney(Math.abs(comparison.delta))}.</span>
    </div>
    <div class="section-heading">
      <span class="badge success">Recommended: ${escapeHtml(humanizeLabel(recommended))}</span>
      <h3>Old vs new regime comparison</h3>
      <p>${escapeHtml(lowerText)} Delta: ${formatMoney(comparison.delta)}.</p>
    </div>
    <div class="comparison-cards">
      <div class="comparison-card ${recommended === "old" ? "recommended" : ""}" data-testid="old-regime-card">
        <span class="badge ${recommended === "old" ? "success" : "neutral"}">Old regime</span>
        <strong>${formatMoney(oldLiability)}</strong>
        <small>Includes eligible old-regime deductions where supported.</small>
      </div>
      <div class="comparison-card ${recommended === "new" ? "recommended" : ""}" data-testid="new-regime-card">
        <span class="badge ${recommended === "new" ? "success" : "neutral"}">New regime</span>
        <strong>${formatMoney(newLiability)}</strong>
        <small>Applies new-regime restrictions before compute.</small>
      </div>
      <div class="comparison-card" data-testid="comparison-delta-card">
        <span class="badge neutral">Difference</span>
        <strong>${formatMoney(Math.abs(comparison.delta))}</strong>
        <small>Use this with the warnings and source trace before filing.</small>
      </div>
    </div>
  `;
}

function renderReport(report) {
  const worksheetRows = report.worksheet.map((item) => `
    <tr>
      <td>${item.line_no}</td>
      <td>${escapeHtml(item.label)}</td>
      <td>${item.amount === undefined ? escapeHtml(item.value) : formatMoney(item.amount)}</td>
      <td>${escapeHtml((item.rule_ids ?? []).join(", "))}</td>
      <td>${escapeHtml(item.source_ids.join(", "))}</td>
    </tr>
  `).join("");
  const sourceRows = report.sources.map((source) => `
    <tr>
      <td>${escapeHtml(source.source_id)}</td>
      <td>${escapeHtml(source.title)}</td>
      <td>${escapeHtml(source.retrieved_on)}</td>
    </tr>
  `).join("");
  const assumptions = report.metadata.assumptions.map((assumption) => `
    <div class="notice info" data-testid="report-assumption">
      <strong>Assumption</strong>
      <span>${escapeHtml(assumption)}</span>
    </div>
  `).join("");
  const warningNotices = [
    ...(report.support.warnings ?? []).map((warning) => ({
      title: "Warning",
      message: warning
    })),
    ...(report.support.validation_results ?? []).map((result) => ({
      title: result.code,
      message: `${result.field_path} · ${result.remediation_hint}`
    }))
  ].map((notice) => `
    <div class="notice warning" data-testid="report-warning">
      <strong>${escapeHtml(notice.title)}</strong>
      <span>${escapeHtml(notice.message)}</span>
    </div>
  `).join("");
  const citationNotes = (report.citation_notes ?? []).map((note) => `
    <div class="notice info" data-testid="citation-note">
      <strong>${escapeHtml(note.source_id)}</strong>
      <span>${escapeHtml(note.note)}</span>
    </div>
  `).join("");

  reportOutput.innerHTML = `
    <h3>Calculation worksheet and source trace</h3>
    <div class="report-meta" data-testid="report-meta">
      <div data-testid="report-meta-rulepack"><strong>Rulepack</strong><br>${escapeHtml(displayVersion(report.metadata.rulepack_version))}</div>
      <div data-testid="report-meta-computation-hash"><strong>Computation hash</strong><br>${escapeHtml(report.support.computation_hash)}</div>
      <div data-testid="report-meta-source-register"><strong>Source register</strong><br>${escapeHtml(displayVersion(report.metadata.source_register_version))}</div>
    </div>
    <div class="notice info" data-testid="report-disclaimer">
      <strong>Important disclaimer</strong>
      <span>${escapeHtml(report.metadata.disclaimer ?? "This estimate is for supported scenarios and should be reviewed before filing.")}</span>
    </div>
    <div class="report-section" data-testid="report-assumptions">
      ${assumptions}
    </div>
    <div class="report-section" data-testid="report-warning-section">
      ${warningNotices || '<div class="notice success" data-testid="report-warning"><strong>No warning notices</strong><span>This report has no validation blockers or computation warnings.</span></div>'}
    </div>
    <table class="report-table" data-testid="worksheet-table">
      <thead><tr><th>#</th><th>Line item</th><th>Value</th><th>Rules</th><th>Sources</th></tr></thead>
      <tbody>${worksheetRows}</tbody>
    </table>
    ${citationNotes ? `<div class="report-section" data-testid="citation-notes">${citationNotes}</div>` : ""}
    <table class="report-table" data-testid="source-table">
      <thead><tr><th>Source ID</th><th>Title</th><th>Retrieved</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table>
  `;
}

function downloadJsonReport() {
  if (!lastReport) {
    renderActionError("download-json-button", new Error("Generate an explanation report before downloading JSON."));
    return;
  }
  downloadFile(lastReport.downloads.json_filename, JSON.stringify(lastReport, null, 2), "application/json");
}

function downloadHtmlReport() {
  if (!lastReport) {
    renderActionError("download-html-button", new Error("Generate an explanation report before downloading HTML."));
    return;
  }
  downloadFile(lastReport.downloads.html_filename, lastReport.report_html, "text/html");
}

async function loadPrivacyPolicy() {
  try {
    const policy = await fetchJson("/api/v1/privacy/policy");
    privacyOutput.innerHTML = `
      <div class="notice">
        <strong>Privacy policy</strong>
        <span>${escapeHtml(policy.pii_masking)}</span>
      </div>
      ${policy.data_categories.map((item) => `
        <div class="notice">
          <strong>${escapeHtml(item.category)}</strong>
          <span>${escapeHtml(item.purpose)} · Retention: ${escapeHtml(item.retention)}</span>
        </div>
      `).join("")}
      <div class="notice">
        <strong>User controls</strong>
        <span>${policy.user_controls.map(escapeHtml).join(" ")}</span>
      </div>
    `;
  } catch (error) {
    renderPrivacyMessage("blocker", "Privacy policy unavailable", error.message);
  }
}

async function exportLocalData() {
  try {
    const data = new FormData(form);
    const exportPackage = await postJson("/api/v1/privacy/export", {
      profile: {
        period_type: value(data, "period_type"),
        period: value(data, "period"),
        act: value(data, "act"),
        taxpayer_type: value(data, "taxpayer_type"),
        residency: value(data, "residency"),
        age_years: numberValue(data, "age_years"),
        regime: value(data, "regime")
      },
      draft: formDataEntriesWithoutFiles(data),
      report_metadata: lastReport ? {
        report_version: lastReport.report_version,
        metadata: lastReport.metadata,
        support: lastReport.support,
        downloads: lastReport.downloads
      } : null,
      import_metadata: lastImportPreview ? {
        import_id: lastImportPreview.import_id,
        status: lastImportPreview.status,
        import_type: lastImportPreview.import_type,
        filename: lastImportPreview.filename,
        audit_trace: lastImportPreview.audit_trace,
        artifact_storage: lastImportPreview.artifact_storage
      } : null,
      ai_review: lastAiReview ? {
        readiness: lastAiReview.readiness,
        confidence_score: lastAiReview.confidence_score,
        summary: lastAiReview.summary
      } : null
    });
    downloadFile("tax-calculator-privacy-export.json", JSON.stringify(exportPackage, null, 2), "application/json");
    renderPrivacyMessage("info", "Export ready", "The local export includes current draft fields plus available report and import metadata.");
  } catch (error) {
    renderPrivacyMessage("blocker", "Export failed", error.message);
  }
}

async function deleteLocalData() {
  try {
    const workflow = await postJson("/api/v1/privacy/delete", {});
    removeStoredItem("tax-wizard-draft");
    removeStoredItem("tax-wizard-checks");
    removeStoredItem("guided_mode");
    removeStoredItem("selected_persona");
    removeStoredItem("step_health");
    removeStoredItem("saved_scenarios");
    removeStoredItem("ai_review");
    removeStoredItem("review_dismissals");
    form.reset();
    validationOutput.innerHTML = "";
    renderImportEmptyState();
    resultOutput.innerHTML = "";
    comparisonOutput.innerHTML = "";
    reportOutput.innerHTML = "";
    resultExplainSummary.innerHTML = "";
    aiReviewCenter.innerHTML = "";
    aiReviewCenter.classList.add("empty-state");
    taxWaterfall.innerHTML = "";
    launchOutput.innerHTML = "";
    lastReport = null;
    lastImportPreview = null;
    lastPdfExtraction = null;
    lastComputeResult = null;
    lastAiReview = null;
    lastComparison = null;
    reviewDismissals = [];
    selectedPersona = "";
    savedScenarios = [];
    activeStep = 0;
    draftStatus.textContent = "Local data deleted";
    renderStep();
    updateRegimeHints();
    updateIncomeSections();
    updatePersonaCards();
    updateGuidedChecklist();
    renderSavedScenarios();
    updateSummary();
    renderPrivacyMessage("warning", "Local data deleted", `${workflow.browser_actions.join(" ")} ${workflow.note}`);
  } catch (error) {
    renderPrivacyMessage("blocker", "Deletion failed", error.message);
  }
}

function addCapitalGainRow() {
  form.income_head_capital_gains.checked = true;
  form.capital_gain_section.value = form.capital_gain_section.value || "112A";
  document.querySelector("#capital-gain-row-status").textContent = "Capital-gains row added for review.";
  updateIncomeSections();
  updateSummary();
  form.capital_gain_section.focus();
}

function deleteCapitalGainRow() {
  form.capital_gain_section.value = "";
  form.capital_gain_transfer_date.value = "";
  form.capital_gain_net_gain.value = "0";
  form.capital_gain_stt_paid.checked = false;
  document.querySelector("#capital-gain-row-status").textContent = "Capital-gains row removed.";
  updateSummary();
}

function renderPrivacyMessage(kind, title, message) {
  privacyOutput.innerHTML = `
    <div class="notice ${escapeHtml(kind)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

async function loadBetaPlan() {
  try {
    const plan = await fetchJson("/api/v1/launch/beta-plan");
    launchOutput.innerHTML = `
      <h3>Closed beta plan</h3>
      <div class="launch-grid">
        <div class="launch-card"><span>Status</span><strong>${escapeHtml(humanizeLabel(plan.beta_status))}</strong></div>
        <div class="launch-card"><span>Cohorts</span><strong>${plan.cohorts.length}</strong></div>
        <div class="launch-card"><span>Tasks</span><strong>${plan.task_scripts.length}</strong></div>
      </div>
      <div class="notice">
        <strong>Scope freeze</strong>
        <span>${escapeHtml(humanizeLabel(plan.scope_freeze.status))} · ${escapeHtml(plan.scope_freeze.allowed_changes.map(humanizeLabel).join(", "))}</span>
      </div>
    `;
  } catch (error) {
    renderLaunchMessage("blocker", "Beta plan unavailable", error.message);
  }
}

async function runLaunchRegression() {
  try {
    launchOutput.innerHTML = '<div class="notice"><strong>Running regression</strong><span>Golden vectors and launch gates are executing.</span></div>';
    const regression = await fetchJson("/api/v1/launch/regression");
    launchOutput.innerHTML = `
      <h3>Final regression</h3>
      <div class="launch-grid">
        <div class="launch-card"><span>Machine gate</span><strong>${escapeHtml(humanizeLabel(regression.machine_gate_status))}</strong></div>
        <div class="launch-card"><span>Golden vectors</span><strong>${regression.golden_vectors.passed}/${regression.golden_vectors.total}</strong></div>
        <div class="launch-card"><span>Source register</span><strong>${escapeHtml(displayVersion(regression.source_register.version))}</strong></div>
      </div>
      ${regression.regression_suites.map((suite) => `
        <div class="notice ${suite.status === "pass" ? "info" : "blocker"}">
          <strong>${escapeHtml(humanizeLabel(suite.suite_id))} · ${escapeHtml(humanizeLabel(suite.status))}</strong>
          <span>${escapeHtml(safeVisibleText(suite.evidence))}</span>
        </div>
      `).join("")}
    `;
  } catch (error) {
    renderLaunchMessage("blocker", "Regression failed", error.message);
  }
}

async function checkLaunchReadiness() {
  try {
    const readiness = await fetchJson("/api/v1/launch/readiness");
    renderLaunchReadiness(readiness);
  } catch (error) {
    renderLaunchMessage("blocker", "Readiness check failed", error.message);
  }
}

async function loadLegalSupport() {
  try {
    const support = await fetchJson("/api/v1/launch/legal-support");
    launchOutput.innerHTML = `
      <h3>Support SOP</h3>
      <div class="notice">
        <strong>${escapeHtml(humanizeLabel(support.disclaimer.status))}</strong>
        <span>${escapeHtml(support.disclaimer.text)}</span>
      </div>
      ${(support.rulepack_changelog ?? []).map((item) => `
        <div class="notice info" data-testid="rulepack-changelog">
          <strong>${escapeHtml(displayVersion(item.rulepack_id))} · updated ${escapeHtml(item.last_updated)}</strong>
          <span>${escapeHtml(item.changes.join(" "))}</span>
        </div>
      `).join("")}
      ${support.support_sop.map((item) => `<div class="notice"><strong>Support</strong><span>${escapeHtml(item)}</span></div>`).join("")}
      ${support.launch_rollback_plan.map((item) => `<div class="notice warning"><strong>Rollback</strong><span>${escapeHtml(item)}</span></div>`).join("")}
    `;
  } catch (error) {
    renderLaunchMessage("blocker", "Support SOP unavailable", error.message);
  }
}

async function classifyFeedback() {
  try {
    const data = new FormData(form);
    const triage = await postJson("/api/v1/launch/triage", {
      category: value(data, "feedback_category"),
      severity: value(data, "feedback_severity"),
      description: value(data, "feedback_description")
    });
    launchOutput.innerHTML = `
      <h3>Beta defect triage</h3>
      <div class="launch-grid">
        <div class="launch-card"><span>Defect ID</span><strong>${escapeHtml(triage.defect_id)}</strong></div>
        <div class="launch-card"><span>Category</span><strong>${escapeHtml(humanizeLabel(triage.category))}</strong></div>
        <div class="launch-card"><span>Severity</span><strong>${escapeHtml(humanizeLabel(triage.severity))}</strong></div>
      </div>
      <div class="notice ${triage.launch_blocker ? "blocker" : "info"}">
        <strong>${triage.launch_blocker ? "Launch blocker" : "Track for burn-down"}</strong>
        <span>${escapeHtml(triage.triage_next_step)} Owner: ${escapeHtml(triage.recommended_owner)}.</span>
      </div>
    `;
  } catch (error) {
    renderLaunchMessage("blocker", "Triage failed", error.message);
  }
}

function renderLaunchReadiness(readiness) {
  launchOutput.innerHTML = `
    <h3>Launch readiness</h3>
    <div class="launch-grid">
      <div class="launch-card"><span>Closed beta</span><strong>${escapeHtml(humanizeLabel(readiness.closed_beta_status))}</strong></div>
      <div class="launch-card"><span>Machine gates</span><strong>${escapeHtml(humanizeLabel(readiness.machine_gate_status))}</strong></div>
      <div class="launch-card"><span>Public launch</span><strong>${escapeHtml(humanizeLabel(readiness.public_launch_status))}</strong></div>
    </div>
    ${readiness.gates.map((gate) => `
      <div class="notice ${gate.status === "pass" ? "info" : gate.status === "pending" ? "warning" : "blocker"}">
        <strong>${escapeHtml(humanizeLabel(gate.gate))} · ${escapeHtml(humanizeLabel(gate.status))}</strong>
        <span>${escapeHtml(safeVisibleText(gate.evidence ?? JSON.stringify(gate.approvals ?? {})))}</span>
      </div>
    `).join("")}
  `;
}

function renderLaunchMessage(kind, title, message) {
  launchOutput.innerHTML = `
    <div class="notice ${escapeHtml(kind)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function saveWhatIfScenario() {
  const request = buildRequest();
  const scenario = {
    id: `scenario-${Date.now()}`,
    name: scenarioName(request),
    saved_at: new Date().toISOString(),
    request
  };
  savedScenarios = [scenario, ...savedScenarios].slice(0, 5);
  persistSavedScenarios();
  renderSavedScenarios(`Saved ${scenario.name}. Adjust the form, then compare what-if.`);
}

function duplicateLatestScenario() {
  const scenario = savedScenarios[0];
  if (!scenario) {
    renderSavedScenarios("Save a scenario before duplicating it.");
    return;
  }
  applyScenarioRequest(scenario.request);
  renderSavedScenarios(`Duplicated ${scenario.name} into the form. Adjust values and compare.`);
}

async function compareWhatIfScenario() {
  const scenario = savedScenarios[0];
  if (!scenario) {
    renderSavedScenarios("Save a baseline scenario before comparing.");
    return;
  }

  scenarioOutput.innerHTML = '<div class="notice"><strong>Comparing scenarios</strong><span>Computing saved and current cases through the tax API.</span></div>';
  try {
    const [savedResult, currentResult] = await Promise.all([
      postJson("/api/v1/tax/compute", scenario.request),
      postJson("/api/v1/tax/compute", buildRequest())
    ]);
    const savedPayable = savedResult.summary.refund_or_payable ?? savedResult.summary.net_tax_liability ?? 0;
    const currentPayable = currentResult.summary.refund_or_payable ?? currentResult.summary.net_tax_liability ?? 0;
    const delta = currentPayable - savedPayable;
    scenarioOutput.innerHTML = `
      <div class="scenario-delta" data-testid="scenario-delta">
        <strong>${delta === 0 ? "No what-if difference" : delta > 0 ? "Current case is higher" : "Current case is lower"}</strong>
        <span>Saved: ${formatMoney(savedPayable)} · Current: ${formatMoney(currentPayable)} · Difference: ${formatMoney(delta)}</span>
      </div>
      ${renderScenarioList()}
    `;
  } catch (error) {
    scenarioOutput.innerHTML = `
      <div class="notice blocker">
        <strong>Scenario compare failed</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

function restoreSavedScenarios() {
  savedScenarios = parseStoredJson("saved_scenarios", [])
    .filter(isSavedScenario)
    .slice(0, 5);
  renderSavedScenarios();
}

function persistSavedScenarios() {
  setStoredItem("saved_scenarios", JSON.stringify(savedScenarios));
}

function restoreAiReviewState() {
  const review = parseStoredJson("ai_review", null);
  const dismissals = parseStoredJson("review_dismissals", []);
  lastAiReview = review && typeof review === "object" && review.status === "ok" ? review : null;
  reviewDismissals = dismissals.filter((item) => typeof item === "string").slice(0, 50);
  if (lastAiReview) {
    renderAiReview(lastAiReview);
  }
}

function parseStoredJson(key, fallback) {
  const parsed = parseStoredJsonValue(getStoredItem(key), fallback);
  if (parsed.invalid) removeStoredItem(key);
  return parsed.value;
}

function renderSavedScenarios(message = "") {
  scenarioOutput.innerHTML = `
    ${message ? `<div class="notice info"><strong>Scenario update</strong><span>${escapeHtml(message)}</span></div>` : ""}
    ${renderScenarioList()}
  `;
}

function renderScenarioList() {
  if (savedScenarios.length === 0) return "No saved scenarios yet.";
  return `
    <ul class="scenario-list">
      ${savedScenarios.map((scenario) => `
        <li>
          <strong>${escapeHtml(scenario.name)}</strong>
          <small>${escapeHtml(new Date(scenario.saved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</small>
        </li>
      `).join("")}
    </ul>
  `;
}

function scenarioName(request) {
  const salary = request.income?.salary?.gross_salary;
  const regime = humanizeLabel(request.regime);
  const period = request.period ?? "-";
  if (salary) return `${regime} salary ${formatMoneyCompact(salary)} for ${period}`;
  const heads = Object.keys(request.income ?? {}).map(humanizeLabel).join(", ") || "empty scenario";
  return `${regime} ${heads} for ${period}`;
}

function applyScenarioRequest(request = {}) {
  form.period_type.value = request.period_type ?? "assessment_year";
  form.period.value = request.period ?? "2026-27";
  form.act.value = request.act ?? "Income-tax Act, 1961";
  form.taxpayer_type.value = request.taxpayer_type ?? "individual";
  form.residency.value = request.residency ?? "resident";
  form.age_years.value = request.age_years ?? 34;
  const regime = form.querySelector(`[name="regime"][value="${cssEscape(request.regime ?? "new")}"]`);
  if (regime) regime.checked = true;

  resetScenarioInputsForApply();

  const income = request.income ?? {};
  form.income_head_salary.checked = Boolean(income.salary);
  form.income_head_house.checked = Array.isArray(income.house_property) && income.house_property.length > 0;
  form.income_head_other_sources.checked = Array.isArray(income.other_sources) && income.other_sources.length > 0;
  form.income_head_capital_gains.checked = Array.isArray(income.capital_gains) && income.capital_gains.length > 0;
  form.income_head_business.checked = Array.isArray(income.business_profession) && income.business_profession.length > 0;

  if (income.salary) {
    form.gross_salary.value = income.salary.gross_salary ?? 0;
    form.basic_salary.value = income.salary.basic_salary ?? 0;
    form.hra_received.value = income.salary.hra_received ?? 0;
    form.rent_paid.value = income.salary.rent_paid ?? 0;
    form.metro_city.checked = Boolean(income.salary.metro_city);
    form.lta_received.value = income.salary.lta_received ?? 0;
  }

  const house = income.house_property ?? [];
  form.self_occupied_interest.value = house.find((item) => item.property_type === "self_occupied")?.interest_paid ?? 0;
  form.let_out_loss.value = house.find((item) => item.property_type === "let_out")?.computed_loss ?? 0;
  form.interest_income.value = (income.other_sources ?? []).reduce((total, item) => total + Number(item.amount ?? 0), 0);

  const capitalGain = income.capital_gains?.[0];
  if (capitalGain) {
    form.capital_gain_section.value = capitalGain.section ?? "";
    form.capital_gain_transfer_date.value = capitalGain.transfer_date ?? "";
    form.capital_gain_net_gain.value = capitalGain.net_gain ?? 0;
    form.capital_gain_stt_paid.checked = Boolean(capitalGain.stt_paid);
  }

  const business = income.business_profession?.[0];
  if (business) {
    form.business_section.value = business.section ?? business.type ?? "";
    form.business_net_income.value = business.net_income ?? 0;
    form.business_receipts.value = business.turnover ?? business.gross_receipts ?? 0;
    form.business_cash_receipts.value = business.cash_receipts ?? 0;
    form.business_digital_receipts.value = business.digital_receipts ?? 0;
  }

  form.standard_deduction.checked = Boolean(request.deductions?.standard_deduction);
  for (const deduction of request.deductions?.chapter_via ?? []) {
    if (deduction.section === "80C") form.deduction_80c.value = deduction.amount ?? 0;
    if (deduction.section === "80D" && deduction.bucket === "self_family") {
      form.deduction_80d_self_premium.value = deduction.premium ?? 0;
      form.deduction_80d_self_preventive.value = deduction.preventive_checkup ?? 0;
    }
    if (deduction.section === "80D" && deduction.bucket === "parents") {
      form.deduction_80d_parent_premium.value = deduction.premium ?? 0;
      form.deduction_80d_parent_preventive.value = deduction.preventive_checkup ?? 0;
      form.deduction_80d_parent_senior.checked = Boolean(deduction.senior);
    }
    if (deduction.section === "80GG") form.deduction_80gg_rent.value = deduction.rent_paid ?? 0;
    if (deduction.section === "80EE") form.deduction_80ee.value = deduction.amount ?? 0;
    if (deduction.section === "80EEA") form.deduction_80eea.value = deduction.amount ?? 0;
  }

  form.tds.value = request.tax_credits?.tds ?? 0;
  form.tcs.value = request.tax_credits?.tcs ?? 0;
  form.advance_tax.value = request.tax_credits?.advance_tax ?? 0;
  form.self_assessment_tax.value = request.tax_credits?.self_assessment_tax ?? 0;

  lastComputeResult = null;
  lastComparison = null;
  lastReport = null;
  resultOutput.innerHTML = "";
  comparisonOutput.innerHTML = "";
  reportOutput.innerHTML = "";
  updateIncomeSections();
  updateRegimeHints();
  updateStepHealth();
  updateRecommendedAction();
  updateSummary();
  activeStep = stepOrder.indexOf("income");
  renderStep();
}

function resetScenarioInputsForApply() {
  for (const fieldName of [
    "gross_salary",
    "basic_salary",
    "hra_received",
    "rent_paid",
    "lta_received",
    "lta_claim",
    "lta_journeys",
    "self_occupied_interest",
    "let_out_loss",
    "interest_income",
    "capital_gain_net_gain",
    "business_net_income",
    "business_receipts",
    "business_cash_receipts",
    "business_digital_receipts",
    "deduction_80c",
    "deduction_80d_self_premium",
    "deduction_80d_self_preventive",
    "deduction_80d_parent_premium",
    "deduction_80d_parent_preventive",
    "deduction_80gg_rent",
    "deduction_80ee",
    "deduction_80eea",
    "tds",
    "tcs",
    "advance_tax",
    "self_assessment_tax"
  ]) {
    if (form.elements[fieldName]) form.elements[fieldName].value = "0";
  }
  form.capital_gain_section.value = "";
  form.capital_gain_transfer_date.value = "";
  form.business_section.value = "";
  form.metro_city.checked = false;
  form.capital_gain_stt_paid.checked = false;
  form.deduction_80d_parent_senior.checked = false;
}

function saveDraft() {
  const draftSaved = setStoredItem("tax-wizard-draft", JSON.stringify(formDataEntriesWithoutFiles(new FormData(form))));
  const checksSaved = setStoredItem("tax-wizard-checks", JSON.stringify({
    metro_city: form.metro_city.checked,
    capital_gain_stt_paid: form.capital_gain_stt_paid.checked,
    standard_deduction: form.standard_deduction.checked,
    deduction_80d_parent_senior: form.deduction_80d_parent_senior.checked,
    privacy_notice_ack: form.privacy_notice_ack.checked,
    income_head_salary: form.income_head_salary.checked,
    income_head_house: form.income_head_house.checked,
    income_head_other_sources: form.income_head_other_sources.checked,
    income_head_capital_gains: form.income_head_capital_gains.checked,
    income_head_business: form.income_head_business.checked,
    regime: new FormData(form).get("regime")
  }));
  if (!draftSaved || !checksSaved) {
    draftStatus.textContent = "Draft storage unavailable";
    return;
  }
  draftStatus.textContent = "Draft saved";
}

function restoreDraft() {
  const rawDraft = getStoredItem("tax-wizard-draft");
  if (!rawDraft) return;
  let draft;
  try {
    draft = JSON.parse(rawDraft);
  } catch {
    draftStatus.textContent = "Draft could not be restored";
    return;
  }
  for (const [key, entry] of Object.entries(draft)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === "file") continue;
    if (field instanceof RadioNodeList) {
      const radio = [...field].find((item) => item.value === entry);
      if (radio) radio.checked = true;
    } else {
      field.value = entry;
    }
  }
  let checks = {};
  try {
    checks = JSON.parse(getStoredItem("tax-wizard-checks") ?? "{}");
  } catch {
    checks = {};
  }
  for (const [key, checked] of Object.entries(checks)) {
    if (key === "regime") continue;
    if (form.elements[key]) form.elements[key].checked = Boolean(checked);
  }
  draftStatus.textContent = "Draft restored";
  updateIncomeSections();
  updateLanguagePreference();
  updateSummary();
}

function formDataEntriesWithoutFiles(data) {
  const entries = {};
  for (const [key, entry] of data.entries()) {
    if (entry instanceof File) continue;
    entries[key] = entry;
  }
  return entries;
}

function resetDraft() {
  if (!globalThis.confirm("Reset this scenario and clear saved draft?")) return;
  removeStoredItem("tax-wizard-draft");
  removeStoredItem("tax-wizard-checks");
  removeStoredItem("guided_mode");
  removeStoredItem("selected_persona");
  removeStoredItem("step_health");
  removeStoredItem("saved_scenarios");
  removeStoredItem("ai_review");
  removeStoredItem("review_dismissals");
  form.reset();
  validationOutput.innerHTML = "";
  renderImportEmptyState();
  resultOutput.innerHTML = "";
  comparisonOutput.innerHTML = "";
  reportOutput.innerHTML = "";
  resultExplainSummary.innerHTML = "";
  aiReviewCenter.innerHTML = "";
  aiReviewCenter.classList.add("empty-state");
  taxWaterfall.innerHTML = "";
  privacyOutput.innerHTML = "";
  launchOutput.innerHTML = "";
  lastReport = null;
  lastImportPreview = null;
  lastPdfExtraction = null;
  lastComputeResult = null;
  lastAiReview = null;
  lastComparison = null;
  reviewDismissals = [];
  selectedPersona = "";
  savedScenarios = [];
  draftStatus.textContent = "Draft reset";
  activeStep = 0;
  renderStep();
  updateRegimeHints();
  updateIncomeSections();
  updateLanguagePreference();
  updatePersonaCards();
  updateGuidedChecklist();
  renderSavedScenarios();
  updateSummary();
}

function getStoredItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    draftStatus.textContent = "Draft storage unavailable";
    return null;
  }
}

function setStoredItem(key, valueToStore) {
  try {
    localStorage.setItem(key, valueToStore);
    return true;
  } catch {
    return false;
  }
}

function removeStoredItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    draftStatus.textContent = "Draft storage unavailable";
    return false;
  }
}

function updateRegimeHints() {
  const isNewRegime = new FormData(form).get("regime") === "new";
  form.querySelectorAll("[name^='deduction_'], [name='hra_received'], [name='rent_paid'], [name='lta_received'], [name='lta_claim']")
    .forEach((field) => {
      field.closest("label")?.classList.toggle("muted-field", isNewRegime);
    });
}

function updateIncomeSections() {
  document.querySelectorAll("[data-income-section]").forEach((section) => {
    section.classList.toggle("is-disabled", !isIncomeHeadEnabled(section.dataset.incomeSection));
  });
  updateBusinessMode();
}

function updateBusinessMode() {
  const section = value(new FormData(form), "business_section");
  const visibleFields = {
    normal_business: ["normal"],
    "44AD": ["presumptive", "44AD"],
    "44ADA": ["presumptive"]
  }[section] ?? [];

  document.querySelectorAll("[data-business-field]").forEach((field) => {
    field.classList.toggle("is-hidden", !visibleFields.includes(field.dataset.businessField));
  });

  const hint = document.querySelector("#business-mode-hint");
  if (!hint) return;
  if (section === "44AD") {
    hint.textContent = "44AD shows turnover, cash receipts, and digital receipts for presumptive income.";
  } else if (section === "44ADA") {
    hint.textContent = "44ADA shows gross receipts and cash receipts for professional presumptive income.";
  } else if (section === "normal_business") {
    hint.textContent = "Normal business uses net income only in this supported UI flow.";
  } else {
    hint.textContent = "Select a business type to show only relevant fields.";
  }
}

function updateLanguagePreference() {
  const language = form.language?.value || "en-IN";
  document.documentElement.lang = language;
  if (language !== "en-IN") {
    draftStatus.textContent = "English fallback shown for selected language";
  }
}

function isIncomeHeadEnabled(name) {
  const fieldName = {
    salary: "income_head_salary",
    house: "income_head_house",
    other_sources: "income_head_other_sources",
    capital_gains: "income_head_capital_gains",
    business: "income_head_business"
  }[name];
  return !fieldName || !form.elements[fieldName] || form.elements[fieldName].checked;
}

function updateStepHealth(validationReport = null) {
  const profileComplete = commonProfileFieldsComplete();
  const incomeComplete = hasScenarioIncome();
  const validationResults = validationReport?.results ?? lastComputeResult?.validation_results ?? [];
  const hasWarnings = validationResults.some((item) => ["warning", "blocker"].includes(item.severity)) || (lastComputeResult?.warnings?.length ?? 0) > 0;

  stepHealthState = {
    profile: profileComplete ? "Complete" : "Needs input",
    imports: lastImportPreview?.status === "ok" ? "Complete" : "Complete",
    income: incomeComplete ? "Complete" : "Needs input",
    deductions: "Complete",
    credits: "Complete",
    results: hasWarnings ? "Has warnings" : lastComputeResult ? "Complete" : profileComplete && incomeComplete ? "Ready to compute" : "Needs input",
    launch: "Complete"
  };

  document.querySelectorAll("[data-step-health]").forEach((item) => {
    const status = stepHealthState[item.dataset.stepHealth] ?? "Needs input";
    item.textContent = status;
    item.dataset.health = healthToken(status);
  });

  tabs.forEach((tab) => {
    const status = stepHealthState[tab.dataset.step] ?? "Needs input";
    tab.dataset.health = healthToken(status);
  });

  if (summaryStepHealth) {
    const activeName = stepOrder[activeStep] ?? "profile";
    summaryStepHealth.textContent = stepHealthState[activeName] ?? "Needs input";
    summaryStepHealth.dataset.health = healthToken(summaryStepHealth.textContent);
  }

  setStoredItem("step_health", JSON.stringify(stepHealthState));
  updateGuidedChecklist();
}

function commonProfileFieldsComplete() {
  const data = new FormData(form);
  return ["period_type", "period", "act", "taxpayer_type", "residency", "age_years", "regime"]
    .every((field) => String(data.get(field) ?? "").trim() !== "");
}

function hasScenarioIncome() {
  const data = new FormData(form);
  return (isIncomeHeadEnabled("salary") && numberValue(data, "gross_salary") > 0) ||
    (isIncomeHeadEnabled("house") && (numberValue(data, "self_occupied_interest") > 0 || numberValue(data, "let_out_loss") > 0)) ||
    (isIncomeHeadEnabled("other_sources") && numberValue(data, "interest_income") > 0) ||
    (isIncomeHeadEnabled("capital_gains") && numberValue(data, "capital_gain_net_gain") > 0) ||
    (isIncomeHeadEnabled("business") && (
      numberValue(data, "business_net_income") > 0 ||
      numberValue(data, "business_receipts") > 0
    ));
}

function healthToken(status) {
  return String(status ?? "Needs input").toLowerCase().replaceAll(" ", "-");
}

function updateRecommendedAction() {
  document.querySelectorAll(".action-bar .button").forEach((button) => {
    button.classList.remove("is-recommended");
    button.removeAttribute("data-recommended");
  });

  const activeName = stepOrder[activeStep];
  updateActionGroups(activeName);
  let buttonId = "next-step";
  let hint = "Continue to the next section when the visible fields look right.";

  if (!commonProfileFieldsComplete()) {
    buttonId = "validate-button";
    hint = "Complete profile fields first; validation will focus the first missing value.";
  } else if (activeName === "imports") {
    const data = new FormData(form);
    if (String(data.get("import_content") ?? "").trim() && !form.import_confirmed.checked) {
      buttonId = "preview-import-button";
      hint = "Preview imported values before applying them.";
    } else if (form.import_confirmed.checked) {
      buttonId = "apply-import-button";
      hint = "Apply the reviewed import values, then compute.";
    }
  } else if (activeName === "results") {
    if (!validationOutput.textContent.trim()) {
      buttonId = "validate-button";
      hint = "Validate first so warnings are visible before compute.";
    } else if (!lastComputeResult) {
      buttonId = "compute-button";
      hint = "Compute to produce the estimate and visual breakdown.";
    } else if (!lastComparison) {
      buttonId = "compare-button";
      hint = "Compare regimes to see the lower option for the same inputs.";
    } else if (!lastReport) {
      buttonId = "explain-button";
      hint = "Generate Explain to view worksheet, assumptions, and sources.";
    } else {
      buttonId = "download-html-button";
      hint = "Download the report after reviewing the worksheet.";
    }
  } else if (["income", "deductions", "credits"].includes(activeName)) {
    buttonId = "next-step";
    hint = hasScenarioIncome() ? "Continue when this section is complete." : "Add at least one income value before computing.";
  }

  const button = document.querySelector(`#${buttonId}`);
  if (button) {
    button.classList.add("is-recommended");
    button.dataset.recommended = "true";
  }
  nextActionHint.textContent = hint;
}

function updateActionGroups(activeName) {
  const groups = {
    import: document.querySelector('[data-action-group="import"]'),
    calculate: document.querySelector('[data-action-group="calculate"]'),
    review: document.querySelector('[data-action-group="review"]'),
    draft: document.querySelector('[data-action-group="draft"]')
  };
  const shouldShowReview = activeName === "results" || Boolean(lastComputeResult || lastComparison || lastReport);
  const shouldShowImport = activeName === "imports";

  setActionGroupVisible(groups.import, shouldShowImport);
  setActionGroupVisible(groups.calculate, activeName !== "launch");
  setActionGroupVisible(groups.review, shouldShowReview);
  setActionGroupVisible(groups.draft, true);
}

function setActionGroupVisible(group, visible) {
  if (!group) return;
  group.hidden = !visible;
  if (!visible) group.open = false;
}

function updateSummary(result = lastComputeResult) {
  const data = new FormData(form);
  const periodType = value(data, "period_type") === "assessment_year" ? "AY" : "TY";
  summaryPeriod.textContent = `${periodType} ${value(data, "period")}`;
  summaryRegime.textContent = `${humanizeLabel(value(data, "regime"))} regime`;
  summaryIncome.textContent = isIncomeHeadEnabled("salary")
    ? formatMoneyCompact(numberValue(data, "gross_salary"))
    : "Salary head off";
  summaryPayable.textContent = result?.summary
    ? formatMoney(result.summary.refund_or_payable ?? result.summary.net_tax_liability)
    : "Run compute";
  summaryNote.textContent = result?.status === "ok"
    ? `Likely ${result.itr_recommendation ?? "ITR"} form. Review assumptions before filing.`
    : `Rules last updated ${RULES_LAST_UPDATED} for the selected supported period.`;
  if (summaryConfidence) {
    const score = lastAiReview?.confidence_score;
    const label = lastAiReview?.confidence_label ?? "high";
    summaryConfidence.textContent = typeof score === "number"
      ? `Calculation confidence: ${score}%`
      : "Calculation confidence: high";
    summaryConfidence.classList.toggle("success", label === "high");
    summaryConfidence.classList.toggle("warning", label === "needs_review");
    summaryConfidence.classList.toggle("neutral", label === "medium");
  }
}

function renderImportEmptyState() {
  importOutput.classList.add("empty-state");
  importOutput.innerHTML = `
    <strong>No import preview yet</strong>
    <p>Choose an import type, paste data, then preview the proposed values.</p>
  `;
}

function applyRequestPatch(patch = {}) {
  if (patch.income?.salary?.gross_salary !== undefined) {
    form.income_head_salary.checked = true;
    form.gross_salary.value = patch.income.salary.gross_salary;
  }

  if (Array.isArray(patch.income?.other_sources)) {
    form.income_head_other_sources.checked = true;
    const interestTotal = patch.income.other_sources.reduce((total, item) => total + Number(item.amount ?? 0), 0);
    form.interest_income.value = interestTotal;
  }

  const capitalGain = patch.income?.capital_gains?.[0];
  if (capitalGain) {
    form.income_head_capital_gains.checked = true;
    form.capital_gain_section.value = capitalGain.section ?? "";
    form.capital_gain_transfer_date.value = capitalGain.transfer_date ?? "";
    form.capital_gain_net_gain.value = capitalGain.net_gain ?? 0;
    form.capital_gain_stt_paid.checked = Boolean(capitalGain.stt_paid);
  }

  if (patch.tax_credits?.tds !== undefined) form.tds.value = patch.tax_credits.tds;
  if (patch.tax_credits?.tcs !== undefined) form.tcs.value = patch.tax_credits.tcs;
  if (patch.tax_credits?.advance_tax !== undefined) form.advance_tax.value = patch.tax_credits.advance_tax;
  if (patch.tax_credits?.self_assessment_tax !== undefined) form.self_assessment_tax.value = patch.tax_credits.self_assessment_tax;

  if (patch.deductions?.standard_deduction !== undefined) {
    form.standard_deduction.checked = Boolean(patch.deductions.standard_deduction);
  }

  for (const deduction of patch.deductions?.chapter_via ?? []) {
    if (deduction.section === "80C") form.deduction_80c.value = deduction.amount ?? 0;
    if (deduction.section === "80D" && deduction.bucket === "self_family") {
      form.deduction_80d_self_premium.value = deduction.premium ?? 0;
      form.deduction_80d_self_preventive.value = deduction.preventive_checkup ?? 0;
    }
    if (deduction.section === "80D" && deduction.bucket === "parents") {
      form.deduction_80d_parent_premium.value = deduction.premium ?? 0;
      form.deduction_80d_parent_preventive.value = deduction.preventive_checkup ?? 0;
      form.deduction_80d_parent_senior.checked = Boolean(deduction.senior);
    }
  }

  activeStep = stepOrder.indexOf("income");
  updateIncomeSections();
  updateStepHealth();
  updateRecommendedAction();
  updateSummary();
  renderStep();
}

function value(data, key) {
  return String(data.get(key) ?? "");
}

function numberValue(data, key) {
  const parsed = Number.parseFloat(data.get(key) ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function assignNumber(target, targetKey, data, sourceKey) {
  const parsed = numberValue(data, sourceKey);
  if (parsed > 0) target[targetKey] = parsed;
}

function pushAmount(deductions, section, amount) {
  if (amount > 0) deductions.push({ section, amount });
}

function removeZeroOnlySalary(salary) {
  return Object.values(salary).some((item) => item !== false && item !== 0) ? salary : {};
}

function approximateSpecifiedTotalIncome(data) {
  return numberValue(data, "gross_salary") +
    numberValue(data, "interest_income") +
    numberValue(data, "business_net_income");
}

function sumSpecialTax(specialRateTax = {}) {
  return Object.values(specialRateTax).reduce((total, item) => {
    return total + (item.tax_before_cess ?? item.final_tax_before_cess ?? 0);
  }, 0);
}

function formatMoney(value) {
  return rupee.format(value ?? 0);
}

function formatMoneyCompact(value) {
  const amount = Number(value ?? 0);
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (absolute >= 10000000) return `${sign}INR ${trimDecimal(absolute / 10000000)}Cr`;
  if (absolute >= 100000) return `${sign}INR ${trimDecimal(absolute / 100000)}L`;
  return formatMoney(amount);
}

function trimDecimal(value) {
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderActionError(buttonId, error) {
  const target = actionOutput(buttonId);
  target.innerHTML = `
    <div class="notice blocker" role="alert" aria-live="assertive" data-testid="action-error">
      <strong>Action needs attention</strong>
      <span>${escapeHtml(error?.message ?? "Request failed")}</span>
    </div>
  `;
}

function actionOutput(buttonId) {
  if (buttonId.includes("import")) return importOutput;
  if (buttonId.includes("privacy") || buttonId.includes("local-data")) return privacyOutput;
  if (buttonId.includes("beta") || buttonId.includes("regression") || buttonId.includes("readiness") || buttonId.includes("support") || buttonId.includes("feedback")) return launchOutput;
  return validationOutput;
}

function displayVersion(value) {
  const text = String(value ?? "-");
  return /sprint[-_\s]?(zero|\d+)/i.test(text) ? "Current approved register" : text;
}

function safeVisibleText(value) {
  return String(value ?? "-").replace(/sprint[-_\s]?(zero|\d+)[-_\s]?v?\d*/gi, "current version");
}

function humanizeLabel(value) {
  return String(value ?? "-")
    .replace(/sprint[-_\s]?(zero|\d+)[-_\s]?v?\d*/gi, "current")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
