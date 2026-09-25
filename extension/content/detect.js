// Pure page-type classifier. NO DOM access, NO chrome.* calls — this is what
// makes it unit-testable outside a browser (see broker/test/detect.test.ts,
// run via `cd broker && bun test`).
//
// Gathering the raw signals below *does* require the DOM (a <video> element,
// a transcript, an <article> tag…), so that part stays in extract.js, which
// runs as a content script. This module only turns those signals into a
// decision, so the decision logic can be tested without mocking a page.

const YOUTUBE_WATCH_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

// Below this length, a dense-looking block of text isn't a strong enough
// signal on its own — lots of ordinary pages (a long nav, a cookie banner)
// clear a smaller threshold. Chosen empirically, not a protocol constant.
const ARTICLE_TEXT_THRESHOLD = 1200;

function isYouTubeWatchUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    if (YOUTUBE_WATCH_HOSTS.has(parsed.hostname) && parsed.pathname === "/watch") return true;
    if (parsed.hostname === "youtu.be" && parsed.pathname.length > 1) return true;
  } catch {
    // Not a parseable absolute URL — can't be a YouTube link.
  }
  return false;
}

/**
 * Decides the page type used to pick the main button's label and payload.
 *
 * @param {object} signals
 * @param {string} [signals.url] - the tab's URL.
 * @param {string} [signals.title] - the tab's title (unused today, accepted
 *   for forward compatibility — a future heuristic may look at it).
 * @param {number} [signals.textLength] - length of the extracted body text.
 * @param {boolean} [signals.hasTranscript] - a YouTube transcript was read.
 * @param {boolean} [signals.hasVideoElement] - a <video> element is present.
 * @param {boolean} [signals.hasArticleMarkup] - <article>, [role="main"], or
 *   a `<meta property="og:type" content="article">` tag is present.
 * @returns {"video"|"article"|"page"}
 */
export function classifyPageType(signals = {}) {
  const {
    url = "",
    textLength = 0,
    hasTranscript = false,
    hasVideoElement = false,
    hasArticleMarkup = false,
  } = signals;

  if (isYouTubeWatchUrl(url)) return "video";
  if (hasVideoElement && hasTranscript) return "video";
  if (hasArticleMarkup || textLength > ARTICLE_TEXT_THRESHOLD) return "article";
  return "page";
}

/**
 * Classifies from `tab.url`/`tab.title` alone — no DOM, no page read. Used on
 * tab switch, where the règle du geste (CLAUDE.md rule 5) forbids injecting
 * the content script just because the active tab changed.
 *
 * Only signals that are genuinely legible from the URL/title alone are
 * trusted here. A YouTube watch URL is one — the rest (an article, a plain
 * page) cannot be told apart without reading the page, so this returns
 * `null` ("unknown") rather than guess. Guessing "article" from a URL shape
 * would be wrong often enough to mislabel the main button dishonestly.
 *
 * @param {object} signals
 * @param {string} [signals.url] - the tab's URL.
 * @param {string} [signals.title] - the tab's title (unused today, accepted
 *   for forward compatibility).
 * @returns {"video"|null}
 */
export function classifyPageTypeFromMetadata(signals = {}) {
  const { url = "" } = signals;
  if (isYouTubeWatchUrl(url)) return "video";
  return null;
}

// --- Amendement 2026-09-25 (types de page) --------------------------------
//
// Everything below is pure, DOM-free decision logic for `context.pageKind`
// ("list" | "listing" | "article" | "other") and for the `facts`/`items`
// payloads that go with it (docs/PROTOCOL.md, "Types de page, faits et
// entrées"). Gathering the raw per-element signals (computed style, bounding
// rects, visible text) needs the DOM, so that stays in extract.js; deciding
// what those signals mean does not, which is why it lives here, same split
// as classifyPageType() above.

