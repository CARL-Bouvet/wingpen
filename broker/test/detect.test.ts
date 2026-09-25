// Unit tests for the page-type classifier. It lives under extension/content/
// (see comment there for why) but is plain, DOM-free JS, so it imports and
// runs fine from the broker's test runner without any browser mocking.
import { describe, expect, test } from "bun:test";
import {
  classifyPageType,
  classifyPageTypeFromMetadata,
  hasConsentLexicon,
  hasConsentControl,
  hasLexicalConfirmation,
  hasStrongStructuralSignal,
  hasWeakStructuralSignal,
  isLexicalOnlyExcludable,
  isContentLayer,
  shouldExcludeLayer,
  pickContentLayer,
  detectPageKind,
  capFacts,
  capItems,
  hasNumericValue,
  firstCurrencyValue,
  looksLikeLocation,
  normalizeFieldText,
} from "../../extension/content/detect.js";

describe("classifyPageType", () => {
  test("a YouTube watch URL is a video, even without a transcript yet", () => {
    const type = classifyPageType({
      url: "https://www.youtube.com/watch?v=abc123",
      textLength: 0,
      hasTranscript: false,
      hasVideoElement: false,
    });
    expect(type).toBe("video");
  });

  test("youtu.be short links are also videos", () => {
    const type = classifyPageType({ url: "https://youtu.be/abc123" });
    expect(type).toBe("video");
  });

  test("a <video> element with a transcript is a video even off YouTube", () => {
    const type = classifyPageType({
      url: "https://example.com/lesson",
      hasVideoElement: true,
      hasTranscript: true,
      textLength: 50,
    });
    expect(type).toBe("video");
  });

  test("a <video> element without a transcript is not enough to call it a video", () => {
    const type = classifyPageType({
      url: "https://example.com/ad-page",
      hasVideoElement: true,
      hasTranscript: false,
      textLength: 50,
    });
    expect(type).toBe("page");
  });

  test("<article> markup makes it an article regardless of length", () => {
    const type = classifyPageType({
      url: "https://example.com/post",
      hasArticleMarkup: true,
      textLength: 10,
    });
    expect(type).toBe("article");
  });

  test("a dense text block above the threshold is an article without explicit markup", () => {
    const type = classifyPageType({
      url: "https://example.com/blog/post",
      textLength: 5000,
    });
    expect(type).toBe("article");
  });

  test("a bare page with little text and no markers falls back to 'page'", () => {
    const type = classifyPageType({
      url: "https://example.com/",
      title: "Example",
      textLength: 40,
      hasTranscript: false,
      hasVideoElement: false,
    });
    expect(type).toBe("page");
  });

  test("missing signals default safely to 'page'", () => {
    expect(classifyPageType()).toBe("page");
    expect(classifyPageType({})).toBe("page");
  });

  test("a YouTube URL wins over article-length text (e.g. a long description)", () => {
    const type = classifyPageType({
      url: "https://www.youtube.com/watch?v=xyz",
      textLength: 9000,
      hasArticleMarkup: true,
    });
    expect(type).toBe("video");
  });
});

// URL-only classifier — used on tab switch, where reading the page is
// forbidden (règle du geste, CLAUDE.md rule #5). Must never guess: only a
// shape genuinely legible from the URL alone resolves to a type.
describe("classifyPageTypeFromMetadata", () => {
  test("a YouTube watch URL is a video from the URL alone", () => {
    const type = classifyPageTypeFromMetadata({ url: "https://www.youtube.com/watch?v=abc123" });
    expect(type).toBe("video");
  });

  test("a YouTube home URL is not a video", () => {
    const type = classifyPageTypeFromMetadata({ url: "https://www.youtube.com/" });
    expect(type).toBe(null);
  });

  test("an arbitrary article URL stays unknown, not 'article' — no guessing from shape alone", () => {
    const type = classifyPageTypeFromMetadata({
      url: "https://example.com/blog/post",
      title: "A very long article title that reads like a real post",
    });
    expect(type).toBe(null);
  });

  test("a chrome:// URL is unknown", () => {
    const type = classifyPageTypeFromMetadata({ url: "chrome://extensions" });
    expect(type).toBe(null);
  });

  test("missing signals default safely to unknown", () => {
    expect(classifyPageTypeFromMetadata()).toBe(null);
    expect(classifyPageTypeFromMetadata({})).toBe(null);
  });
});

// --- Amendement 2026-09-25 (types de page) --------------------------------
// docs/PROTOCOL.md "Couches superposées — exclusion avant toute mesure".

