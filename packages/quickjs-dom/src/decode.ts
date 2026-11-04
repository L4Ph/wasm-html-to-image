/**
 * Charset detection and HTML decoding: BOM, Content-Type, <meta charset>, and fallback to UTF-8.
 */
export const sniffCharset = (bytes: Uint8Array): string | undefined => {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return /<meta\s[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(head)?.[1] ?? /charset=([A-Za-z0-9._:-]+)/i.exec(head)?.[1];
};

export const decodeHtml = (html: string | Uint8Array | undefined, contentType?: string): string => {
  if (html === undefined) return "";
  if (typeof html === "string") return html;
  const charset = (contentType ? /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] : undefined) ?? sniffCharset(html) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(html);
  } catch {
    return new TextDecoder().decode(html);
  }
};
