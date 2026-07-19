import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitLead = vi.fn(async (_values: unknown) => undefined);

vi.mock("@/lib/lead-service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/lead-service")>();
  return {
    ...actual,
    submitLead: (...args: Parameters<typeof actual.submitLead>) => submitLead(...args),
  };
});

import { ContactForm } from "./ContactForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Guest" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.com" } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+66 81 234 5678" } });
}

describe("ContactForm demo-mode visibility (local development)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PARTNER_DEMO", "true");
    submitLead.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the owner-visible demo-mode note while demo lead mode is on", () => {
    render(<ContactForm source="home_page" />);
    expect(
      screen.getByText("Presentation mode — submissions are validated but not saved."),
    ).toBeInTheDocument();
  });

  it("completes the normal flow and marks the confirmation as demo mode", async () => {
    render(<ContactForm source="home_page" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Request Private Advisory" }));

    await waitFor(() => expect(screen.getByText("Thank you.")).toBeInTheDocument());
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "The advisory request passed local validation. No contact details were saved or sent.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Presentation mode — this request was validated but not saved."),
    ).toBeInTheDocument();
  });
});
