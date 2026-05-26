import { expect, test } from "@playwright/test";
import { baseTaxPayload, clickAction, goToStep, openCalculator } from "./helpers.mjs";

test.describe("Feature: Production deployment smoke", () => {
  test("serves JSON from health and tax API routes", async ({ request }) => {
    const health = await request.get("/health");
    expect(health.ok()).toBeTruthy();
    expect(health.headers()["content-type"]).toContain("application/json");
    await expectJsonBody(health, "ok");

    const compute = await request.post("/api/v1/tax/compute", {
      data: {
        ...baseTaxPayload,
        income: {
          salary: {
            gross_salary: 0
          }
        }
      }
    });
    expect(compute.ok()).toBeTruthy();
    expect(compute.headers()["content-type"]).toContain("application/json");
    const body = await expectJsonBody(compute, "ok");
    expect(body.summary ?? body.computation_hash ?? body.worksheet).toBeTruthy();
  });

  test("computes from the launched UI without a non-JSON deployment error", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "results");
    await clickAction(page, "compute-button");

    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
    const actionError = page.getByTestId("action-error");
    const errorText = await actionError.count() ? await actionError.textContent() : "";
    expect(errorText).not.toContain("The page could not be found");
    expect(errorText).not.toContain("not valid JSON");
    expect(errorText).not.toContain("/api/v1/tax/compute returned 404");
  });
});

async function expectJsonBody(response, expectedStatus) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url()}, got: ${text.slice(0, 120)}`);
  }
  expect(body.status).toBe(expectedStatus);
  return body;
}
