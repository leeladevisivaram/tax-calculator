import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  clearScenarioField,
  clickAction,
  expectActionError,
  fillSalaryScenario,
  goToStep,
  openCalculator,
  setScenarioField
} from "./helpers.mjs";

test.describe("Sprint 7 UAT: Privacy and Data Governance UI", () => {
  test("TC-S7-002 exports local browser-held draft data", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await clickAction(page, "save-button");

    await goToStep(page, "profile");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-local-data-button").click();
    const download = await downloadPromise;
    const body = JSON.parse(await readFile(await download.path(), "utf8"));

    expect(download.suggestedFilename()).toBe("tax-calculator-privacy-export.json");
    expect(body.status).toBe("ok");
    expect(body.package.draft.gross_salary).toBe("900000");
    await expect(page.getByTestId("privacy-output")).toContainText("Export ready");
  });

  test("TC-S7-003 deletes local draft, report, and import state gracefully", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await clickAction(page, "save-button");
    await expect(page.getByTestId("draft-status")).toContainText("Draft saved");

    await goToStep(page, "profile");
    await page.getByTestId("delete-local-data-button").click();

    await expect(page.getByTestId("privacy-output")).toContainText("Local data deleted");
    await expect(page.getByTestId("draft-status")).toContainText("Local data deleted");
    const storedDraft = await page.evaluate(() => localStorage.getItem("tax-wizard-draft"));
    expect(storedDraft).toBeNull();
  });

  test("TC-S7-004 shows import consent checkpoint and blocks unconfirmed apply", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "imports");

    await expect(page.getByText(/Preview imported values and apply them only after review confirmation/i)).toBeVisible();
    await page.getByTestId("import-content").fill("gross_salary,tds\n900000,45000");
    await clickAction(page, "apply-import-button");

    await expectActionError(page, "Apply import cannot run because Import review confirmation is missing.");
  });

  test("TC-S7-005 captures saved-profile privacy notice acknowledgement", async ({ page }) => {
    await openCalculator(page);

    await expect(page.getByText(/local drafts stay on this device until deleted/i)).toBeVisible();
    await page.getByTestId("privacy-ack").check();
    await clickAction(page, "save-button");

    const checks = await page.evaluate(() => JSON.parse(localStorage.getItem("tax-wizard-checks")));
    expect(checks.privacy_notice_ack).toBe(true);
    await expect(page.getByTestId("draft-status")).toContainText("Draft saved");
  });
});

test.describe("Sprint 7 UAT: Accessibility and Quality UI", () => {
  test("TC-S7-016 completes the core calculation flow using keyboard actions", async ({ page }) => {
    await openCalculator(page);

    await page.getByTestId("step-income").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("panel-income")).toBeVisible();

    await page.getByTestId("gross-salary").focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("1275000");

    await page.getByTestId("step-results").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("panel-results")).toBeVisible();

    await page.getByTestId("action-group-calculate").locator("summary").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("compute-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
  });

  test("TC-S7-017 provides visible focus styling on primary controls", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "results");
    await page.getByTestId("action-group-calculate").locator("summary").click();
    await page.getByTestId("validate-button").focus();

    const focusStyle = await page.getByTestId("validate-button").evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        boxShadow: styles.boxShadow,
        outlineStyle: styles.outlineStyle
      };
    });
    expect(focusStyle.boxShadow).not.toBe("none");
  });

  test("TC-S7-018 keeps form controls labelled and dynamic regions screen-reader friendly", async ({ page }) => {
    await openCalculator(page);

    const controlsWithoutLabels = await page.locator("input, select, textarea").evaluateAll((controls) => {
      return controls
        .filter((control) => {
          const id = control.getAttribute("id");
          const hasParentLabel = Boolean(control.closest("label"));
          const hasAria = Boolean(control.getAttribute("aria-label") || control.getAttribute("aria-labelledby"));
          const hasForLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
          return !hasParentLabel && !hasAria && !hasForLabel;
        })
        .map((control) => control.getAttribute("name") || control.outerHTML);
    });
    expect(controlsWithoutLabels).toEqual([]);

    for (const testId of ["validation-output", "import-output", "privacy-output", "launch-output"]) {
      const region = page.getByTestId(testId);
      await expect(region).toHaveAttribute("aria-live", /polite|assertive/);
    }
  });

  test("TC-S7-019 announces validation errors through alert semantics", async ({ page }) => {
    await openCalculator(page);
    await clearScenarioField(page, "age_years");
    await clickAction(page, "validate-button");

    await expect(page.getByTestId("action-error")).toContainText("Age is missing");
    await expect(page.getByTestId("action-error")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("action-error")).toHaveAttribute("aria-live", "assertive");
  });

  test("TC-S7-020 keeps warning and blocker states above contrast threshold", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "deductions");
    await setScenarioField(page, "deduction_80c", 150000);
    await goToStep(page, "results");
    await clickAction(page, "validate-button");

    const warningRatio = await contrastFor(page, ".notice.warning");
    expect(warningRatio).toBeGreaterThanOrEqual(4.5);

    await clearScenarioField(page, "age_years");
    await clickAction(page, "validate-button");
    const blockerRatio = await contrastFor(page, ".notice.blocker");
    expect(blockerRatio).toBeGreaterThanOrEqual(4.5);
  });

  test("TC-S7-021 honors reduced-motion preferences for loading animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("hero-start-button")).toBeVisible();

    const durationMs = await page.getByTestId("hero-start-button").evaluate((element) => {
      element.classList.add("loading");
      const duration = getComputedStyle(element, "::after").animationDuration;
      if (duration.endsWith("ms")) return Number.parseFloat(duration);
      if (duration.endsWith("s")) return Number.parseFloat(duration) * 1000;
      return Number.POSITIVE_INFINITY;
    });
    expect(durationMs).toBeLessThanOrEqual(0.01);
  });
});

async function contrastFor(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    function channel(value) {
      const linear = value / 255;
      return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
    }

    function luminance(rgb) {
      const [red, green, blue] = rgb;
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    }

    function parseRgb(value) {
      return value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
    }

    const styles = getComputedStyle(element);
    const foreground = luminance(parseRgb(styles.color));
    const background = luminance(parseRgb(styles.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}
