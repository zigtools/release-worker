import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig, ViteUserConfig } from "vitest/config";

export default defineConfig(async () => {
  // Read all migrations in the `migrations` directory
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      coverage: {
        provider: "istanbul",
        reporter: ["text", "json", "html"],
      },
    },
  } satisfies ViteUserConfig;
});
