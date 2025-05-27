import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Read all migrations in the `migrations` directory
const migrationsPath = path.join(import.meta.dirname, "migrations");
const migrations = await readD1Migrations(migrationsPath);

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
        singleWorker: true, // https://github.com/cloudflare/workers-sdk/issues/5942
      },
    },
  },
});
