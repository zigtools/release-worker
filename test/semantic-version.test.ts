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
])("invalid %s? -> %j", (versionString) => {
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
