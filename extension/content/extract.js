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

  // Picks the element that most likely holds the article body.
  //
  // Semantic containers win outright when they carry enough text. Otherwise we
  // score candidates by text density — characters of rendered text per
  // descendant element. A navigation column is long but tag-heavy; an article
  // body is long and tag-light. Raw length alone would always elect the
  // outermost wrapper, which is the whole page.
  function articleText() {
    for (const el of document.querySelectorAll("article, main, [role='main']")) {
      const text = visibleText(el);
      if (text.trim().length > 200) return text;
    }

    let best = null;
    let bestScore = 0;
    const candidates = document.body ? document.body.querySelectorAll("div, section") : [];
    for (const el of candidates) {
      if (el.closest("nav, footer, header, aside")) continue;
      const text = visibleText(el);
      const length = text.trim().length;
      if (length < 200) continue;
      const density = length / (el.getElementsByTagName("*").length + 1);
      if (density > bestScore) {
        bestScore = density;
        best = el;
      }
    }

    return best ? visibleText(best) : visibleText(document.body);
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
        url: location.href,
        title: document.title || "",
        videoId,
        text: "",
        needsTranscript: true,
      };
    }
    return {
      kind: "youtube",
      url: location.href,
      title: document.title || "",
      videoId,
      text: truncate(transcript),
    };
  }

  return {
    kind: "page",
    url: location.href,
    title: document.title || "",
    text: truncate(articleText()),
  };
})();
