/**
 * Deterministic secret redaction for connector logs and artifacts.
 *
 * Logs and captured artifacts must exclude authentication tokens, cookies,
 * private session URLs, environment secrets, full credential-bearing command
 * lines, and account identifiers. This module records only the minimum
 * operational evidence needed for auditability; anything that looks like a
 * credential or a private identifier is replaced with the redaction marker,
 * preferring over-redaction to leakage.
 */

export const REDACTION_MARKER = "[REDACTED]";

interface RedactionRule {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * Ordered rules. Broader credential patterns run before narrower ones so a
 * token embedded in a URL or command line is removed with its context.
 */
const RULES: readonly RedactionRule[] = [
  // Any http(s) URL — private session URLs must never appear in artifacts.
  { label: "url", pattern: /\bhttps?:\/\/[^\s"'()<>]+/gi },
  // Bearer / authorization headers and their token.
  {
    label: "authorization",
    pattern: /\b(authorization|bearer)\b\s*[:=]?\s*[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  // Anthropic-style and generic secret keys.
  { label: "sk-key", pattern: /\bsk-[A-Za-z0-9_-]{8,}/gi },
  // OAuth / session / access / refresh tokens presented as key=value.
  {
    label: "token-kv",
    pattern:
      /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|cookie|api[_-]?key|session[_-]?id|access[_-]?key))\b\s*[:=]\s*["']?[^\s"';,]+/gi,
  },
  // Set-Cookie / Cookie header values.
  { label: "cookie", pattern: /\b(set-cookie|cookie)\b\s*:\s*[^\r\n]+/gi },
  // Bare UUIDs (session ids / account identifiers).
  {
    label: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  },
  // Long opaque hex or base64 blobs that read as credential material.
  { label: "long-secret", pattern: /\b[A-Za-z0-9_-]{40,}\b/g },
];

/**
 * Redacts credential-like material from a single string. Deterministic: the
 * same input always yields the same output, with no time or randomness.
 */
export function redactSecrets(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, REDACTION_MARKER);
  }
  return output;
}

/**
 * Redacts and bounds a piece of operational evidence to a small size, so the
 * captured artifact keeps only the minimum audit trail and never accumulates
 * unrelated repository contents or oversized provider output.
 */
export function redactEvidence(input: string | undefined, maxLength = 2000): string {
  if (!input) return "";
  const redacted = redactSecrets(input);
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}…[truncated]`;
}
