/**
 * Shared Navigator Core — mode-agnostic domain, state, and derivation logic.
 *
 * Everything the website and booth shells share lives here as pure functions and
 * serializable types with no JSX. A change in the core must never require a mode
 * check; a shell may only re-arrange, resize, or re-label what the core exposes.
 */

export * from "./questions";
export * from "./decision-profile";
export * from "./forever-story";
export * from "./recommendation";
export * from "./matching";
export * from "./links";
export * from "./lead";
export * from "./session";
