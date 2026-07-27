/**
 * Package Factory — source precedence and availability reconciliation.
 *
 * Two official documents from the same developer routinely disagree, and the
 * disagreement is almost always a date rather than a contradiction. The order
 * below is deterministic and total, so the same inputs always pick the same
 * winner:
 *
 *   1. the explicit effective date INSIDE the source (what the document says);
 *   2. the official version / revision label;
 *   3. the publication date (when the source distributed it);
 *   4. the SHA-256 fingerprint — a final tie-break that is stable but arbitrary,
 *      used only so two genuinely indistinguishable documents still order
 *      deterministically.
 *
 * Availability rules on top of that ordering:
 *   - a newer SOLD announcement overrides an older price list;
 *   - a newer price or availability document may re-list a SOLD unit as
 *     available (the developer is entitled to change its mind);
 *   - a byte-identical repost is not a new version and changes nothing;
 *   - a unit simply ABSENT from a price list is not thereby SOLD.
 */

import type { ResolvedArtifact } from "./types";

export interface DatedSource {
  ref: string;
  sha256: string;
  effectiveDate: string | null;
  revision: string | null;
  publishedAt: string | null;
}

/** Numeric ordering value of a revision label ("V2" → 2). */
export function revisionRank(revision: string | null): number {
  if (!revision) return -1;
  const match = /(\d+)/.exec(revision);
  return match ? Number(match[1]) : -1;
}

/**
 * Compare two sources; positive means `left` is NEWER (wins).
 *
 * Nulls always lose to a stated value at the same level, so a document that
 * states its own effective date outranks one that does not — which is exactly
 * the developer convention these sources follow.
 */
export function compareSourceRecency(left: DatedSource, right: DatedSource): number {
  const byEffective = (left.effectiveDate ?? "").localeCompare(right.effectiveDate ?? "");
  if (byEffective !== 0) return byEffective;

  // A revision label orders documents WITHIN one series. It says nothing about
  // a source that carries no revision at all — a SOLD note is not "V0" of the
  // price list. Comparing them would let a labelled document outrank a genuinely
  // newer unlabelled one purely because it has a label, which is how a same-day
  // "SOLD D620" lost to the price list it was correcting.
  if (left.revision && right.revision) {
    const byRevision = revisionRank(left.revision) - revisionRank(right.revision);
    if (byRevision !== 0) return byRevision;
  }

  const byPublished = (left.publishedAt ?? "").localeCompare(right.publishedAt ?? "");
  if (byPublished !== 0) return byPublished;

  // Deterministic, content-derived final tie-break.
  return left.sha256.localeCompare(right.sha256);
}

/** The most recent source by the precedence order, or null for an empty list. */
export function selectCurrentSource<T extends DatedSource>(sources: readonly T[]): T | null {
  let winner: T | null = null;
  for (const source of sources) {
    if (!winner || compareSourceRecency(source, winner) > 0) winner = source;
  }
  return winner;
}

/** Sources ordered oldest → newest. */
export function orderByRecency<T extends DatedSource>(sources: readonly T[]): T[] {
  return [...sources].sort(compareSourceRecency);
}

