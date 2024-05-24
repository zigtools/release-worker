import { SELF } from "cloudflare:test";
import { test, expect } from "vitest";

test("unknown URL path", async () => {
  const response = await SELF.fetch("https://example.com/unknown", {});
  expect(response.status).toBe(404);
});
