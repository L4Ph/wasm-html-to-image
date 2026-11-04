/**
 * Extract human-readable visible text from an HTML string for diffing.
 */

const BLOCKS_TO_STRIP = /<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const BLOCK_TAGS = /<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|aside|pre)>/gi;
const BREAK_TAGS = /<br\s*\/?>/gi;
const ALL_TAGS = /<[^>]+>/g;

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extracts normalized readable text from HTML markup.
 */
export function extractText(html: string): string {
  if (!html) return "";

  let text = html
    .replace(BLOCKS_TO_STRIP, "")
    .replace(COMMENTS, "")
    .replace(BREAK_TAGS, "\n")
    .replace(BLOCK_TAGS, "\n")
    .replace(ALL_TAGS, " ");

  text = decodeBasicEntities(text);

  // Normalize lines and whitespace
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Extracts the content of the <title> tag, if present.
 */
export function extractTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeBasicEntities(match[1].trim()) : "";
}
