// Wingpen content script — injected on demand via chrome.scripting.executeScript.
//
// Extracts plain, sanitized TEXT from the page. Never returns HTML, never
// touches innerHTML: page content is data for the model, never an
// instruction (see CLAUDE.md, security rule 3). The completion value of this
// IIFE becomes the injection result read by the caller (panel.js).

(() => {
  const MAX_CHARS = 40000;

  function truncate(text) {
    const clean = (text || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    return clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) : clean;
  }

  function densestBlock() {
    const candidates = document.querySelectorAll("article, main, [role='main']");
    for (const el of candidates) {
      const text = el.textContent || "";
      if (text.trim().length > 200) return text;
    }

    // Fallback heuristic: the element with the most direct text among common
    // containers, ignoring script/style/nav/footer/header/aside.
    const blocked = new Set(["SCRIPT", "STYLE", "NAV", "FOOTER", "HEADER", "ASIDE", "NOSCRIPT"]);
    let best = null;
    let bestLength = 0;
    const all = document.body ? document.body.querySelectorAll("div, section") : [];
    for (const el of all) {
      if (blocked.has(el.tagName)) continue;
      if (el.closest("nav, footer, header, aside")) continue;
      const text = el.textContent || "";
      if (text.length > bestLength) {
        bestLength = text.length;
        best = el;
      }
    }
    return best ? best.textContent : document.body ? document.body.textContent : "";
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
      // ignore
    }
    return undefined;
  }

  function getYouTubeTranscript() {
    // Best-effort: only works if the user already opened the transcript
    // panel, since YouTube loads it lazily and we do not simulate clicks.
    const segments = document.querySelectorAll(
      "ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer .segment-text"
    );
    if (!segments.length) return undefined;
    const lines = [];
    for (const seg of segments) {
      const text = seg.textContent || "";
      if (text.trim()) lines.push(text.trim());
    }
    return lines.length ? lines.join("\n") : undefined;
  }

  const videoId = getYouTubeVideoId();
  const kind = videoId ? "youtube" : "page";

  let text;
  if (kind === "youtube") {
    text = getYouTubeTranscript() || densestBlock();
  } else {
    text = densestBlock();
  }

  const result = {
    kind,
    url: location.href,
    title: document.title || "",
    text: truncate(text),
  };
  if (videoId) result.videoId = videoId;

  return result;
})();
