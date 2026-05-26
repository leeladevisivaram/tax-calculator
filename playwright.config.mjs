import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const workers = Number.parseInt(process.env.PW_WORKERS ?? process.env.TEST_CONCURRENCY ?? "5", 10);
const headless = process.env.HEADLESS !== "false";
const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL;
const localBaseUrl = `http://127.0.0.1:${port}`;
const baseURL = configuredBaseUrl ?? localBaseUrl;
const shouldStartLocalServer = !configuredBaseUrl;

const config = {
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
    baseURL,
    channel: "chrome",
    headless,
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  reporter: [["list"]]
};

if (shouldStartLocalServer) {
  config.webServer = {
    command: `${process.execPath} src/server.mjs`,
    url: `${localBaseUrl}/health`,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  };
}

export default defineConfig(config);