export function datedSourceOf(artifact: ResolvedArtifact): DatedSource {
  return {
    ref: artifact.ref,
    sha256: artifact.sha256,
    effectiveDate: artifact.effectiveDate,
    revision: artifact.revision,
    publishedAt: artifact.publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Availability reconciliation
// ---------------------------------------------------------------------------

/** A dated statement about one unit's availability, from any source kind. */
export interface AvailabilityStatement {
  unitCode: string;
  status: string;
  /** ISO date the statement takes effect. */
  effectiveDate: string | null;
  /** Public-safe reference to the source that carried it. */
  sourceRef: string;
  sha256: string;
  revision?: string | null;
  publishedAt?: string | null;
}

export interface ReconciledAvailability {
  unitCode: string;
  status: string;
  sourceRef: string;
  effectiveDate: string | null;
  /** Statements this decision overrode, oldest first. */
  supersededBy: string[];
}

/**
 * Resolve a statement's unit code against the project's known unit inventory.
 *
 * Developers do not use one spelling for a unit. A price schedule prints the
 * full code (`MBD620` = project prefix MB + tower D + floor 6 + index 20) while
 * a short SOLD message names the same home as `D620`. Matching those two by
 * string equality fails in the most damaging possible way: the SOLD statement
 * becomes a unit of its own, and the real unit — the one carrying the price —
 * stays advertised as available.
 *
 * The rule is deliberately narrow. A non-exact code resolves ONLY when exactly
 * one known unit code ends with it and the part stripped off is purely letters
 * (a project prefix). Two candidates, zero candidates, or a numeric remainder
 * all leave the code unresolved, because a wrong match here would move a real
 * sale onto the wrong home.
 */
export function resolveUnitCodeAlias(
  code: string,
  knownUnitCodes: ReadonlySet<string>,
): string | null {
  const candidate = code.trim().toUpperCase();
  if (!candidate) return null;
  if (knownUnitCodes.has(candidate)) return candidate;
  // Too short to be distinctive; refuse rather than guess.
  if (candidate.length < 3) return null;

  const matches: string[] = [];
  for (const known of knownUnitCodes) {
    if (known === candidate || !known.endsWith(candidate)) continue;
    const prefix = known.slice(0, known.length - candidate.length);
    if (!/^[A-Z]+$/.test(prefix)) continue;
    matches.push(known);
  }
  return matches.length === 1 ? matches[0] : null;
}

export interface StatementResolution {
  /** Statements whose unit code matched exactly one known unit. */
  resolved: AvailabilityStatement[];
  /** Statements naming a unit the inventory does not contain. */
  unresolved: AvailabilityStatement[];
}

/**
 * Canonicalize every statement's unit code against the known inventory.
 *
 * An unresolved statement is NOT turned into a unit of its own. A short message
 * carries no size, floor, building or price, so inventing a row from it would
 * publish a unit Forever has no evidence for. It is reported instead.
 */
export function resolveStatementUnitCodes(
  statements: readonly AvailabilityStatement[],
  knownUnitCodes: ReadonlySet<string>,
): StatementResolution {
  const resolved: AvailabilityStatement[] = [];
  const unresolved: AvailabilityStatement[] = [];
  for (const statement of statements) {
    const canonical = resolveUnitCodeAlias(statement.unitCode, knownUnitCodes);
    if (canonical) resolved.push({ ...statement, unitCode: canonical });
    else unresolved.push(statement);
  }
  return { resolved, unresolved };
}

export function normalizeStatus(status: string): string {
  const value = status.trim().toLowerCase();
  if (["available", "avail", "for sale"].includes(value)) return "available";
  if (["sold", "sold out"].includes(value)) return "sold";
  if (["reserved", "booked", "hold", "holding"].includes(value)) return "reserved";
  return value;
}

/**
 * Reconcile every statement about every unit down to one current status each.
 *
 * A statement never "wins by being a SOLD": it wins by being NEWER. That is
 * what lets a newer availability document legitimately re-list a unit that an
 * older message announced as sold, while still letting yesterday's SOLD message
 * override last week's price list.
 */
export function reconcileAvailability(
  statements: readonly AvailabilityStatement[],
): ReconciledAvailability[] {
  const byUnit = new Map<string, AvailabilityStatement[]>();
  for (const statement of statements) {
    const key = statement.unitCode.trim().toUpperCase();
    if (!key) continue;
    const bucket = byUnit.get(key);
    if (bucket) bucket.push(statement);
    else byUnit.set(key, [statement]);
  }

  const results: ReconciledAvailability[] = [];
  for (const [unitCode, bucket] of [...byUnit.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Byte-identical reposts of the same document collapse first, so a repost
    // can never masquerade as a second, newer statement.
    const seen = new Set<string>();
    const distinct = bucket.filter((statement) => {
      const key = `${statement.sha256}:${normalizeStatus(statement.status)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const ordered = distinct
      .map((statement) => ({
        statement,
        dated: {
          ref: statement.sourceRef,
          sha256: statement.sha256,
          effectiveDate: statement.effectiveDate,
          revision: statement.revision ?? null,
          publishedAt: statement.publishedAt ?? null,
        } satisfies DatedSource,
      }))
      .sort((left, right) => compareSourceRecency(left.dated, right.dated));

    const winner = ordered[ordered.length - 1];
    const overridden = ordered
      .slice(0, -1)
      .filter(
        (entry) =>
          normalizeStatus(entry.statement.status) !== normalizeStatus(winner.statement.status),
      )
      .map((entry) => entry.statement.sourceRef);

    results.push({
      unitCode,
      status: normalizeStatus(winner.statement.status),
      sourceRef: winner.statement.sourceRef,
      effectiveDate: winner.statement.effectiveDate,
      supersededBy: overridden,
    });
  }
  return results;
}
