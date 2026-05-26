import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const workers = Number.parseInt(process.env.PW_WORKERS ?? process.env.TEST_CONCURRENCY ?? "5", 10);
const headless = process.env.HEADLESS !== "false";

export default defineConfig({
  testDir: "./testing/tests/e2e",
  testMatch: "**/*.spec.mjs",
  outputDir: "./testing/output/test-results",
  fullyParallel: true,
  workers,
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    headless,
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `${process.execPath} src/server.mjs`,
    url: `http://127.0.0.1:${port}/health`,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  },
  reporter: [["list"]]
});