describe("hasConsentLexicon / hasConsentControl", () => {
  test("recognizes the consent vocabulary case-insensitively", () => {
    expect(hasConsentLexicon("Nous utilisons des cookies et des traceurs.")).toBe(true);
    expect(hasConsentLexicon("GDPR / RGPD notice")).toBe(true);
    expect(hasConsentLexicon("Bienvenue sur notre site")).toBe(false);
  });

  test("recognizes accept/reject control labels", () => {
    expect(hasConsentControl(["Tout accepter"])).toBe(true);
    expect(hasConsentControl(["Accepter les cookies"])).toBe(true);
    expect(hasConsentControl(["Reject"])).toBe(true);
    expect(hasConsentControl(["Fermer", "En savoir plus"])).toBe(false);
    expect(hasConsentControl([])).toBe(false);
  });
});

describe("hasStrongStructuralSignal / hasWeakStructuralSignal", () => {
  test("role=dialog is strong on its own, no coverage needed", () => {
    expect(hasStrongStructuralSignal({ isDialogRole: true, position: "static", coverageRatio: 0 })).toBe(true);
  });

  test("aria-modal is strong on its own", () => {
    expect(hasStrongStructuralSignal({ isAriaModal: true })).toBe(true);
  });

  test("fixed covering >=30% of the viewport is strong (bienici's searchSideView)", () => {
    expect(hasStrongStructuralSignal({ position: "fixed", coverageRatio: 0.35 })).toBe(true);
  });

  test("fixed covering less than 30% is not strong", () => {
    expect(hasStrongStructuralSignal({ position: "fixed", coverageRatio: 0.1 })).toBe(false);
  });

  test("sticky footer docked to the bottom edge is weak, not strong", () => {
    const signals = { position: "sticky", coverageRatio: 0.05, dockedToEdge: true };
    expect(hasStrongStructuralSignal(signals)).toBe(false);
    expect(hasWeakStructuralSignal(signals)).toBe(true);
  });

  test("a strong signal is never also reported weak", () => {
    const signals = { position: "fixed", coverageRatio: 0.4, dockedToEdge: true };
    expect(hasWeakStructuralSignal(signals)).toBe(false);
  });
});

describe("isLexicalOnlyExcludable — three guards", () => {
  const consentSignals = (overrides = {}) => ({
    position: "static",
    visibleText: "Nous utilisons des cookies pour mesurer l'audience.",
    controlTexts: ["Accepter"],
    containsH1: false,
    containsMainRegion: false,
    ...overrides,
  });

  test("static consent block with a control and short text is excludable", () => {
    expect(isLexicalOnlyExcludable(consentSignals())).toBe(true);
  });

  test("guard 1: never applies to a fixed/sticky element (handled elsewhere)", () => {
    expect(isLexicalOnlyExcludable(consentSignals({ position: "fixed" }))).toBe(false);
  });

  test("guard 2: 1500 chars or more is not excludable lexically alone", () => {
    expect(isLexicalOnlyExcludable(consentSignals({ visibleText: "cookie ".repeat(300) }))).toBe(false);
  });

  test("guard 3: a container holding the page's <h1> is never excluded", () => {
    expect(isLexicalOnlyExcludable(consentSignals({ containsH1: true }))).toBe(false);
  });

  test("guard 3b: a container holding the main region is never excluded", () => {
    expect(isLexicalOnlyExcludable(consentSignals({ containsMainRegion: true }))).toBe(false);
  });

  test("an article ABOUT cookies is not erased: no accept/reject control means no lexical confirmation", () => {
    const articleAboutCookies = consentSignals({
      visibleText: "Comment fonctionnent les cookies et le RGPD : explication complète pour les développeurs.",
      controlTexts: ["Partager", "Imprimer"],
    });
    expect(hasLexicalConfirmation(articleAboutCookies)).toBe(false);
    expect(isLexicalOnlyExcludable(articleAboutCookies)).toBe(false);
  });
});