// Short on purpose (docs/PROTOCOL.md: "il ne nomme aucun éditeur, aucune
// plateforme de consentement, aucune classe"). Extending this list is not an
// amendment; turning it into a per-site selector list would be.
const CONSENT_LEXICON = [
  "cookie",
  "cookies",
  "consentement",
  "vie privée",
  "confidentialité",
  "rgpd",
  "traceurs",
  "partenaires",
  "consent",
  "privacy",
  "gdpr",
];

const CONSENT_CONTROL_WORDS = [
  "tout accepter",
  "j'accepte",
  "tout refuser",
  "continuer sans accepter",
  "paramétrer",
  "accepter",
  "refuser",
  "accept",
  "agree",
  "reject",
];

const OVERLAY_COVERAGE_THRESHOLD = 0.3; // "au moins 30 % de la surface du viewport"
const EDGE_BAND_WIDTH_RATIO = 0.8; // "large d'au moins 80 % de sa largeur"
const CONTENT_LAYER_MIN_CHARS = 500; // "porte au moins 500 caractères de texte visible"
const LEXICAL_ONLY_MAX_CHARS = 1500; // "texte visible de moins de 1 500 caractères"
export const OVERLAY_FALLBACK_MIN_VISIBLE_CHARS = 200; // garde-fou

/** @param {string} text */
export function hasConsentLexicon(text) {
  const lower = (text || "").toLowerCase();
  return CONSENT_LEXICON.some((word) => lower.includes(word));
}

/** @param {string[]} controlTexts - visible text of button/a/[role=button] descendants */
export function hasConsentControl(controlTexts = []) {
  return controlTexts.some((raw) => {
    const lower = (raw || "").trim().toLowerCase();
    return CONSENT_CONTROL_WORDS.some((word) => lower === word || lower.startsWith(`${word} `));
  });
}

/**
 * @typedef {object} LayerSignals
 * @property {boolean} [isDialogRole] - role="dialog" or role="alertdialog"
 * @property {boolean} [isAriaModal] - aria-modal="true"
 * @property {boolean} [isOpenDialogElement] - an open <dialog>
 * @property {"fixed"|"sticky"|string} [position] - computed style position
 * @property {number} [coverageRatio] - rect area / viewport area, 0..1+
 * @property {boolean} [dockedToEdge] - fixed/sticky, glued to top or bottom
 *   edge, width >= 80% of the viewport
 * @property {string} [visibleText] - the layer's own visible text
 * @property {string[]} [controlTexts] - visible text of its clickable controls
 * @property {boolean} [containsH1] - the layer contains the page's <h1>
 * @property {boolean} [containsMainRegion] - the layer contains the detected
 *   main region (or is contained by it)
 */

/** @param {LayerSignals} signals */
export function isDialogLike(signals) {
  return !!(signals.isDialogRole || signals.isAriaModal || signals.isOpenDialogElement);
}

/** @param {LayerSignals} signals */
function isFixedOrSticky(signals) {
  return signals.position === "fixed" || signals.position === "sticky";
}

/** Structural signals, "suffisants seuls". @param {LayerSignals} signals */
export function hasStrongStructuralSignal(signals) {
  return isDialogLike(signals) || (isFixedOrSticky(signals) && (signals.coverageRatio || 0) >= OVERLAY_COVERAGE_THRESHOLD);
}

/** Weak structural signal — needs lexical confirmation. @param {LayerSignals} signals */
export function hasWeakStructuralSignal(signals) {
  return !hasStrongStructuralSignal(signals) && isFixedOrSticky(signals) && !!signals.dockedToEdge;
}

/** @param {LayerSignals} signals */
export function hasLexicalConfirmation(signals) {
  return hasConsentLexicon(signals.visibleText || "") && hasConsentControl(signals.controlTexts || []);
}

/** "Exclusion lexicale seule" — conteneur ni modal ni fixe, trois garde-fous.
 * @param {LayerSignals} signals */
