import { describe, expect, test } from "bun:test";
import { checkOrigin, checkSecret } from "../src/server.ts";

describe("checkOrigin", () => {
  const allowed = ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];

  test("refuses wrong origin", () => {
    expect(checkOrigin("chrome-extension://ccccccccccccccccccccccccccccccc", allowed)).toBe(false);
  });

  test("refuses missing origin", () => {
    expect(checkOrigin(null, allowed)).toBe(false);
    expect(checkOrigin(undefined, allowed)).toBe(false);
  });

  test("refuses non chrome-extension origin", () => {
    expect(checkOrigin("https://example.com", allowed)).toBe(false);
  });

  test("accepts an allowed extension origin", () => {
    expect(checkOrigin(`chrome-extension://${allowed[0]}`, allowed)).toBe(true);
  });
});

describe("checkSecret", () => {
  const expected = "0123456789abcdef0123456789abcdef";

  test("refuses missing secret", () => {
    expect(checkSecret(undefined, expected)).toBe(false);
    expect(checkSecret(null, expected)).toBe(false);
  });

  test("refuses wrong secret", () => {
    expect(checkSecret("wrong-secret-wrong-secret-wrong!", expected)).toBe(false);
  });

  test("accepts the correct secret", () => {
    expect(checkSecret(expected, expected)).toBe(true);
  });
});
