export const REQUIRED_UI_ELEMENTS = [
  { selector: "#tax-wizard", label: "Calculator form", type: "shell" },
  { selector: "#hero-heading", label: "Landing page heading", type: "shell" },
  { selector: "#calculator-heading", label: "Calculator heading", type: "shell" },
  { selector: "#side-rail", label: "Scenario action side rail", type: "shell" },
  { selector: "#usage-guide", label: "Application guide", type: "guide" },
  { selector: "#usage-guide-heading", label: "Application guide heading", type: "guide" },
  { selector: "#usage-guide-components", label: "Application component guide", type: "guide" },
  { selector: "#usage-guide-user-levels", label: "User-level guide", type: "guide" },
  { selector: "#usage-guide-profile", label: "Profile page guide", type: "guide" },
  { selector: "#usage-guide-imports", label: "Import page guide", type: "guide" },
  { selector: "#usage-guide-income", label: "Income page guide", type: "guide" },
  { selector: "#usage-guide-deductions", label: "Deductions page guide", type: "guide" },
  { selector: "#usage-guide-credits", label: "Credits page guide", type: "guide" },
  { selector: "#usage-guide-results", label: "Results page guide", type: "guide" },
  { selector: "#usage-guide-readiness", label: "Readiness page guide", type: "guide" },
  { selector: "#usage-guide-errors", label: "Missing-entry guide", type: "guide" },
  { selector: "#application-guide-button", label: "Application Guide button", type: "button" },
  { selector: "#application-guide-side-button", label: "Application Guide side button", type: "button" },
  { selector: "#close-application-guide-button", label: "Application Guide close button", type: "button" },
  { selector: "#api-status", label: "API status indicator", type: "shell" },
  { selector: "#draft-status", label: "Draft status indicator", type: "shell" },
  { selector: "#summary-period", label: "Summary period value", type: "summary" },
  { selector: "#summary-regime", label: "Summary regime value", type: "summary" },
  { selector: "#summary-income", label: "Summary income value", type: "summary" },
  { selector: "#summary-payable", label: "Summary payable value", type: "summary" },
  { selector: "#validation-output", label: "Validation message region", type: "output" },
  { selector: "#import-output", label: "Import preview region", type: "output" },
  { selector: "[name=\"import_file\"]", label: "Import file picker", type: "shell" },
  { selector: "#import-file-status", label: "Import file status", type: "output" },
  { selector: "#result-output", label: "Calculation result region", type: "output" },
  { selector: "#ai-review-center", label: "AI Review Center", type: "output" },
  { selector: "#comparison-output", label: "Regime comparison region", type: "output" },
  { selector: "#report-output", label: "Explanation report region", type: "output" },
  { selector: "#privacy-output", label: "Privacy output region", type: "output" },
  { selector: "#launch-output", label: "Launch readiness output region", type: "output" },
  { selector: "[data-step=\"profile\"]", label: "Profile step tab", type: "tab" },
  { selector: "[data-step=\"imports\"]", label: "Imports step tab", type: "tab" },
  { selector: "[data-step=\"income\"]", label: "Income step tab", type: "tab" },
  { selector: "[data-step=\"deductions\"]", label: "Deductions step tab", type: "tab" },
  { selector: "[data-step=\"credits\"]", label: "Credits step tab", type: "tab" },
  { selector: "[data-step=\"results\"]", label: "Results step tab", type: "tab" },
  { selector: "[data-step=\"launch\"]", label: "Launch step tab", type: "tab" },
  { selector: "#prev-step", label: "Back button", type: "button" },
  { selector: "#next-step", label: "Next button", type: "button" },
  { selector: "#preview-import-button", label: "Preview import button", type: "button" },
  { selector: "#apply-import-button", label: "Apply import button", type: "button" },
  { selector: "#validate-button", label: "Validate button", type: "button" },
  { selector: "#compute-button", label: "Compute button", type: "button" },
  { selector: "#ai-review-button", label: "AI Review button", type: "button" },
  { selector: "#compare-button", label: "Compare regimes button", type: "button" },
  { selector: "#explain-button", label: "Explain button", type: "button" },
  { selector: "#download-json-button", label: "Download JSON button", type: "button" },
  { selector: "#download-html-button", label: "Download HTML button", type: "button" },
  { selector: "#save-button", label: "Save draft button", type: "button" },
  { selector: "#reset-button", label: "Reset button", type: "button" },
  { selector: "#load-privacy-button", label: "Privacy policy button", type: "button" },
  { selector: "#export-local-data-button", label: "Export local data button", type: "button" },
  { selector: "#delete-local-data-button", label: "Delete local data button", type: "button" },
  { selector: "#load-beta-plan-button", label: "Beta plan button", type: "button" },
  { selector: "#run-regression-button", label: "Run regression button", type: "button" },
  { selector: "#check-readiness-button", label: "Readiness button", type: "button" },
  { selector: "#load-legal-support-button", label: "Support SOP button", type: "button" },
  { selector: "#classify-feedback-button", label: "Classify feedback button", type: "button" }
];