export function isLexicalOnlyExcludable(signals) {
  if (hasStrongStructuralSignal(signals) || isFixedOrSticky(signals)) return false;
  return (
    hasLexicalConfirmation(signals) &&
    (signals.visibleText || "").length < LEXICAL_ONLY_MAX_CHARS &&
    !signals.containsH1 &&
    !signals.containsMainRegion
  );
}

/** "Une couche peut être le contenu" — a modal or a large fixed layer with
 * substantial text and NO consent confirmation is what the user is looking
 * at, not a banner. @param {LayerSignals} signals */
export function isContentLayer(signals) {
  return (
    hasStrongStructuralSignal(signals) &&
    (signals.visibleText || "").length >= CONTENT_LAYER_MIN_CHARS &&
    !hasLexicalConfirmation(signals)
  );
}

/** Final per-layer verdict, folding in every rule above.
 * @param {LayerSignals} signals
 * @returns {boolean} true if this layer must be excluded from measurement */
export function shouldExcludeLayer(signals) {
  if (hasStrongStructuralSignal(signals)) return !isContentLayer(signals);
  if (hasWeakStructuralSignal(signals)) return hasLexicalConfirmation(signals);
  return isLexicalOnlyExcludable(signals);
}

/**
 * Picks the content layer to restrict extraction to, when there is one.
 * "S'il y en a plusieurs, le plus haut dans l'empilement (le dernier dans
 * l'ordre du document, à défaut de mieux)."
 * @param {Array<LayerSignals & { ref: any }>} candidates - in document order
 * @returns {(LayerSignals & { ref: any }) | null}
 */
export function pickContentLayer(candidates = []) {
  const contentLayers = candidates.filter(isContentLayer);
  return contentLayers.length ? contentLayers[contentLayers.length - 1] : null;
}

// --- pageKind detection ----------------------------------------------------

/**
 * @typedef {object} PageKindSignals
 * @property {boolean} [isListShape] - repeated-entries condition fully
 *   evaluated (>=5 same-shape children, each linked and 20-1000 chars, at
 *   least half numeric, entries >=50% of main region text) AND no facts
 *   block (>=4 facts) found outside those entries.
 * @property {number} [factsCount] - facts found (see extract.js), computed
 *   with any candidate repeated-entries subtree already excluded.
 * @property {boolean} [hasChiefNumericFact] - a fact, or a line within 3
 *   elements of the <h1>, carries a numeric/currency/unit value.
 * @property {boolean} [hasArticleMarkup]
 * @property {number} [articleTextLength]
 */

// Same threshold as classifyPageType's ARTICLE_TEXT_THRESHOLD (this module),
// reused rather than duplicated: docs/PROTOCOL.md points at detect.js's
// existing article signals verbatim ("cf. extension/content/detect.js").
export function detectPageKind(signals = {}) {
  try {
    const {
      isListShape = false,
      factsCount = 0,
      hasChiefNumericFact = false,
      hasArticleMarkup = false,
      articleTextLength = 0,
    } = signals;

    if (isListShape) return "list";
    if (factsCount >= 4 && hasChiefNumericFact) return "listing";
    if (hasArticleMarkup || articleTextLength > ARTICLE_TEXT_THRESHOLD) return "article";
    return "other";
  } catch {
    // docs/PROTOCOL.md: "Une exception levée dans la détection … est
    // rattrapée et ramène à « other » ; elle ne fait jamais échouer
    // l'extraction."
    return "other";
  }
}

// --- Faits / entrées : bornes et nettoyage (purs, DOM-free) ----------------

const FACT_CAPS = { count: 40, label: 60, value: 160 };
const ITEM_CAPS = { count: 40, title: 160, price: 40, location: 80, detail: 200 };

/** Collapses whitespace/control chars to single spaces, trims. Mirrors the
 * reading rule shared by facts and items ("texte visible … espaces et
 * retours à la ligne réduits à un espace, caractères de contrôle retirés"). */
