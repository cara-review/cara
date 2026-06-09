// Safe markdown rendering for untrusted agent content (ADR-0004): comment answers,
// Chapter/Section AI summaries. Two independent guards:
//   1. markdown-it with `html: false` — any literal HTML in the content is escaped to
//      text, never parsed. Only markdown *syntax* is interpreted.
//   2. DOMPurify over the result — defence-in-depth: an allowlisted tag/attr subset,
//      links restricted to http(s)/mailto. No images, no raw HTML, no script.
// Links are clickable but open in a new tab with `rel="noopener noreferrer"`.

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Open links in a new tab with no opener. A DOMPurify hook (not markdown-it) sets these:
// it runs after attribute sanitization, so it survives DOMPurify's default stripping of
// `target`. Anchors reaching it already have an allowlisted http(s)/mailto href.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const ALLOWED_TAGS = [
  "p", "br", "hr", "strong", "em", "del", "code", "pre",
  "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a",
];
const ALLOWED_ATTR = ["href", "target", "rel"];
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:)/i;

/** Render untrusted agent markdown into a sanitized HTML string (ADR-0010). */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(md.render(markdown), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ["img"],
  });
}