export const ACTION_REQUIREMENTS = [
  {
    actionId: "preview-import-button",
    label: "Preview import",
    elements: ["#preview-import-button", "[name=\"import_type\"]", "[name=\"import_filename\"]", "[name=\"import_content\"]"],
    inputs: [
      { name: "import_type", label: "Import type" },
      { name: "import_filename", label: "Filename" },
      { name: "import_content", label: "CSV, JSON, or extracted PDF content" }
    ]
  },
  {
    actionId: "apply-import-button",
    label: "Apply import",
    elements: ["#apply-import-button", "[name=\"import_content\"]", "[name=\"import_confirmed\"]"],
    inputs: [
      { name: "import_content", label: "CSV, JSON, or extracted PDF content" },
      { name: "import_confirmed", label: "Import review confirmation", checkbox: true }
    ]
  },
  {
    actionId: "validate-button",
    label: "Validate",
    elements: ["#validate-button", "[name=\"period_type\"]", "[name=\"period\"]", "[name=\"act\"]", "[name=\"taxpayer_type\"]", "[name=\"residency\"]", "[name=\"age_years\"]", "[name=\"regime\"]"],
    inputs: commonScenarioInputs()
  },
  {
    actionId: "compute-button",
    label: "Compute",
    elements: ["#compute-button", "[name=\"period_type\"]", "[name=\"period\"]", "[name=\"act\"]", "[name=\"taxpayer_type\"]", "[name=\"residency\"]", "[name=\"age_years\"]", "[name=\"regime\"]"],
    inputs: commonScenarioInputs()
  },
  {
    actionId: "ai-review-button",
    label: "AI Review",
    elements: ["#ai-review-button", "#ai-review-center", "[name=\"period_type\"]", "[name=\"period\"]", "[name=\"act\"]", "[name=\"taxpayer_type\"]", "[name=\"residency\"]", "[name=\"age_years\"]", "[name=\"regime\"]"],
    inputs: commonScenarioInputs()
  },
  {
    actionId: "compare-button",
    label: "Compare regimes",
    elements: ["#compare-button", "[name=\"period_type\"]", "[name=\"period\"]", "[name=\"act\"]", "[name=\"taxpayer_type\"]", "[name=\"residency\"]", "[name=\"age_years\"]", "[name=\"regime\"]"],
    inputs: commonScenarioInputs()
  },
  {
    actionId: "explain-button",
    label: "Explain",
    elements: ["#explain-button", "[name=\"period_type\"]", "[name=\"period\"]", "[name=\"act\"]", "[name=\"taxpayer_type\"]", "[name=\"residency\"]", "[name=\"age_years\"]", "[name=\"regime\"]"],
    inputs: commonScenarioInputs()
  },
  {
    actionId: "download-json-button",
    label: "JSON report",
    elements: ["#download-json-button", "#report-output"],
    inputs: [{ name: "report_ready", label: "Generated explanation report", checkbox: true }]
  },
  {
    actionId: "download-html-button",
    label: "HTML report",
    elements: ["#download-html-button", "#report-output"],
    inputs: [{ name: "report_ready", label: "Generated explanation report", checkbox: true }]
  },
  {
    actionId: "save-button",
    label: "Save draft",
    elements: ["#save-button", "#tax-wizard"],
    inputs: []
  },
  {
    actionId: "reset-button",
    label: "Reset",
    elements: ["#reset-button", "#tax-wizard"],
    inputs: []
  },
  {
    actionId: "load-beta-plan-button",
    label: "Beta plan",
    elements: ["#load-beta-plan-button", "#launch-output"],
    inputs: []
  },
  {
    actionId: "run-regression-button",
    label: "Run regression",
    elements: ["#run-regression-button", "#launch-output"],
    inputs: []
  },
  {
    actionId: "check-readiness-button",
    label: "Readiness",
    elements: ["#check-readiness-button", "#launch-output"],
    inputs: []
  },
  {
    actionId: "load-legal-support-button",
    label: "Support SOP",
    elements: ["#load-legal-support-button", "#launch-output"],
    inputs: []
  },
  {
    actionId: "classify-feedback-button",
    label: "Classify feedback",
    elements: ["#classify-feedback-button", "[name=\"feedback_description\"]", "#launch-output"],
    inputs: [{ name: "feedback_description", label: "Feedback" }]
  }
];

