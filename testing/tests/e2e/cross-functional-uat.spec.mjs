import { expect, test } from "@playwright/test";
import { assertNoInternalLabels, goToStep, openCalculator } from "./helpers.mjs";

const viewports = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile portrait", width: 390, height: 844 },
  { name: "mobile landscape", width: 844, height: 390 }
];

test.describe("Feature: Cross-functional UAT - UI viewports", () => {
  test.describe("Task: desktop, tablet, mobile portrait, and mobile landscape layouts", () => {
    for (const viewport of viewports) {
      test(`keeps ${viewport.name} layout usable without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openCalculator(page);
        await goToStep(page, "income");

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        await expect(page.getByTestId("panel-income")).toBeVisible();
        await expect(page.getByTestId("action-bar")).toBeVisible();
        await expect(page.getByTestId("sticky-summary")).toBeAttached();
      });
    }
  });
});

test.describe("Feature: Cross-functional UAT - accessibility variations", () => {
  test.describe("Task: keyboard-only, screen-reader, high-contrast, and reduced-motion behavior", () => {
    test("supports keyboard-only navigation for primary calculation controls", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("hero-start-button")).toBeVisible();

      await page.getByTestId("hero-start-button").focus();
      await expect(page.getByTestId("hero-start-button")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("panel-profile")).toBeVisible();

      await page.getByTestId("step-results").focus();
      await expect(page.getByTestId("step-results")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("panel-results")).toBeVisible();

      await page.getByTestId("action-group-calculate").locator("summary").focus();
      await page.keyboard.press("Enter");
      await page.getByTestId("validate-button").focus();
      await expect(page.getByTestId("validate-button")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("compute-button")).toBeFocused();
    });

    test("keeps controls labelled and dynamic result regions announced", async ({ page }) => {
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

      for (const testId of ["validation-output", "result-output", "comparison-output", "report-output", "privacy-output", "launch-output"]) {
        const region = page.getByTestId(testId);
        await expect(region).toBeAttached();
        const announcement = await region.evaluate((node) => ({
          ariaLive: node.getAttribute("aria-live"),
          role: node.getAttribute("role")
        }));
        expect([announcement.ariaLive, announcement.role]).toEqual(expect.arrayContaining([expect.stringMatching(/polite|status/)]));
      }
    });

    test("supports high contrast mode with visible keyboard focus", async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/");
      await expect(page.getByTestId("hero-start-button")).toBeVisible();

      await page.getByTestId("hero-start-button").focus();
      await expect(page.getByTestId("hero-start-button")).toBeFocused();
      const focusedOutline = await page.getByTestId("hero-start-button").evaluate((node) => {
        const style = window.getComputedStyle(node);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth
        };
      });
      expect(focusedOutline.outlineStyle).not.toBe("none");
      expect(Number.parseFloat(focusedOutline.outlineWidth)).toBeGreaterThan(0);
    });

    test("honors reduced motion preference for animated loading states", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByTestId("hero-start-button")).toBeVisible();

      await page.getByTestId("hero-start-button").evaluate((node) => node.classList.add("loading"));
      const animationDuration = await page.getByTestId("hero-start-button").evaluate((node) => window.getComputedStyle(node).animationDuration);
      expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.01);
    });
  });
});

test.describe("Feature: Cross-functional UAT - language variations", () => {
  test.describe("Task: supported languages, untranslated fallback, and long translated text", () => {
    test("lists supported UI languages and announces fallback for unreviewed translations", async ({ page }) => {
      await openCalculator(page);

      const options = await page.getByTestId("language-select").locator("option").evaluateAll((items) => {
        return items.map((item) => ({ value: item.value, label: item.textContent?.trim() }));
      });
      expect(options).toEqual([
        { value: "en-IN", label: "English" },
        { value: "hi-IN", label: "Hindi fallback" }
      ]);

      await page.getByTestId("language-select").selectOption("hi-IN");
      await expect(page.getByTestId("draft-status")).toContainText("English fallback shown for selected language");
      await expect(page.locator("html")).toHaveAttribute("lang", "hi-IN");

      await page.getByTestId("language-select").selectOption("en-IN");
      await expect(page.locator("html")).toHaveAttribute("lang", "en-IN");
      await assertNoInternalLabels(page);
    });

    test("keeps long user-entered text from creating layout overflow", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "launch");

      const longFeedback = "Tax calculation explanation must remain readable for long translated support text. ".repeat(20);
      await page.getByTestId("feedback-description").fill(longFeedback);
      await page.getByTestId("classify-feedback-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Beta defect triage");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
