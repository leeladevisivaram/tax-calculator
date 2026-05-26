import { expect } from "@playwright/test";

export const INTERNAL_LABEL_PATTERN = /Sprint \d|sprint\d+-v\d+|sprint-zero/i;

export const baseTaxPayload = {
  period_type: "assessment_year",
  period: "2026-27",
  act: "Income-tax Act, 1961",
  taxpayer_type: "individual",
  residency: "resident",
  age_years: 34,
  regime: "new",
  income: {},
  deductions: { standard_deduction: true },
  tax_credits: {}
};

export async function openCalculator(page) {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toBeVisible();
  await expect(page.getByTestId("choice-hub")).toBeVisible();
  await expect(page.getByTestId("api-status")).toContainText("API connected");
  await page.getByTestId("calculator-tab").dispatchEvent("click");
  await expect(page.getByTestId("tax-wizard")).toBeVisible();
  await assertNoInternalLabels(page);
}

export async function assertNoInternalLabels(page) {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(INTERNAL_LABEL_PATTERN);
}

export async function goToStep(page, step) {
  const tab = page.getByTestId(`step-${step}`);
  const panel = page.getByTestId(`panel-${step}`);
  await expect(tab).toBeAttached();
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(panel).toBeVisible();
}

export async function setScenarioField(page, name, value) {
  const control = page.locator(`[name="${name}"]`).first();
  const tagName = await control.evaluate((node) => node.tagName.toLowerCase());
  const type = await control.evaluate((node) => node.getAttribute("type") ?? "");

  if (type === "checkbox") {
    await control.setChecked(Boolean(value));
    return;
  }

  if (type === "radio") {
    await page.locator(`[name="${name}"][value="${value}"]`).check();
    return;
  }

  if (tagName === "select") {
    await control.selectOption(String(value));
    return;
  }

  await control.fill(String(value));
}

export async function clearScenarioField(page, name) {
  await page.locator(`[name="${name}"]`).evaluateAll((controls) => {
    for (const control of controls) {
      if (control.type === "radio" || control.type === "checkbox") {
        control.checked = false;
      } else {
        control.value = "";
      }
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

export async function setIncomeHead(page, head, checked = true) {
  const fieldName = {
    salary: "income_head_salary",
    house: "income_head_house",
    other_sources: "income_head_other_sources",
    capital_gains: "income_head_capital_gains",
    business: "income_head_business"
  }[head];
  await page.locator(`[name="${fieldName}"]`).setChecked(checked);
}

export async function fillBaseProfile(page, overrides = {}) {
  const values = {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    ...overrides
  };

  await setScenarioField(page, "period_type", values.period_type);
  await setScenarioField(page, "period", values.period);
  await setScenarioField(page, "act", values.act);
  await setScenarioField(page, "taxpayer_type", values.taxpayer_type);
  await setScenarioField(page, "residency", values.residency);
  await setScenarioField(page, "age_years", values.age_years);
  await setScenarioField(page, "regime", values.regime);
}

export async function fillSalaryScenario(page, grossSalary = 1275000) {
  await goToStep(page, "income");
  await setIncomeHead(page, "salary", true);
  await page.getByTestId("gross-salary").fill(String(grossSalary));
}

export async function runValidate(page) {
  await clickAction(page, "validate-button");
  await expect(page.getByTestId("panel-results")).toBeVisible();
}

export async function runCompute(page) {
  await clickAction(page, "compute-button");
  await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
  await expect(page.getByTestId("compute-button")).toHaveAttribute("aria-busy", "false");
}

export async function runCompare(page) {
  await clickAction(page, "compare-button");
  await expect(page.getByTestId("old-regime-card")).toBeVisible();
  await expect(page.getByTestId("new-regime-card")).toBeVisible();
}

export async function runExplain(page) {
  await clickAction(page, "explain-button");
  await expect(page.getByTestId("worksheet-table")).toBeVisible();
  await expect(page.getByTestId("source-table")).toBeVisible();
}

export async function clickAction(page, testId) {
  const groupByAction = {
    "preview-import-button": "import",
    "apply-import-button": "import",
    "validate-button": "calculate",
    "compute-button": "calculate",
    "ai-review-button": "calculate",
    "compare-button": "review",
    "explain-button": "review",
    "download-json-button": "review",
    "download-html-button": "review",
    "application-guide-side-button": "draft",
    "save-button": "draft",
    "reset-button": "draft"
  };
  const stepByAction = {
    "preview-import-button": "imports",
    "apply-import-button": "imports",
    "compare-button": "results",
    "explain-button": "results",
    "download-json-button": "results",
    "download-html-button": "results"
  };
  const button = page.getByTestId(testId);
  if (!(await button.isVisible())) {
    const targetStep = stepByAction[testId];
    if (targetStep) {
      const targetTab = page.getByTestId(`step-${targetStep}`);
      if (await targetTab.isVisible()) {
        await targetTab.click();
        await expect(page.getByTestId(`panel-${targetStep}`)).toBeVisible();
      }
    }
    const group = groupByAction[testId];
    if (group) {
      const actionGroup = page.getByTestId(`action-group-${group}`);
      await expect(actionGroup).toBeVisible();
      await actionGroup.locator("summary").click();
      await expect(button).toBeVisible();
    }
  }
  await button.click();
}

export async function expectActionError(page, message) {
  await expect(page.getByTestId("action-error")).toContainText(message);
  await assertNoInternalLabels(page);
}

export async function postJson(request, path, payload) {
  const response = await request.post(path, { data: payload });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function getJson(request, path) {
  const response = await request.get(path);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export function withPayload(overrides = {}) {
  return deepMerge(baseTaxPayload, overrides);
}

export function deepMerge(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object") {
      output[key] = deepMerge(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
