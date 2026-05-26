import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  ACTION_REQUIREMENTS,
  REQUIRED_UI_ELEMENTS,
  missingElementMessage,
  renderMissingElementMessage,
  validateActionElements,
  validateActionInputValues,
  validateRequiredElements
} from "../../public/ui-validation.js";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

describe("Feature: API validation", () => {
  describe("Task: negative payload checks", () => {
    const cases = [
      {
        name: "rejects unsupported period type",
        patch: { period_type: "calendar_year" },
        fieldPath: "period_type",
        code: "VAL_PERIOD_TYPE_UNSUPPORTED",
        inputValue: "calendar_year"
      },
      {
        name: "rejects unsupported assessment year",
        patch: { period: "2024-25" },
        fieldPath: "period",
        code: "VAL_PERIOD_UNSUPPORTED",
        inputValue: "2024-25"
      },
      {
        name: "rejects act and assessment-year mismatch",
        patch: { act: "Income-tax Act, 2025" },
        fieldPath: "act",
        code: "VAL_ACT_PERIOD_MISMATCH",
        inputValue: "Income-tax Act, 2025"
      },
      {
        name: "rejects unsupported taxpayer type",
        patch: { taxpayer_type: "company" },
        fieldPath: "taxpayer_type",
        code: "VAL_TAXPAYER_TYPE_UNSUPPORTED",
        inputValue: "company"
      },
      {
        name: "rejects missing residency",
        patch: { residency: "" },
        fieldPath: "residency",
        code: "VAL_RESIDENCY_REQUIRED",
        inputValue: ""
      },
      {
        name: "rejects negative age",
        patch: { age_years: -1 },
        fieldPath: "age_years",
        code: "VAL_AGE_REQUIRED",
        inputValue: -1
      },
      {
        name: "rejects missing age",
        patch: { age_years: undefined },
        fieldPath: "age_years",
        code: "VAL_AGE_REQUIRED",
        inputValue: undefined
      },
      {
        name: "rejects unsupported regime",
        patch: { regime: "hybrid" },
        fieldPath: "regime",
        code: "VAL_REGIME_UNSUPPORTED",
        inputValue: "hybrid"
      }
    ];

    for (const testCase of cases) {
      it(`${testCase.name} for input value ${String(testCase.inputValue)}`, () => {
        const report = validateTaxRequest(baseRequest(testCase.patch));

        assert.equal(report.status, "blocked");
        assertHasValidation(report, testCase.code, "blocker", testCase.fieldPath);
      });
    }

    it("reports HRA base input missing for an old-regime HRA claim", () => {
      const report = validateTaxRequest(baseRequest({
        regime: "old",
        income: {
          salary: {
            hra_received: 120000,
            rent_paid: 180000,
            basic_salary: 0
          }
        }
      }));

      assert.equal(report.status, "blocked");
      assertHasValidation(report, "VAL_HRA_SALARY_BASE_REQUIRED", "blocker", "income.salary.basic_salary");
    });

    it("blocks LTA when the journey count is already exhausted", () => {
      const report = validateTaxRequest(baseRequest({
        regime: "old",
        income: { salary: { gross_salary: 500000 } },
        claims: {
          lta: {
            journeys_already_claimed_in_block: 2,
            current_claim_amount: 50000
          }
        }
      }));

      assert.equal(report.status, "blocked");
      assertHasValidation(report, "WARN_LTA_BLOCK_LIMIT_EXCEEDED", "blocker", "claims.lta.journeys_already_claimed_in_block");
    });

    it("warns for new-regime 80C input and double housing-interest input values", () => {
      const report = validateTaxRequest(baseRequest({
        deductions: {
          standard_deduction: true,
          chapter_via: [
            { section: "80C", amount: 150000 },
            { section: "80EE", amount: 50000 },
            { section: "80EEA", amount: 150000 }
          ]
        }
      }));

      assertHasValidation(report, "WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME", "warning", "deductions.chapter_via");
      assertHasValidation(report, "WARN_80EE_80EEA_MUTUAL_EXCLUSION", "blocker", "deductions.chapter_via");
    });

    it("uses user-safe remediation messages without sprint names", () => {
      const report = validateTaxRequest(baseRequest({ taxpayer_type: "company" }));
      const messages = report.results.map((result) => result.remediation_hint).join(" ");

      assert.match(messages, /individual and HUF taxpayers only/);
      assert.doesNotMatch(messages, /Sprint \d|sprint\d+-v\d+/i);
    });
  });
});

