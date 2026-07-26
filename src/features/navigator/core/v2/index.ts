/**
 * Booth Mode 2.0 shared core (V2) — versioned profile contract, the booth's
 * own state machine, the initial-directions evaluator, the light contact +
 * consent contract, manual WhatsApp verification, Guide suggestion, and the
 * funnel event vocabulary.
 *
 * The legacy core (`../`) stays untouched: the website Navigator and the
 * legacy /booth shell keep their existing shared behaviour. V2 imports from
 * the legacy core (questions, sentinel guards, yield parsing) but the legacy
 * core never imports from V2.
 */

export * from "./profile";
export * from "./directions";
export * from "./contact";
export * from "./whatsapp";
export * from "./guides";
export * from "./funnel";
export * from "./session";
export * from "./summary";
