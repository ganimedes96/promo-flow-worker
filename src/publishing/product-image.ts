/** Prefer the larger CDN rendition for known Mercado Livre thumbnails. */
export function largerProductImage(source: string): string {
  try {
    const url = new URL(source);
    if (url.hostname !== "http2.mlstatic.com" || url.username || url.password)
      return source;
    const match = url.pathname.match(
      /^\/D_([A-Z0-9_]+)_(\d+-ML[A-Z]\d+_\d+)-([A-Z])(?:-[^/]*)?\.(?:webp|jpe?g|png)$/i,
    );
    if (!match) return source;
    if (match[1].startsWith("NQ_NP") && ["O", "F"].includes(match[3]))
      return source;
    return "https://http2.mlstatic.com/D_NQ_NP_" + match[2] + "-O.webp";
  } catch {
    return source;
  }
}