export function normalizeFieldText(text) {
  return (text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateField(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Applies the "Faits" caps and drop order from docs/PROTOCOL.md, in order:
 * drop label > 60 chars, drop empty label/value, dedupe exact (label,value)
 * keeping the first occurrence, truncate value > 160 chars, keep the first
 * 40 in document order.
 * @param {Array<{label: string, value: string}>} rawFacts - already
 *   normalized (normalizeFieldText) label/value pairs, in document order.
 */
export function capFacts(rawFacts = []) {
  const seen = new Set();
  const out = [];
  for (const fact of rawFacts) {
    if (!fact || typeof fact.label !== "string" || typeof fact.value !== "string") continue;
    if (fact.label.length > FACT_CAPS.label) continue; // prose, not a fact — dropped, not truncated
    if (!fact.label || !fact.value) continue;
    const key = `${fact.label}\u0000${fact.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: fact.label, value: truncateField(fact.value, FACT_CAPS.value) });
    if (out.length >= FACT_CAPS.count) break;
  }
  return out;
}

/**
 * Applies the "Entrées" caps from docs/PROTOCOL.md: a field over its cap is
 * truncated with an ellipsis, EXCEPT `price`/`location`, which are omitted
 * instead ("une « valeur » de 40 caractères n'est plus un prix"). Entries
 * without a non-empty `title` are dropped. First 40 in document order.
 * @param {Array<{title: string, price?: string, location?: string, detail?: string}>} rawItems
 */
export function capItems(rawItems = []) {
  const out = [];
  for (const item of rawItems) {
    if (!item || typeof item.title !== "string" || !item.title) continue;
    const capped = { title: truncateField(item.title, ITEM_CAPS.title) };
    if (typeof item.price === "string" && item.price) {
      if (item.price.length <= ITEM_CAPS.price) capped.price = item.price;
    }
    if (typeof item.location === "string" && item.location) {
      if (item.location.length <= ITEM_CAPS.location) capped.location = item.location;
    }
    if (typeof item.detail === "string" && item.detail) {
      capped.detail = truncateField(item.detail, ITEM_CAPS.detail);
    }
    out.push(capped);
    if (out.length >= ITEM_CAPS.count) break;
  }
  return out;
}

// A number with a currency mark or a unit, in either order — "5 214 €",
// "€5,214", "35 m²", "3 pièces". Loose on purpose: this only feeds the
// `list`/`listing` numeric-value signal and item `price`, never a
// computation (docs/PROTOCOL.md T17-adjacent: read, never deduced).
//
// The number is `\d(?:[\d\s.,]*\d)?` — starts AND ENDS with a digit, so a
// separator can never bridge an unrelated number to a unit further down the
// string. Without the trailing `\d`, "2007, p. 1076" (a bibliography
// citation) matched as "2007" + unit "p." — measured 25/09 on the Wikipedia
// "Coati" corpus page, where it made the infobox's chief-numeric-fact check
// pass and misclassified the page as `listing`. Never a bare number either
// way: "21 langues" still has no match (no currency, "langues" isn't a unit).
const NUMERIC_VALUE_RE =
  /(?:[€$£]\s?\d(?:[\d\s.,]*\d)?|\d(?:[\d\s.,]*\d)?\s?(?:€|EUR|\$|£|m²|m2|km|pièces?|p\.|ch\.))/i;

export function hasNumericValue(text) {
  return NUMERIC_VALUE_RE.test(text || "");
}

// First currency-marked amount, as displayed — feeds item.price.
const CURRENCY_VALUE_RE = /(?:[€$£]\s?\d(?:[\d\s.,]*\d)?|\d(?:[\d\s.,]*\d)?\s?(?:€|EUR|\$|£))/i;

export function firstCurrencyValue(text) {
  const match = CURRENCY_VALUE_RE.exec(text || "");
  return match ? match[0].trim() : undefined;
}

// A 5-digit postcode, or a department in parentheses ("Nantes (44)").
const LOCATION_RE = /\b\d{5}\b|\(\d{2,3}\)/;

export function looksLikeLocation(text) {
  return LOCATION_RE.test(text || "");
}
