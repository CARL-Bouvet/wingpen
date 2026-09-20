// Unit tests for extension/content/extract.js. The file is an IIFE that runs
// against the real DOM (document/location) the moment it's evaluated — there
// is no jsdom/happy-dom dependency in this repo, and adding one just for this
// would be disproportionate to a MINEUR finding. Instead this builds a
// minimal fake DOM implementing exactly the calls extract.js makes
// (querySelectorAll/querySelector/closest/getElementsByTagName, a handful of
// simple-selector shapes), then `eval`s the script's source against fake
// `document`/`location` globals and reads its completion value — the same
// value chrome.scripting.executeScript would read in production.
//
// Kept intentionally narrow: it is NOT a general selector engine, only
// enough to drive the specific selector strings extract.js uses today. If
// extract.js starts using a selector shape this doesn't understand, matches()
// throws loudly rather than silently returning wrong results.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXTRACT_JS_SOURCE = readFileSync(
  join(import.meta.dir, "../../extension/content/extract.js"),
  "utf8",
);

class FakeElement {
  tagName: string;
  attrs: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null = null;
  innerText: string;
  textContent: string;

  constructor(
    tag: string,
    opts: { attrs?: Record<string, string>; children?: FakeElement[]; text?: string } = {},
  ) {
    this.tagName = tag.toUpperCase();
    this.attrs = opts.attrs ?? {};
    this.children = opts.children ?? [];
    for (const c of this.children) c.parent = this;
    this.textContent = opts.text ?? "";
    this.innerText = opts.text ?? "";
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  private walkDescendants(cb: (el: FakeElement) => void): void {
    for (const c of this.children) {
      cb(c);
      c["walkDescendants"](cb);
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    this.walkDescendants((el) => {
      if (matches(el, selector)) out.push(el);
    });
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getElementsByTagName(tag: string): FakeElement[] {
    if (tag === "*") {
      const out: FakeElement[] = [];
      this.walkDescendants((el) => out.push(el));
      return out;
    }
    return this.querySelectorAll(tag);
  }

  closest(selector: string): FakeElement | null {
    let el: FakeElement | null = this;
    while (el) {
      if (matches(el, selector)) return el;
      el = el.parent;
    }
    return null;
  }
}

/** Parses one simple selector: optional tag name, optional single [attr] or
 * [attr="value"] clause. Exactly what extract.js's selector strings need. */
function matchesSimple(el: FakeElement, simple: string): boolean {
  const trimmed = simple.trim();
  const attrMatch = trimmed.match(/^([a-zA-Z0-9-]*)\[([a-zA-Z-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]$/);
  if (attrMatch) {
    const [, tag, attr, dq, sq] = attrMatch;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    const value = el.getAttribute(attr!);
    if (value === null) return false;
    const expected = dq ?? sq;
    if (expected !== undefined && value !== expected) return false;
    return true;
  }
  if (/^[a-zA-Z0-9-]+$/.test(trimmed)) {
    return el.tagName === trimmed.toUpperCase();
  }
  throw new Error(`fake DOM matcher doesn't understand selector clause: "${simple}"`);
}

function matches(el: FakeElement, selector: string): boolean {
  return selector.split(",").some((part) => matchesSimple(el, part));
}

/** Runs extract.js's IIFE against a fake document/location and returns its
 * completion value, exactly like chrome.scripting.executeScript would. */
function runExtract(opts: { url?: string; title?: string; body: FakeElement }): any {
  const url = opts.url ?? "https://example.com/article";
  const fakeDocument = {
    title: opts.title ?? "",
    body: opts.body,
    querySelectorAll: (selector: string) => opts.body.querySelectorAll(selector),
    querySelector: (selector: string) => opts.body.querySelector(selector),
  };
  const parsed = new URL(url);
  const fakeLocation = {
    href: url,
    origin: parsed.origin,
    pathname: parsed.pathname,
    hostname: parsed.hostname,
  };
  // extract.js's source is a single `(() => { ... })();` statement — strip
  // the trailing semicolon so it can be re-embedded as a `return (<expr>)`.
  const asExpression = EXTRACT_JS_SOURCE.trim().replace(/;\s*$/, "");
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "document",
    "location",
    `"use strict";\nreturn (\n${asExpression}\n);`,
  );
  return factory(fakeDocument, fakeLocation);
}

describe("extract.js — density heuristic (unchanged behavior)", () => {
  test("a dense <article> wins outright", () => {
    const article = new FakeElement("article", { text: "x".repeat(250) });
    const body = new FakeElement("body", { children: [article] });
    const result = runExtract({ body });
    expect(result.kind).toBe("page");
    expect(result.text.length).toBe(250);
  });

  test("nav/footer/header/aside candidates are skipped even if dense", () => {
    const navDiv = new FakeElement("div", {
      children: [new FakeElement("nav", { children: [new FakeElement("div", { text: "y".repeat(500) })] })],
    });
    const goodDiv = new FakeElement("div", { text: "z".repeat(300) });
    const body = new FakeElement("body", { children: [navDiv, goodDiv] });
    const result = runExtract({ body });
    expect(result.text).toContain("zzz");
    expect(result.text).not.toContain("yyy");
  });
});

describe("extract.js — contenteditable exclusion (item 5)", () => {
  test("a draft in a nested [contenteditable] is stripped from an <article>'s text", () => {
    const draft = new FakeElement("div", {
      attrs: { contenteditable: "true" },
      text: "unsent draft comment",
    });
    const article = new FakeElement("article", {
      children: [draft],
      // innerText of a real browser DOM would include the nested draft's
      // rendered text — we set it explicitly here since our fake elements
      // don't compute layout. Padded past the 200-char density threshold so
      // the <article> wins outright via the semantic-container path.
      text: `Real article body. ${"r".repeat(220)} unsent draft comment More real body.`,
    });
    const body = new FakeElement("body", { children: [article] });
    const result = runExtract({ body });

    expect(result.text).toContain("Real article body.");
    expect(result.text).toContain("More real body.");
    expect(result.text).not.toContain("unsent draft comment");
  });

  test("a contenteditable candidate itself is skipped entirely in the density scan", () => {
    const editableDiv = new FakeElement("div", {
      attrs: { contenteditable: "true" },
      text: "w".repeat(500),
    });
    const goodDiv = new FakeElement("div", { text: "v".repeat(300) });
    const body = new FakeElement("body", { children: [editableDiv, goodDiv] });
    const result = runExtract({ body });
    expect(result.text).toContain("vvv");
    expect(result.text).not.toContain("www");
  });
});