export function missingElementMessage(element) {
  return `${element.label} is missing (${element.selector}).`;
}

export function validateRequiredElements(root, requiredElements = REQUIRED_UI_ELEMENTS) {
  const missing = requiredElements.filter((element) => !root.querySelector(element.selector));
  return {
    valid: missing.length === 0,
    missing,
    messages: missing.map(missingElementMessage)
  };
}

export function renderMissingElementMessage(root, validation) {
  if (validation.valid) return false;

  const target = root.querySelector("#validation-output") ??
    root.querySelector("#api-status") ??
    root.body;
  if (!target) return false;

  target.innerHTML = `
    <div class="notice blocker">
      <strong>Application setup incomplete</strong>
      <span>${validation.messages.map(escapeHtml).join(" ")}</span>
    </div>
  `;
  return true;
}

export function validateActionElements(root, actionId, actionRequirements = ACTION_REQUIREMENTS) {
  const action = actionRequirements.find((item) => item.actionId === actionId);
  if (!action) {
    return {
      valid: false,
      action: null,
      missing: [{ selector: `#${actionId}`, label: "Unknown action", type: "button" }],
      messages: [`Unknown action (${actionId}).`]
    };
  }
  const missing = action.elements
    .filter((selector) => !root.querySelector(selector))
    .map((selector) => ({ selector, label: readableSelectorLabel(selector), type: "action-element" }));

  return {
    valid: missing.length === 0,
    action,
    missing,
    messages: missing.map((item) => `${action.label} cannot run because ${item.label} is missing (${item.selector}).`)
  };
}

export function validateActionInputValues(values, actionId, actionRequirements = ACTION_REQUIREMENTS) {
  const action = actionRequirements.find((item) => item.actionId === actionId);
  if (!action) {
    return {
      valid: true,
      action: null,
      missing: [],
      messages: []
    };
  }

  const missing = action.inputs.filter((input) => {
    const value = getValue(values, input.name);
    if (input.checkbox) return value !== true && value !== "on" && value !== "true";
    return value === undefined || value === null || String(value).trim() === "";
  });

  return {
    valid: missing.length === 0,
    action,
    missing,
    messages: missing.map((input) => `${action.label} cannot run because ${input.label} is missing.`)
  };
}

function commonScenarioInputs() {
  return [
    { name: "period_type", label: "Period type" },
    { name: "period", label: "Period" },
    { name: "act", label: "Act" },
    { name: "taxpayer_type", label: "Taxpayer type" },
    { name: "residency", label: "Residency" },
    { name: "age_years", label: "Age" },
    { name: "regime", label: "Regime" }
  ];
}

function readableSelectorLabel(selector) {
  const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
  if (name) return name.replaceAll("_", " ");
  const id = selector.match(/^#(.+)$/)?.[1];
  return id ? id.replaceAll("-", " ") : selector;
}

function getValue(values, key) {
  if (values && typeof values.get === "function") return values.get(key);
  return values?.[key];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
