import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  it("shows the owner-visible demo-mode note while demo lead mode is on", () => {
    render(<ContactForm source="home_page" />);
    // Vitest runs with DEV=true, so the local demo-lead mode is on by default.
    expect(
      screen.getByText("Local demo mode — submissions are validated but not saved."),
    ).toBeInTheDocument();
  });

  it("completes the normal flow and marks the confirmation as demo mode", async () => {
    render(<ContactForm source="home_page" />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Request Private Advisory" }));

    await waitFor(() => expect(screen.getByText("Thank you.")).toBeInTheDocument());
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Local demo mode — this request was validated but not saved."),
    ).toBeInTheDocument();
  });
});
