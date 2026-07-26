import { describe, expect, it } from "vitest";

import { validateLead } from "@/lib/lead-service";
import {
  emptyBoothContact,
  hasBoothContactErrors,
  validateBoothContact,
  type BoothContactV2,
} from "./contact";

function filled(overrides: Partial<BoothContactV2> = {}): BoothContactV2 {
  return {
    ...emptyBoothContact(),
    firstName: "Anna",
    whatsapp: "+79990001122",
    preferredLanguage: "Русский",
    consultationConsent: true,
    ...overrides,
  };
}

describe("booth contact contract", () => {
  it("requires only first name + WhatsApp + language (plus the consent)", () => {
    expect(hasBoothContactErrors(validateBoothContact(filled()))).toBe(false);
  });

  it("does not require surname, email, or country", () => {
    const contact = filled({ lastName: "", email: "", country: "" });
    expect(hasBoothContactErrors(validateBoothContact(contact))).toBe(false);
  });

  it("flags each missing required field", () => {
    const errors = validateBoothContact(emptyBoothContact());
    expect(errors.firstName).toBeTruthy();
    expect(errors.whatsapp).toBeTruthy();
    expect(errors.preferredLanguage).toBeTruthy();
    expect(errors.consultationConsent).toBeTruthy();
  });

  it("validates the phone shape and an email only when provided", () => {
    expect(validateBoothContact(filled({ whatsapp: "abc" })).whatsapp).toBeTruthy();
    expect(validateBoothContact(filled({ email: "not-an-email" })).email).toBeTruthy();
    expect(validateBoothContact(filled({ email: "a@b.co" })).email).toBeUndefined();
  });
});

describe("consents", () => {
  it("consultation consent is required", () => {
    const errors = validateBoothContact(filled({ consultationConsent: false }));
    expect(errors.consultationConsent).toBeTruthy();
  });

  it("marketing opt-in is separate and defaults to false", () => {
    const contact = emptyBoothContact();
    expect(contact.marketingOptIn).toBe(false);
    // Granting the consultation consent never grants marketing.
    const consented = filled();
    expect(consented.marketingOptIn).toBe(false);
    expect(hasBoothContactErrors(validateBoothContact(consented))).toBe(false);
    // And declining marketing never blocks the consultation.
    expect(hasBoothContactErrors(validateBoothContact(filled({ marketingOptIn: false })))).toBe(
      false,
    );
  });
});

describe("website contact rules stay untouched", () => {
  it("validateLead still requires first name, surname, email, and phone", () => {
    const errors = validateLead({ firstName: "", lastName: "", email: "", phone: "" });
    expect(errors.firstName).toBeTruthy();
    expect(errors.lastName).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });
});
