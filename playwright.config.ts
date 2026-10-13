import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  return readFileSync(".env", "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"))?.[1];
}

const PORT = 3210;
const E2E_DATABASE_URL = env("E2E_DATABASE_URL");
if (!E2E_DATABASE_URL || !/_e2e\b/.test(new URL(E2E_DATABASE_URL).pathname)) {
  throw new Error('Set E2E_DATABASE_URL to a database whose name ends in "_e2e" (see .env.example, then npm run e2e:db).');
}
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

/**
 * One end-to-end run against a PRODUCTION build (the same code that ships, with the setup token, the
 * Content Security Policy and the secure cookie), on its own database that is wiped first.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Your installed Chrome, so no browser has to be downloaded.
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // A separate build folder (NEXT_DIST_DIR) keeps this off the one `next dev` uses.
    command: process.env.E2E_SKIP_BUILD ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/offline`,
    timeout: 300_000,
    // Show the server log in the test output, so a failure on the server is visible next to the failing step.
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET || env("AUTH_SECRET") || "e2e-only-secret-that-is-at-least-32-characters",
      SETUP_TOKEN: "e2e-setup-token",
      NODE_ENV: "production",
      // In CI the normal build already ran (E2E_SKIP_BUILD), so use its folder.
      ...(process.env.E2E_SKIP_BUILD ? {} : { NEXT_DIST_DIR: ".next-e2e" }),
    },
  },
});
