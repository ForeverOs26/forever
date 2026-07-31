/** A syntactically valid public browser URL: absolute HTTP(S) or single-slash local. */
export function publicBrowserUrl(value: string | null | undefined): string {
  const url = (value ?? "").trim();
  if (!url) return "";
  if (/^\/(?!\/)/.test(url)) return url;

  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? url
      : "";
  } catch {
    return "";
  }
}

/** A syntactically valid absolute external HTTP(S) URL. */
export function publicHttpUrl(value: string | null | undefined): string {
  const url = publicBrowserUrl(value);
  return /^https?:\/\//i.test(url) ? url : "";
}