describe("isContentLayer / shouldExcludeLayer — 'une couche peut être le contenu'", () => {
  test("a Didomi-style dialog with an accept button is excluded (the banner)", () => {
    const didomi = {
      isDialogRole: true,
      isAriaModal: true,
      position: "fixed",
      coverageRatio: 0.4,
      visibleText: "En poursuivant votre navigation, vous acceptez nos cookies et traceurs. " + "x".repeat(600),
      controlTexts: ["Paramétrer", "Tout accepter"],
      containsH1: false,
      containsMainRegion: false,
    };
    expect(isContentLayer(didomi)).toBe(false);
    expect(shouldExcludeLayer(didomi)).toBe(true);
  });

  test("bienici's fixed #searchSideView (results list, no consent wording) is content, not excluded", () => {
    const searchSideView = {
      position: "fixed",
      coverageRatio: 0.4,
      visibleText: "y".repeat(4535),
      controlTexts: [],
      containsH1: false,
      containsMainRegion: false,
    };
    expect(isContentLayer(searchSideView)).toBe(true);
    expect(shouldExcludeLayer(searchSideView)).toBe(false);
  });

  test("a small fixed widget (no consent wording, under 500 chars) is excluded — structural signal alone suffices", () => {
    const chatWidget = {
      position: "fixed",
      coverageRatio: 0.32,
      visibleText: "Besoin d'aide ?",
      controlTexts: [],
      containsH1: false,
      containsMainRegion: false,
    };
    expect(isContentLayer(chatWidget)).toBe(false);
    expect(shouldExcludeLayer(chatWidget)).toBe(true);
  });

  test("a bottom cookie banner (weak signal) needs lexical confirmation to be excluded", () => {
    const noWording = {
      position: "fixed",
      coverageRatio: 0.08,
      dockedToEdge: true,
      visibleText: "Retour en haut",
      controlTexts: [],
    };
    expect(shouldExcludeLayer(noWording)).toBe(false);

    const withWording = {
      ...noWording,
      visibleText: "Ce site utilise des cookies pour améliorer votre expérience.",
      controlTexts: ["J'accepte"],
    };
    expect(shouldExcludeLayer(withWording)).toBe(true);
  });

  test("pickContentLayer keeps the last (topmost-in-stack proxy) among several content layers", () => {
    const layerA = { ref: "A", position: "fixed", coverageRatio: 0.35, visibleText: "a".repeat(600), controlTexts: [] };
    const layerB = { ref: "B", position: "fixed", coverageRatio: 0.35, visibleText: "b".repeat(600), controlTexts: [] };
    expect(pickContentLayer([layerA, layerB])?.ref).toBe("B");
  });

  test("pickContentLayer returns null when there is no content layer", () => {
    expect(pickContentLayer([{ position: "static" }])).toBe(null);
    expect(pickContentLayer([])).toBe(null);
  });
});

describe("detectPageKind", () => {
  test("a list-shaped page wins first, regardless of facts elsewhere", () => {
    expect(detectPageKind({ isListShape: true, factsCount: 10, hasChiefNumericFact: true })).toBe("list");
  });

  test("a listing needs both >=4 facts AND a chief numeric value", () => {
    expect(detectPageKind({ factsCount: 4, hasChiefNumericFact: true })).toBe("listing");
    expect(detectPageKind({ factsCount: 4, hasChiefNumericFact: false })).not.toBe("listing");
    expect(detectPageKind({ factsCount: 3, hasChiefNumericFact: true })).not.toBe("listing");
  });

  test("an encyclopedia infobox (4 facts, no numeric value) falls through to article/other, not listing", () => {
    const result = detectPageKind({ factsCount: 4, hasChiefNumericFact: false, hasArticleMarkup: true });
    expect(result).toBe("article");
  });

  test("falls back to article via existing signals, then other", () => {
    expect(detectPageKind({ hasArticleMarkup: true })).toBe("article");
    expect(detectPageKind({ articleTextLength: 5000 })).toBe("article");
    expect(detectPageKind({})).toBe("other");
  });

  test("an exception during detection is caught and degrades to other (T18: dégrader, jamais casser)", () => {
    const throwing = {
      get isListShape() {
        throw new Error("boom");
      },
    };
    expect(detectPageKind(throwing)).toBe("other");
  });
});

