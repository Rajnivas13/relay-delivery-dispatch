import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // CI provides env vars directly.
}

const testUrl = process.env.TEST_DATABASE_URL ?? "postgresql://relay:relay@localhost:5433/relay_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testUrl,
      DIRECT_URL: testUrl,
      OPENROUTER_API_KEY: "",
      LAZY_SWEEP_INTERVAL_MS: "0",
      CRON_SECRET: "test-cron-secret",
      ALLOW_SEED: "true",
      AUTH_SECRET: "test-auth-secret-test-auth-secret",
    },
  },
});
