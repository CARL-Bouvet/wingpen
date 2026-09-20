// Wingpen content script — injected on demand via chrome.scripting.executeScript.
//
// Extracts plain, sanitized TEXT from the page. Never returns HTML, never
// touches innerHTML: page content is data for the model, never an
// instruction (see CLAUDE.md, security rule 3). The completion value of this
// IIFE becomes the injection result read by the caller (panel.js).
//
// Why innerText and not textContent: textContent returns the raw source text,
// including hidden elements, and inserts nothing between block elements. On
// pages whose HTML is generated without whitespace between tags — most React
// and JSX sites, Medium among them — "<h1>Title</h1><p>Body</p>" comes out as
// "TitleBody". innerText returns the text as rendered: line breaks at block
// boundaries, hidden elements skipped. It costs a layout pass, which is fine
// for a one-shot extraction on a page the user is looking at.

(() => {
  const MAX_CHARS = 40000;

  function truncate(text) {
    const clean = (text || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[ \t]+|[ \t]+$/gm, "")
      .trim();
    return clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) : clean;
  }

  function visibleText(el) {
    if (!el) return "";
    // innerText is undefined on some non-HTMLElement nodes; fall back rather
    // than throwing.
    return typeof el.innerText === "string" ? el.innerText : el.textContent || "";
  }

  // A [contenteditable] subtree (a draft email, an unsent comment box) is
  // "visible" as far as innerText is concerned, so it rides along with
  // whatever container contains it. It was never intentionally shared by the
  // user's click — exclude it before the text is sent anywhere. We can't just
  // skip the container itself (the draft is usually nested a few levels
  // inside an otherwise legitimate article/main), so instead strip out each
  // editable descendant's own rendered text from the container's text.
  function textExcludingEditable(el) {
    const text = visibleText(el);
    if (!el || typeof el.querySelectorAll !== "function") return text;
    const editableDescendants = el.querySelectorAll("[contenteditable]");
    if (!editableDescendants.length) return text;
    // Longest fragment first: an editable region nested inside another
    // editable region must not be subtracted twice from an already-shortened
    // string.
    const fragments = Array.from(editableDescendants)
      .map((node) => visibleText(node))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return fragments.reduce((acc, fragment) => acc.split(fragment).join(""), text);
  }

  // Picks the element that most likely holds the article body.
  //
  // Semantic containers win outright when they carry enough text. Otherwise we
  // score candidates by text density — characters of rendered text per
  // descendant element. A navigation column is long but tag-heavy; an article
  // body is long and tag-light. Raw length alone would always elect the
  // outermost wrapper, which is the whole page.
  function articleText() {
    for (const el of document.querySelectorAll("article, main, [role='main']")) {
      const text = textExcludingEditable(el);
      if (text.trim().length > 200) return text;
    }

    let best = null;
    let bestScore = 0;
    const candidates = document.body ? document.body.querySelectorAll("div, section") : [];
    for (const el of candidates) {
      // A container that IS an editable region (not just one that contains
      // one) is skipped outright, same as nav/footer/header/aside.
      if (el.closest("nav, footer, header, aside, [contenteditable]")) continue;
      const text = textExcludingEditable(el);
      const length = text.trim().length;
      if (length < 200) continue;
      const density = length / (el.getElementsByTagName("*").length + 1);
      if (density > bestScore) {
        bestScore = density;
        best = el;
      }
    }

    return best ? textExcludingEditable(best) : textExcludingEditable(document.body);
  }

  function getYouTubeVideoId() {
    try {
      const url = new URL(location.href);
      if (url.hostname.includes("youtube.com") && url.pathname === "/watch") {
        return url.searchParams.get("v") || undefined;
      }
      if (url.hostname === "youtu.be") {
        return url.pathname.slice(1) || undefined;
      }
    } catch {
      // Not a URL we understand; treat the page as an ordinary one.
    }
    return undefined;
  }

  // Reads the transcript only if the user has already opened the transcript
  // panel. We never click it open ourselves, and we never call YouTube's
  // internal endpoints: automated access is forbidden by YouTube's terms
  // (section 5.B), and fabricating the gesture would break the rule that
  // Wingpen accompanies a gesture and never manufactures one
  // (DECISIONS.md, "la règle du geste").
  function getYouTubeTranscript() {
    // YouTube migrated its transcript to the "view model" architecture; the
    // older custom element is kept as a fallback for slower rollouts.
    // Measured 2026-09-18: transcript-segment-view-model yields 133 segments on
    // a 17-minute video, ytd-transcript-segment-renderer yields none.
    const segments = document.querySelectorAll(
      "transcript-segment-view-model, ytd-transcript-segment-renderer",
    );
    if (!segments.length) return undefined;

    const lines = [];
    let previous = null;
    for (const segment of segments) {
      // A segment renders as three lines: the timestamp, a screen-reader
      // duplicate of it ("7 secondes"), then the spoken text. Keep the
      // timestamp — it lets the model cite a moment — and drop the duplicate.
      const parts = visibleText(segment)
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);

      const stamp = parts.find((part) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(part));
      const spoken = parts
        .filter(
          (part) =>
            part !== stamp &&
            !/^\d+\s+(seconde|secondes|minute|minutes|heure|heures|second|seconds|minute|minutes|hour|hours)\b/i.test(
              part,
            ),
        )
        .join(" ")
        .trim();

      if (!spoken || spoken === previous) continue;
      previous = spoken;
      lines.push(stamp ? `${stamp} ${spoken}` : spoken);
    }

    return lines.length ? lines.join("\n") : undefined;
  }

  // The query string and hash can carry session tokens (?token=…,
  // #access_token=…). The model, the broker, and its logs never need them —
  // only origin + path identify "which page", so that's all that leaves the
  // page. Falls back to the raw href if location is somehow not a URL (should
  // not happen in a browser tab, but truncate() elsewhere shows the same
  // defensive style).
  function safePageUrl() {
    try {
      return location.origin + location.pathname;
    } catch {
      return location.href;
    }
  }

  // Extra signals for the page-type classifier (extension/content/detect.js).
  // Gathering them needs the DOM, so it happens here; deciding what they mean
  // does not, which is why that logic lives in a separate, DOM-free module.
  function hasVideoElement() {
    return !!document.querySelector("video");
  }

  function hasArticleMarkup() {
    if (document.querySelector("article, [role='main']")) return true;
    const ogType = document.querySelector('meta[property="og:type"]');
    return !!ogType && ogType.getAttribute("content") === "article";
  }

  const videoId = getYouTubeVideoId();

  if (videoId) {
    const transcript = getYouTubeTranscript();
    // Without a transcript, the densest block of a YouTube page is the
    // description plus the recommendations plus the comments. Summarising that
    // yields a plausible, wrong answer — worse than none. Say so instead, and
    // let the caller tell the user which gesture is missing.
    if (!transcript) {
      return {
        kind: "youtube",
        url: safePageUrl(),
        title: document.title || "",
        videoId,
        text: "",
        needsTranscript: true,
        hasVideoElement: hasVideoElement(),
        hasArticleMarkup: false,
      };
    }
    return {
      kind: "youtube",
      url: safePageUrl(),
      title: document.title || "",
      videoId,
      text: truncate(transcript),
      hasVideoElement: hasVideoElement(),
      hasArticleMarkup: false,
    };
  }

  return {
    kind: "page",
    url: safePageUrl(),
    title: document.title || "",
    text: truncate(articleText()),
    hasVideoElement: hasVideoElement(),
    hasArticleMarkup: hasArticleMarkup(),
  };
})();
