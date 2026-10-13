import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // DATABASE_URL for the integration tests (tests/server) comes from .env locally and CI env in CI.
    // Tests run against TEST_DATABASE_URL when set (see npm run test:db), never your working database.
    env: (() => {
      const e = loadEnv(mode, process.cwd(), "");
      return {
        ...e,
        DATABASE_URL: e.TEST_DATABASE_URL || e.DATABASE_URL,
        AUTH_SECRET: e.AUTH_SECRET || "test-only-secret-that-is-at-least-32-characters-long",
      };
    })(),
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
}));
