/**
 * NAV-001 question definitions — the single source of truth for both the
 * website Navigator shell and the Booth Navigator shell.
 *
 * These are the approved NAV-001 Screens 01–04 questions, options, enum keys,
 * order, and selection rules. Neither presentation shell may redefine, reorder,
 * shorten, or reinterpret them. A shell may only relayout or relabel what this
 * module exposes.
 *
 * Extracted verbatim from the original NavigatorFlow.tsx so that no question,
 * option, or key changed during the website/booth split.
 */

export const WHY_PHUKET_OPTIONS = [
  { key: "second_home", label: "A second home by the sea" },
  { key: "retirement", label: "Retirement in a warmer place" },
  { key: "investment", label: "Investment & rental yield" },
  { key: "asia_base", label: "A base in Asia" },
  { key: "slower_life", label: "A slower way of living" },
  { key: "family", label: "Somewhere for the family" },
] as const;

export const SUCCESS_OPTIONS = [
  { key: "financial_security", label: "Financial security" },
  { key: "feels_like_home", label: "A place that feels like home" },
  { key: "rental_income", label: "Steady rental income" },
  { key: "freedom", label: "Freedom to travel" },
  { key: "legacy", label: "A legacy for my family" },
  { key: "peace_privacy", label: "Peace and privacy" },
] as const;

export const BUDGET_OPTIONS = [
  { key: "lt_250k", label: "Under $250k" },
  { key: "250_500k", label: "$250k–500k" },
  { key: "500k_1m", label: "$500k–1M" },
  { key: "1m_2_5m", label: "$1M–2.5M" },
  { key: "gt_2_5m", label: "$2.5M+" },
  { key: "exploring", label: "Still exploring" },
] as const;

export const TIMELINE_OPTIONS = [
  { key: "ready_now", label: "Ready now" },
  { key: "3_6m", label: "3–6 months" },
  { key: "6_12m", label: "6–12 months" },
  { key: "exploring", label: "Just exploring" },
] as const;

export const CONCERN_OPTIONS = [
  { key: "ownership", label: "Legal & ownership rules" },
  { key: "developer_trust", label: "Trusting the developer" },
  { key: "rental_returns", label: "Rental returns" },
  { key: "resale", label: "Resale & liquidity" },
  { key: "remote_mgmt", label: "Managing it from abroad" },
  { key: "area_choice", label: "Choosing the right area" },
] as const;

export type MotivationKey = (typeof WHY_PHUKET_OPTIONS)[number]["key"];
export type GoalKey = (typeof SUCCESS_OPTIONS)[number]["key"];
export type BudgetKey = (typeof BUDGET_OPTIONS)[number]["key"];
export type TimelineKey = (typeof TIMELINE_OPTIONS)[number]["key"];
export type ConcernKey = (typeof CONCERN_OPTIONS)[number]["key"];

/**
 * Canonical screen order — NAV-001 Screens 00–08 as implemented on the website,
 * plus the shared booth tail. The keys are mode-agnostic; each shell decides how
 * (and whether) to render a given screen, never in what order the core presents
 * them.
 */
export const NAVIGATOR_SCREEN_ORDER = [
  "welcome", // 00
  "why_phuket", // 01
  "success", // 02
  "budget_timeline", // 03
  "concern", // 04
  "forever_story", // 05
  "recommendation", // 06 (website: guidance path · booth: catalogue results)
  "advisor", // 07 (website advisor invitation · booth selected-project + lead)
  "confirmation", // 08 (website confirmation · booth completion)
] as const;

export type NavigatorScreen = (typeof NAVIGATOR_SCREEN_ORDER)[number];

/** The four counted NAV-001 questions, in order. */
export const COUNTED_QUESTION_SCREENS: NavigatorScreen[] = [
  "why_phuket",
  "success",
  "budget_timeline",
  "concern",
];

/** Max selections for the multi-select NAV-001 questions (Why / Success / Concern). */
export const MAX_MULTI_SELECT = 3;

const getOptionLabel = <T extends string>(
  options: readonly { key: T; label: string }[],
  key: T | null | undefined,
) => options.find((option) => option.key === key)?.label ?? "";

const getOptionLabels = <T extends string>(
  options: readonly { key: T; label: string }[],
  keys: readonly T[],
) =>
  keys
    .map((key) => options.find((option) => option.key === key)?.label)
    .filter((label): label is string => Boolean(label));

export const motivationLabel = (key: MotivationKey | null) => getOptionLabel(WHY_PHUKET_OPTIONS, key);
export const goalLabel = (key: GoalKey | null) => getOptionLabel(SUCCESS_OPTIONS, key);
export const budgetLabel = (key: BudgetKey | null) => getOptionLabel(BUDGET_OPTIONS, key);
export const timelineLabel = (key: TimelineKey | null) => getOptionLabel(TIMELINE_OPTIONS, key);
export const concernLabel = (key: ConcernKey | null) => getOptionLabel(CONCERN_OPTIONS, key);

export const motivationLabels = (keys: readonly MotivationKey[]) =>
  getOptionLabels(WHY_PHUKET_OPTIONS, keys);
export const goalLabels = (keys: readonly GoalKey[]) => getOptionLabels(SUCCESS_OPTIONS, keys);
export const concernLabels = (keys: readonly ConcernKey[]) =>
  getOptionLabels(CONCERN_OPTIONS, keys);

/**
 * Shared NAV-001 selection rule: toggling a value on a "choose up to three"
 * question. Re-selecting removes it; a fourth selection rolls off the oldest.
 * Used identically by both shells so selection behaviour can never diverge.
 */
export function toggleMaxThree<T>(value: T, values: readonly T[]): T[] {
  if (values.includes(value)) {
    return values.filter((current) => current !== value);
  }
  return [...values, value].slice(-MAX_MULTI_SELECT);
}

/** Single-select toggle (Budget / Timeline): re-selecting clears the choice. */
export function toggleSingle<T>(value: T, current: T | null): T | null {
  return current === value ? null : value;
}

export function humanizeList(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
