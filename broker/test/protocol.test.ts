import { describe, expect, test } from "bun:test";
import { parseClientMessage, MAX_MESSAGE_BYTES } from "../src/protocol.ts";

describe("parseClientMessage", () => {
  test("parses a valid hello message", () => {
    const result = parseClientMessage(JSON.stringify({ type: "hello", secret: "abc123", v: 1 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual({ type: "hello", secret: "abc123", v: 1 });
    }
  });

  test("parses a valid chat message with context", () => {
    const raw = JSON.stringify({
      type: "chat",
      id: "c1",
      text: "hello there",
      context: { kind: "page", url: "https://example.com", title: "Ex", text: "body" },
    });
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === "chat") {
      expect(result.message.id).toBe("c1");
      expect(result.message.text).toBe("hello there");
      expect(result.message.context?.kind).toBe("page");
    }
  });

  test("parses a valid summarize message", () => {
    const raw = JSON.stringify({
      type: "summarize",
      id: "c2",
      context: { kind: "youtube", videoId: "abc" },
      length: "short",
    });
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
  });

  test("parses a valid act message", () => {
    const raw = JSON.stringify({
      type: "act",
      id: "c3",
      action: "translate",
      text: "bonjour",
      params: { targetLang: "en" },
    });
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
  });

  test("parses prompts.list / save / delete / cancel", () => {
    expect(parseClientMessage(JSON.stringify({ type: "prompts.list", id: "c4" })).ok).toBe(true);
    expect(
      parseClientMessage(
        JSON.stringify({ type: "prompts.save", id: "c5", prompt: { name: "n", body: "b" } }),
      ).ok,
    ).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "prompts.delete", id: "c6", name: "n" })).ok).toBe(
      true,
    );
    expect(parseClientMessage(JSON.stringify({ type: "cancel", id: "c7", target: "c2" })).ok).toBe(true);
  });

  test("rejects unknown type", () => {
    const result = parseClientMessage(JSON.stringify({ type: "nonsense", id: "c1" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("bad-request");
    }
  });

  test("rejects oversized payload", () => {
    const bigText = "x".repeat(MAX_MESSAGE_BYTES + 1);
    const raw = JSON.stringify({ type: "chat", id: "c1", text: bigText });
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("bad-request");
    }
  });

  test("rejects message missing id (non-hello)", () => {
    const result = parseClientMessage(JSON.stringify({ type: "chat", text: "hi" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("bad-request");
      expect(result.error.message).toContain("id");
    }
  });

  test("rejects invalid JSON", () => {
    const result = parseClientMessage("{not json");
    expect(result.ok).toBe(false);
  });

  test("rejects hello missing secret", () => {
    const result = parseClientMessage(JSON.stringify({ type: "hello", v: 1 }));
    expect(result.ok).toBe(false);
  });
});