describe("capFacts — plafonds et ordre de chute (docs/PROTOCOL.md 'Faits')", () => {
  test("drops a fact whose label exceeds 60 chars (prose, not a fact) without truncating it", () => {
    const facts = capFacts([{ label: "x".repeat(61), value: "v" }, { label: "Prix", value: "100 €" }]);
    expect(facts).toEqual([{ label: "Prix", value: "100 €" }]);
  });

  test("drops empty label or value", () => {
    expect(capFacts([{ label: "", value: "v" }, { label: "l", value: "" }])).toEqual([]);
  });

  test("dedupes exact label+value pairs, keeping the first occurrence", () => {
    const facts = capFacts([
      { label: "Prix", value: "349 000 €" },
      { label: "Autre", value: "x" },
      { label: "Prix", value: "349 000 €" },
    ]);
    expect(facts).toEqual([
      { label: "Prix", value: "349 000 €" },
      { label: "Autre", value: "x" },
    ]);
  });

  test("truncates a value over 160 chars to 159 chars + ellipsis", () => {
    const facts = capFacts([{ label: "Description", value: "d".repeat(200) }]);
    expect(facts[0].value.length).toBe(160);
    expect(facts[0].value.endsWith("…")).toBe(true);
  });

  test("keeps only the first 40, in document order", () => {
    const raw = Array.from({ length: 45 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
    const facts = capFacts(raw);
    expect(facts.length).toBe(40);
    expect(facts[0]).toEqual({ label: "L0", value: "V0" });
    expect(facts[39]).toEqual({ label: "L39", value: "V39" });
  });

  test("two facts with the same label but different values both survive", () => {
    const facts = capFacts([
      { label: "Surface", value: "80 m²" },
      { label: "Surface", value: "12 m² (terrasse)" },
    ]);
    expect(facts.length).toBe(2);
  });
});

describe("capItems — plafonds (docs/PROTOCOL.md 'Entrées')", () => {
  test("drops an entry without a non-empty title", () => {
    expect(capItems([{ title: "" }, { title: "Maison à Nantes" }])).toEqual([{ title: "Maison à Nantes" }]);
  });

  test("truncates title/detail over their cap with an ellipsis", () => {
    const [item] = capItems([{ title: "t".repeat(200), detail: "d".repeat(250) }]);
    expect(item.title.length).toBe(160);
    expect(item.title.endsWith("…")).toBe(true);
    expect(item.detail!.length).toBe(200);
    expect(item.detail!.endsWith("…")).toBe(true);
  });

  test("omits price/location over their cap instead of truncating them", () => {
    const [item] = capItems([{ title: "x", price: "p".repeat(41), location: "l".repeat(81) }]);
    expect(item.price).toBeUndefined();
    expect(item.location).toBeUndefined();
  });

  test("keeps only the first 40, in document order", () => {
    const raw = Array.from({ length: 45 }, (_, i) => ({ title: `Item ${i}` }));
    expect(capItems(raw).length).toBe(40);
  });
});

describe("hasNumericValue / firstCurrencyValue / looksLikeLocation", () => {
  test("recognizes currency and units", () => {
    expect(hasNumericValue("349 000 €")).toBe(true);
    expect(hasNumericValue("80 m²")).toBe(true);
    expect(hasNumericValue("3 pièces")).toBe(true);
    expect(hasNumericValue("Belle maison lumineuse")).toBe(false);
  });

  // docs/PROTOCOL.md, "Corrections mesurées sur des pages réelles": "un
  // nombre seul" is never a valeur chiffrée. "21 langues" (above a Wikipedia
  // article's <h1>) is the canonical example the protocol names.
  test("a bare number is never a numeric value, even next to a plausible-looking word", () => {
    expect(hasNumericValue("21 langues")).toBe(false);
    expect(hasNumericValue("12 collections")).toBe(false);
    expect(hasNumericValue("4.7 –0 Ma")).toBe(false);
  });

  // Measured 25/09 on the Wikipedia "Coati" corpus page: a loose digit-run
  // ("\d[\d\s.,]*") let a comma+space bridge an unrelated number to a
  // trailing unit abbreviation ("p." for pièces), so a bibliography citation
  // ("2007, p. 1076") looked like a numeric value. The number must both
  // START and END with a digit, right up against the unit.
  test("a bibliography page reference ('p.') is not mistaken for the 'pièces' unit", () => {
    expect(hasNumericValue("juin 2007, p. 1076–1095")).toBe(false);
    expect(hasNumericValue("2013, p. 1–83")).toBe(false);
    // The genuine real-estate abbreviation still works: number immediately
    // followed by "p.", no unrelated digits/punctuation in between.
    expect(hasNumericValue("T3 - 65m² - 3 p.")).toBe(true);
  });

  test("reads the first currency amount as displayed, never converts", () => {
    expect(firstCurrencyValue("À partir de 349 000 € (négociable)")).toBe("349 000 €");
    expect(firstCurrencyValue("Sur demande")).toBeUndefined();
  });

  test("recognizes a postcode or a department in parentheses", () => {
    expect(looksLikeLocation("44000 Nantes")).toBe(true);
    expect(looksLikeLocation("Nantes (44)")).toBe(true);
    expect(looksLikeLocation("Quelque part en France")).toBe(false);
  });
});

describe("normalizeFieldText", () => {
  test("collapses whitespace and control chars, trims", () => {
    expect(normalizeFieldText("  Prix\n  au   m²  \t")).toBe("Prix au m²");
    expect(normalizeFieldText("a\u0000b")).toBe("a b");
  });
});
