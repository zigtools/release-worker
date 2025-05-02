declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    ZIGTOOLS_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[]; // Defined in `vitest.config.ts`
  }
}
