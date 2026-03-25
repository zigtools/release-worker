declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]; // Defined in `vitest.config.mts`
  }
}
