import { SELF } from "cloudflare:test";
import { test, expect } from "vitest";

test("unknown URL path", async () => {
  const response = await SELF.fetch("https://example.com/unknown", {});
  expect(response.status).toBe(404);
  expect(Object.fromEntries(response.headers.entries())).toStrictEqual({});
});

test("standard OPTIONS request", async () => {
  const response = await SELF.fetch("https://example.com", {
    method: "OPTIONS",
  });
  expect(response.status).toBe(200);
  expect(Object.fromEntries(response.headers.entries())).toStrictEqual({
    allow: "GET, HEAD, POST, OPTIONS",
  });
});

test("CORS OPTIONS request", async () => {
  const response = await SELF.fetch("https://example.com", {
    method: "OPTIONS",
    headers: {
      Origin: "https://foo.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  expect(response.status).toBe(200);
  expect(Object.fromEntries(response.headers.entries())).toStrictEqual({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-max-age": "86400",
  });
});
