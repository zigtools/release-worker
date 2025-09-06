import { test, expect } from "vitest";
import assert from "node:assert";
import { Order, SemanticVersion } from "../src/semantic-version";

test.each<string>([
  "",
  "0",
  "0.0",
  "0.0.",
  "0.0.0-dev",
  "0.0.0+dev",
  "0.0.0-dev.",
  "0.0.0+dev.",
  "0.0.0-dev.1",
  "0.0.0+dev.1",
  "1.0.0-dev+aaaaaaaaa",
  "1.0.0-dev.1-aaaaaaaaa",
  "1.0.0-dev.1+aaaaa",
  "1.0.0-dev.1+aaaaaaaaaaaaa",
  "99999999999999999999999999999999.0.0",
  "1.99999999999999999999999999999999.0",
  "1.0.99999999999999999999999999999999",
  "1.0.0-dev.99999999999999999999999999999999+aaaaaaaaa",
])("invalid %s", (versionString) => {
  const version = SemanticVersion.parse(versionString);
  expect(version).toBeNull();
});

test.each<string>([
  "0.0.0",
  "0.0.0-dev.1+aaaaaaaaa",
  "0.0.0-dev.20+aaaaaaaaa",
  "0.0.0-dev.1+abcdef123",
  "0.13.0-dev.249+ed75f6256",
  "0.13.0-dev.34+93b7bbd",
  "0.12.0-dev.722+412d863ba",
])("valid %s", (versionString) => {
  const version = SemanticVersion.parse(versionString);
  expect(version).toBeTruthy();
  assert(version !== null);
  expect(version.toString()).toBe(versionString);
});

test("toString", () => {
  const version = SemanticVersion.parse("0.0.0-dev.1+aaaaaaaaa");
  expect(Object.prototype.toString.call(version)).toBe(
    "[object 0.0.0-dev.1+aaaaaaaaa]",
  );
});

test.each<[string, "<" | "=" | ">", string]>([
  ["0.0.0", "<", "1.0.0"],
  ["1.0.0", "=", "1.0.0"],
  ["1.0.0", ">", "0.0.0"],

  ["0.0.0", "<", "0.1.0"],
  ["0.1.0", "=", "0.1.0"],
  ["0.1.0", ">", "0.0.0"],

  ["0.0.0", "<", "0.0.1"],
  ["0.0.1", "=", "0.0.1"],
  ["0.0.1", ">", "0.0.0"],

  ["1.0.0", ">", "1.0.0-dev.1+aaaaaaaaa"],
  ["1.0.0-dev.1+aaaaaaaaa", "<", "1.0.0"],

  ["1.0.0-dev.0+aaaaaaaaa", "<", "1.0.0-dev.1+aaaaaaaaa"],
  ["1.0.0-dev.1+aaaaaaaaa", "=", "1.0.0-dev.1+aaaaaaaaa"],
  ["1.0.0-dev.1+aaaaaaaaa", ">", "1.0.0-dev.0+aaaaaaaaa"],

  ["1.0.0-dev.1+aaaaaaaaa", "=", "1.0.0-dev.1+bbbbbbbbb"],
])("order %s %s %s", (lhsString, order, rhsString) => {
  const lhsVersion = SemanticVersion.parse(lhsString);
  assert(lhsVersion !== null);
  const rhsVersion = SemanticVersion.parse(rhsString);
  assert(rhsVersion !== null);

  const actualOrder = SemanticVersion.order(lhsVersion, rhsVersion);
  let expectedOrder: Order;
  switch (order) {
    case "<":
      expectedOrder = Order.lt;
      break;
    case "=":
      expectedOrder = Order.eq;
      break;
    case ">":
      expectedOrder = Order.gt;
      break;
  }
  expect(actualOrder).toBe(expectedOrder);
});

test.each<[string, string, "no" | "yes" | "if-no-strict"]>([
  // Minimum Version: 0.12.0
  ["0.12.0", "0.11.0-dev.1+aaaaaaa", "no"],
  ["0.12.0", "0.11.0", "no"],
  ["0.12.0", "0.12.0-dev.1+aaaaaaa", "no"],
  ["0.12.0", "0.12.0", "yes"],
  ["0.12.0", "0.12.1-dev.1+aaaaaaa", "yes"],
  ["0.12.0", "0.12.1", "yes"],
  ["0.12.0", "0.13.0-dev.1+aaaaaaa", "if-no-strict"],
  ["0.12.0", "0.13.0", "no"],
  ["0.12.0", "0.13.1-dev.1+aaaaaaa", "no"],
  ["0.12.0", "1.0.0", "no"],
  // Minimum Version: 0.12.1
  ["0.12.1", "0.11.0", "no"],
  ["0.12.1", "0.11.1", "no"],
  ["0.12.1", "0.12.0-dev.1+aaaaaaa", "no"],
  ["0.12.1", "0.12.0", "no"],
  ["0.12.1", "0.12.1-dev.1+aaaaaaa", "no"],
  ["0.12.1", "0.12.1", "yes"],
  ["0.12.1", "0.12.2-dev.1+aaaaaaa", "yes"],
  ["0.12.1", "0.12.2", "yes"],
  ["0.12.1", "0.13.0-dev.1+aaaaaaa", "if-no-strict"],
  ["0.12.1", "0.13.0", "no"],
  ["0.12.1", "0.13.1-dev.1+aaaaaaa", "no"],
  ["0.12.1", "0.13.1", "no"],
  // Minimum Version: 0.12.0-dev.5+aaaaa
  ["0.12.0-dev.5+aaaaaaa", "0.11.0-dev.1+aaaaaaa", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.11.0", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.0-dev.1+aaaaaaa", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.0-dev.4+aaaaaaa", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.0-dev.5+aaaaaaa", "yes"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.0-dev.10+aaaaaaa", "yes"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.0", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.12.1", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.13.0-dev.10+aaaaaaa", "no"],
  ["0.12.0-dev.5+aaaaaaa", "0.13.0", "no"],
])("%s satisfies min=%s -> %s", (minimumString, versionString, expected) => {
  const minimum = SemanticVersion.parse(minimumString);
  assert(minimum !== null);
  const version = SemanticVersion.parse(versionString);
  assert(version !== null);
  switch (expected) {
    case "no":
      expect(SemanticVersion.satisfies(version, minimum, false)).toBe(false);
      if (minimum.isRelease) {
        expect(SemanticVersion.satisfies(version, minimum, true)).toBe(false);
      }
      break;
    case "yes":
      expect(SemanticVersion.satisfies(version, minimum, false)).toBe(true);
      if (minimum.isRelease) {
        expect(SemanticVersion.satisfies(version, minimum, true)).toBe(true);
      }
      break;
    case "if-no-strict":
      expect(SemanticVersion.satisfies(version, minimum, false)).toBe(true);
      if (minimum.isRelease) {
        expect(SemanticVersion.satisfies(version, minimum, true)).toBe(false);
      }
      break;
  }
});
