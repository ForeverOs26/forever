/** Normalizes a public text fact and rejects the repository's absence sentinel. */
export function publicRecordedText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text && text.toLowerCase() !== "not available" ? text : "";
}
