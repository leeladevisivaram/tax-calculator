import { expect, test } from "@playwright/test";
import { assertNoInternalLabels, openCalculator } from "./helpers.mjs";

test.describe("Feature: Chatbot UI and E2E coverage", () => {
  test.describe("Task: chatbot shell, quick prompts, and question answers", () => {
    test("opens, closes, and exposes all chatbot quick prompts", async ({ page }) => {
      await openCalculator(page);

      await page.getByTestId("chatbot-toggle-button").focus();
      await expect(page.getByTestId("chatbot-toggle-button")).toBeFocused();
      await page.getByTestId("chatbot-toggle-button").click();

      await expect(page.getByTestId("chatbot-panel")).toBeVisible();
      await expect(page.getByTestId("chatbot-input")).toBeFocused();
      await expect(page.getByTestId("chatbot-ai-status")).toContainText("AI assist is matching app help content");
      await expect(page.getByTestId("chatbot-prompt-start")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-tds")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-salary")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-compare")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-unavailable")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-error")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-active")).toBeVisible();
      await expect(page.getByTestId("chatbot-prompt-result")).toBeVisible();

      await page.getByTestId("chatbot-close-button").click();
      await expect(page.getByTestId("chatbot-panel")).toBeHidden();
      await assertNoInternalLabels(page);
    });

    test("answers no-knowledge, beginner, intermediate, advanced, and unavailable feature prompts", async ({ page }) => {
      await openCalculator(page);
      await page.getByTestId("chatbot-toggle-button").click();

      await askChatbot(page, "I do not know tax where should I start?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("Start with Profile");
      await expect(page.getByTestId("panel-profile")).toBeVisible();

      await askChatbot(page, "I am a beginner with salary income what should I do?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("beginner salary flow");
      await expect(page.getByTestId("panel-income")).toBeVisible();

      await askChatbot(page, "I know my income and deductions how should I compare regimes?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("Compare regimes");
      await expect(page.getByTestId("panel-results")).toBeVisible();

      await askChatbot(page, "I am an advanced user how do I audit the calculation?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("worksheet");
      await expect(page.getByTestId("panel-results")).toBeVisible();

      await askChatbot(page, "Can I upload a PDF Form 16?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("PDF upload is active");
      await expect(page.getByTestId("panel-imports")).toBeVisible();

      await askChatbot(page, "What should I do on this step?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("You are on Imports");

      await askChatbot(page, "Explain my result summary");
      await expect(page.getByTestId("chatbot-messages")).toContainText("Plain-English result");
      await expect(page.getByTestId("panel-results")).toBeVisible();
      await assertNoInternalLabels(page);
    });

    test("fills fields, requires review for multi-field changes, and refuses out-of-scope prompts", async ({ page }) => {
      await openCalculator(page);
      await page.getByTestId("chatbot-toggle-button").click();

      await askChatbot(page, "Set gross salary to 900000");
      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
      await expect(page.getByTestId("panel-income")).toBeVisible();
      await expect(page.getByTestId("chatbot-messages")).toContainText("I applied that in the calculator.");

      await askChatbot(page, "Choose old regime and set gross salary to 800000");
      await expect(page.getByTestId("chatbot-action-preview")).toContainText("Review suggested changes");
      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
      await page.getByTestId("chatbot-apply-actions-button").click();
      await expect(page.locator('[name="regime"][value="old"]')).toBeChecked();
      await expect(page.getByTestId("gross-salary")).toHaveValue("800000");

      await askChatbot(page, "Which mutual fund should I buy?");
      await expect(page.getByTestId("chatbot-messages")).toContainText("I can’t answer questions outside the app");
      await expect(page.getByTestId("chatbot-action-preview")).toBeEmpty();
      await assertNoInternalLabels(page);
    });
  });

  test.describe("Task: chatbot API through browser request context", () => {
    test("returns scoped API responses for question-bank, action, unavailable, and refusal cases", async ({ request }) => {
      const cases = [
        {
          message: "Where do I enter TDS?",
          expectedScope: "in_scope",
          expectedText: /Credits/,
          expectedStep: "credits"
        },
        {
          message: "I do not know tax where should I start?",
          expectedScope: "in_scope",
          expectedText: /Start with Profile/,
          expectedStep: "profile"
        },
        {
          message: "Can I upload a PDF Form 16?",
          expectedScope: "in_scope",
          expectedText: /PDF upload is active/,
          expectedStep: "imports"
        },
        {
          message: "Set gross salary to 900000",
          expectedScope: "in_scope",
          expectedText: /Gross salary/,
          expectedField: "gross_salary"
        },
        {
          message: "Which mutual fund should I buy?",
          expectedScope: "out_of_scope",
          expectedText: /outside the app/,
          expectedNoActions: true
        }
      ];

      for (const item of cases) {
        const response = await request.post("/api/v1/chatbot/message", {
          data: { message: item.message, form_state: {} }
        });
        expect(response.ok()).toBeTruthy();
        const body = await response.json();

        expect(body.status).toBe("ok");
        expect(body.scope).toBe(item.expectedScope);
        expect(body.reply).toMatch(item.expectedText);
        expect(body.reply).not.toMatch(/Sprint \d|sprint\d+-v\d+|sprint-zero/i);
        if (item.expectedStep) {
          expect(body.actions.some((action) => action.step === item.expectedStep)).toBeTruthy();
        }
        if (item.expectedField) {
          expect(body.actions.some((action) => action.field === item.expectedField)).toBeTruthy();
        }
        if (item.expectedNoActions) {
          expect(body.actions).toEqual([]);
        }
      }
    });
  });
});

async function askChatbot(page, message) {
  await page.getByTestId("chatbot-input").fill(message);
  await page.getByTestId("chatbot-send-button").click();
  await expect(page.getByTestId("chatbot-messages")).toContainText(message);
}
