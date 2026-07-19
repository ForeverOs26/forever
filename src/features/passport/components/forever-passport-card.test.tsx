import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapProjectDetail } from "@/features/project-detail/project-detail-mappers";
import type { ProjectDetailRecord } from "@/features/project-detail/project-detail-types";
import { ForeverPassportCard } from "./ForeverPassportCard";

function minimalRecord(): ProjectDetailRecord {
  return {
    id: "p-1",
    slug: "modeva",
    name: "Modeva",
    is_featured: true,
    is_active: true,
    forever_verified: false,
    developer: null,
    media: null,
    units: null,
    investment: null,
  } as unknown as ProjectDetailRecord;
}

describe("ForeverPassportCard generated-at stability", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not invent a generated marker when no factual timestamp exists", () => {
    render(<ForeverPassportCard project={mapProjectDetail(minimalRecord())} />);
    expect(screen.queryByText(/^Generated /)).toBeNull();
    expect(screen.getByText("Advisory assessment pending")).toBeInTheDocument();
  });

  it("hydrates without recovery across a controlled UTC date boundary", async () => {
    const project = mapProjectDetail(minimalRecord());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T23:59:59.900Z"));
    const html = renderToString(<ForeverPassportCard project={project} />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const recoverable = vi.fn();

    vi.setSystemTime(new Date("2026-07-20T00:00:00.100Z"));
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <ForeverPassportCard project={project} />, {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/Generated /);
    await act(async () => root?.unmount());
    container.remove();
  });
});
