import { describe, expect, it } from "vitest";

import {
  WHATSAPP_UNAVAILABLE_MESSAGE,
  buildWaMeHref,
  parseWhatsappConfig,
  sessionCodeFromClientRef,
} from "./whatsapp";
import { suggestGuides, type BoothGuide } from "./guides";

describe("WhatsApp pilot config (fail-closed)", () => {
  it("rejects absent or malformed destinations — verification stays unavailable", () => {
    expect(parseWhatsappConfig(undefined)).toBeNull();
    expect(parseWhatsappConfig(null)).toBeNull();
    expect(parseWhatsappConfig("")).toBeNull();
    expect(parseWhatsappConfig("0812345678")).toBeNull(); // not E.164
    expect(parseWhatsappConfig("+0123")).toBeNull();
    expect(parseWhatsappConfig("call me")).toBeNull();
    expect(WHATSAPP_UNAVAILABLE_MESSAGE).toContain("NOT been verified");
  });

  it("accepts an operator-configured E.164 number", () => {
    expect(parseWhatsappConfig("+66812345678")).toEqual({ destinationNumber: "+66812345678" });
  });

  it("builds a wa.me link with a short non-sensitive session code", () => {
    const code = sessionCodeFromClientRef("3f9c2a17-77aa-4bc0-9e55-1234567890ab");
    expect(code).toBe("3F9C2A17");
    const href = buildWaMeHref({ destinationNumber: "+66812345678" }, code);
    expect(href).toBe(
      "https://wa.me/66812345678?text=Forever%20booth%20%E2%80%94%20session%203F9C2A17",
    );
    expect(href).not.toContain("+");
  });
});

describe("Guide suggestion", () => {
  const guides: BoothGuide[] = [
    { id: "a", displayName: "A", languages: ["English"], specializations: [], onDuty: true },
    { id: "b", displayName: "B", languages: ["Русский"], specializations: [], onDuty: true },
    { id: "c", displayName: "C", languages: ["Русский"], specializations: [], onDuty: false },
  ];

  it("prefers an on-duty Guide speaking the guest's language, with a reserve", () => {
    const suggestion = suggestGuides(guides, "Русский");
    expect(suggestion.primary?.id).toBe("b"); // off-duty C is never suggested
    expect(suggestion.reserve?.id).toBe("a");
    expect(suggestion.primaryMatchesLanguage).toBe(true);
    expect(suggestion.blockReason).toBeNull();
  });

  it("falls back to the on-duty roster when no language matches", () => {
    const suggestion = suggestGuides(guides, "Deutsch");
    expect(suggestion.primary?.id).toBe("a");
    expect(suggestion.primaryMatchesLanguage).toBe(false);
  });

  it("reports a truthful operational block instead of inventing a Guide", () => {
    expect(suggestGuides([], "English").blockReason).toBe("no_guides_configured");
    const allOff = guides.map((g) => ({ ...g, onDuty: false }));
    const suggestion = suggestGuides(allOff, "English");
    expect(suggestion.blockReason).toBe("no_guides_on_duty");
    expect(suggestion.primary).toBeNull();
    expect(suggestion.reserve).toBeNull();
  });
});