describe("Feature: UI validation", () => {
  describe("Task: required button and element checks", () => {
    it("passes when every required element exists", () => {
      const root = rootWithSelectors(REQUIRED_UI_ELEMENTS.map((element) => element.selector));
      const validation = validateRequiredElements(root);

      assert.equal(validation.valid, true);
      assert.deepEqual(validation.missing, []);
      assert.deepEqual(validation.messages, []);
    });

    for (const element of REQUIRED_UI_ELEMENTS.filter((item) => item.type === "button")) {
      it(`reports the particular missing button: ${element.label}`, () => {
        const selectors = REQUIRED_UI_ELEMENTS
          .map((item) => item.selector)
          .filter((selector) => selector !== element.selector);
        const validation = validateRequiredElements(rootWithSelectors(selectors));

        assert.equal(validation.valid, false);
        assert.deepEqual(validation.missing, [element]);
        assert.deepEqual(validation.messages, [missingElementMessage(element)]);
      });
    }

    for (const element of REQUIRED_UI_ELEMENTS.filter((item) => item.type !== "button")) {
      it(`reports the particular missing shell element: ${element.label}`, () => {
        const selectors = REQUIRED_UI_ELEMENTS
          .map((item) => item.selector)
          .filter((selector) => selector !== element.selector);
        const validation = validateRequiredElements(rootWithSelectors(selectors));

        assert.equal(validation.valid, false);
        assert.deepEqual(validation.missing, [element]);
        assert.deepEqual(validation.messages, [missingElementMessage(element)]);
      });
    }

    it("renders exact missing-element messages without sprint labels", () => {
      const validationOutput = { innerHTML: "" };
      const root = {
        body: { innerHTML: "" },
        querySelector(selector) {
          if (selector === "#validation-output") return validationOutput;
          return null;
        }
      };
      const validation = validateRequiredElements(root, [
        { selector: "#compute-button", label: "Compute button", type: "button" }
      ]);

      assert.equal(renderMissingElementMessage(root, validation), true);
      assert.match(validationOutput.innerHTML, /Application setup incomplete/);
      assert.match(validationOutput.innerHTML, /Compute button is missing \(#compute-button\)\./);
      assert.doesNotMatch(validationOutput.innerHTML, /Sprint \d|sprint\d+-v\d+/i);
    });

    it("ships every required selector in the static application shell", async () => {
      const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");

      for (const element of REQUIRED_UI_ELEMENTS) {
        assert.equal(
          htmlHasSelector(html, element.selector),
          true,
          `${element.selector} should exist in public/index.html`
        );
      }
    });
  });

  describe("Task: action button missing-element and missing-input checks", () => {
    for (const action of ACTION_REQUIREMENTS) {
      it(`passes element checks when ${action.label} dependencies exist`, () => {
        const root = rootWithSelectors(action.elements);
        const validation = validateActionElements(root, action.actionId);

        assert.equal(validation.valid, true);
        assert.deepEqual(validation.messages, []);
      });

      for (const selector of action.elements) {
        it(`reports the exact missing element for ${action.label}: ${selector}`, () => {
          const root = rootWithSelectors(action.elements.filter((item) => item !== selector));
          const validation = validateActionElements(root, action.actionId);

          assert.equal(validation.valid, false);
          assert.deepEqual(validation.messages, [
            `${action.label} cannot run because ${selectorLabel(selector)} is missing (${selector}).`
          ]);
          assert.doesNotMatch(validation.messages.join(" "), /Sprint \d|sprint\d+-v\d+/i);
        });
      }

      it(`passes input checks when ${action.label} required values exist`, () => {
        const values = valuesForAction(action);
        const validation = validateActionInputValues(values, action.actionId);

        assert.equal(validation.valid, true);
        assert.deepEqual(validation.messages, []);
      });

      for (const input of action.inputs) {
        it(`reports the exact missing input value for ${action.label}: ${input.label}`, () => {
          const values = valuesForAction(action);
          values[input.name] = input.checkbox ? false : "";
          const validation = validateActionInputValues(values, action.actionId);

          assert.equal(validation.valid, false);
          assert.deepEqual(validation.messages, [
            `${action.label} cannot run because ${input.label} is missing.`
          ]);
          assert.doesNotMatch(validation.messages.join(" "), /Sprint \d|sprint\d+-v\d+/i);
        });
      }
    }
  });
});

function rootWithSelectors(selectors) {
  const selectorSet = new Set(selectors);
  return {
    body: { innerHTML: "" },
    querySelector(selector) {
      return selectorSet.has(selector) ? { selector, innerHTML: "" } : null;
    }
  };
}

function htmlHasSelector(html, selector) {
  const id = selector.match(/^#([A-Za-z0-9_-]+)$/)?.[1];
  if (id) return html.includes(`id="${id}"`) || html.includes(`id='${id}'`);

  const dataStep = selector.match(/^\[data-step="([^"]+)"\]$/)?.[1];
  if (dataStep) return html.includes(`data-step="${dataStep}"`) || html.includes(`data-step='${dataStep}'`);

  const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
  if (name) return html.includes(`name="${name}"`) || html.includes(`name='${name}'`);

  throw new Error(`Unsupported selector check: ${selector}`);
}

function selectorLabel(selector) {
  const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
  if (name) return name.replaceAll("_", " ");
  const id = selector.match(/^#(.+)$/)?.[1];
  return id ? id.replaceAll("-", " ") : selector;
}

function valuesForAction(action) {
  const values = {};
  for (const input of action.inputs) {
    values[input.name] = input.checkbox ? true : sampleValue(input.name);
  }
  return values;
}

function sampleValue(name) {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: "34",
    regime: "new",
    import_type: "form16",
    import_filename: "form16.csv",
    import_content: "gross_salary,tds\n900000,45000",
    feedback_description: "Wrong tax amount for 112A after date split."
  }[name] ?? "ready";
}

function baseRequest(overrides = {}) {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true },
    tax_credits: {},
    ...overrides
  };
}

function assertHasValidation(report, code, severity, fieldPath) {
  const result = report.results.find((item) => item.code === code);
  assert.ok(result, `expected validation result ${code}`);
  assert.equal(result.severity, severity, `${code} severity`);
  assert.equal(result.field_path, fieldPath, `${code} field_path`);
  assert.ok(result.remediation_hint, `${code} remediation_hint`);
}
