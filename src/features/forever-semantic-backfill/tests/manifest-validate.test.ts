import { describe, expect, it } from "vitest";

import { validateBackfillManifest } from "../manifest-validate";
import { buildBackfillManifest } from "../plan";
import type { BackfillManifest } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  POLICY,
  URLS,
  snapshot,
  standardEvidence,
} from "./fixtures";

function valid(): BackfillManifest {
  return buildBackfillManifest({
    snapshot: snapshot(),
    evidenceBySlug: standardEvidence(),
    policy: POLICY,
    generatorCommit: GENERATOR_COMMIT,
    generatedAt: GENERATED_AT,
    acknowledgements: [
      { projectSlug: "coralina", url: URLS.coralinaOldEventCover, acknowledgement: "confirmed" },
      { projectSlug: "the-title-sierra", url: URLS.sierraHoliday, acknowledgement: "confirmed" },
      { projectSlug: "the-title-sierra", url: URLS.sierraLifestyle, acknowledgement: "confirmed" },
    ],
  });
}

function codes(manifest: BackfillManifest): string[] {
  return validateBackfillManifest(manifest).map((issue) => issue.code);
}

function mutate(change: (manifest: BackfillManifest) => void): BackfillManifest {
  const manifest = JSON.parse(JSON.stringify(valid())) as BackfillManifest;
  change(manifest);
  return manifest;
}

describe("a manifest the planner produced", () => {
  it("validates clean", () => {
    expect(validateBackfillManifest(valid())).toEqual([]);
  });
});

describe("V1 — the vocabulary and the unknown trap", () => {
  it("rejects a role the database CHECK would refuse mid-run", () => {
    expect(
      codes(
        mutate((m) => {
          m.projects[0].urls[0].proposed_semantic_role = "beautiful_exterior" as never;
        }),
      ),
    ).toContain("role_out_of_vocabulary");
  });

  it("rejects unknown even though it is in the vocabulary and is gallery-eligible", () => {
    expect(
      codes(
        mutate((m) => {
          m.projects[0].urls[0].proposed_semantic_role = "unknown";
        }),
      ),
    ).toContain("role_is_unknown");
  });
});

describe("V2 — fan-out completeness", () => {
  it("rejects a planned URL with no production rows", () => {
    const issues = codes(
      mutate((m) => {
        m.projects[0].urls[0].rows = [];
      }),
    );
    expect(issues).toContain("fanout_incomplete");
  });

  it("rejects totals that disagree with the fan-out", () => {
    expect(
      codes(
        mutate((m) => {
          m.projects[0].project_totals.rows_to_update += 1;
        }),
      ),
    ).toContain("fanout_incomplete");
  });
});

describe("V3 — one role per URL", () => {
  it("rejects two entries for one URL carrying different roles", () => {
    const issues = codes(
      mutate((m) => {
        const sierra = m.projects.find((p) => p.slug === "the-title-sierra")!;
        const hero = sierra.urls.find((entry) => entry.url === URLS.sierraHero)!;
        sierra.urls.push({ ...hero, proposed_semantic_role: "text_promo" });
        sierra.project_totals.rows_to_update += hero.rows.length;
        sierra.project_totals.urls += 1;
      }),
    );
    expect(issues).toContain("per_url_role_conflict");
    expect(issues).toContain("duplicate_url_entry");
  });
});

describe("V4 — an exception may never hide a classifiable defect", () => {
  it("rejects an exception for a URL some evidence calls event", () => {
    const issues = codes(
      mutate((m) => {
        const coralina = m.projects.find((p) => p.slug === "coralina")!;
        const entry = coralina.urls.find((url) => url.url === URLS.coralinaOldEventCover)!;
        // Pretend the planner had been talked into excusing it instead.
        entry.proposed_semantic_role = null;
        entry.requires_acknowledgement = false;
        entry.acknowledgement = null;
        entry.refused_evidence = [
          {
            tier: "superseded_package_manifest",
            role: "event",
            input: "media[].semantic_role",
            input_value: "event",
            why: "operator preference",
          },
        ];
        coralina.project_totals.rows_to_update -= entry.rows.length;
        m.exceptions.push({
          projectSlug: "coralina",
          url: URLS.coralinaOldEventCover,
          reason: "we would rather not classify this one",
          projectId: coralina.project_id,
          mediaType: "cover",
          objectIdentifier: entry.object_path ?? "",
          reasonCode: "classification_unavailable_no_evidence",
          publicPresentationDecision: "shown_as_before",
          ownerActionRequired: "none",
          reEvaluateWhen: "never",
          expiresAfterRelease: "FOREVER-SEMANTIC-MEDIA-BACKFILL-001",
          manifestIdempotencyKey: m.digests.idempotency_key,
        });
      }),
    );
    expect(issues).toContain("exception_hides_prohibited");
  });
});

describe("V5 — the exceptions the gate can actually consume", () => {
  it("rejects a blank reason, which excuses nothing while appearing to", () => {
    expect(
      codes(
        mutate((m) => {
          m.exceptions[0].reason = "   ";
        }),
      ),
    ).toContain("exception_missing_reason");
  });

  it("rejects an absent reason, which makes the gate throw with no diagnostic", () => {
    expect(
      codes(
        mutate((m) => {
          delete (m.exceptions[0] as Partial<BackfillManifest["exceptions"][number]>).reason;
        }),
      ),
    ).toContain("exception_missing_reason");
  });

  it("rejects an exception naming a project the manifest does not describe", () => {
    expect(
      codes(
        mutate((m) => {
          m.exceptions[0].projectSlug = "some-other-project";
        }),
      ),
    ).toContain("exception_project_mismatch");
  });
});

describe("V6 — retirement stays out of scope", () => {
  it("rejects a plan that would retire a cover", () => {
    // Retiring a role-less cover moves it out of GOVERNED_MEDIA_TYPES, making
    // the gate cleaner by shrinking its denominator.
    expect(
      codes(
        mutate((m) => {
          m.projects[0].expected_retired_covers = [URLS.coralinaOldEventCover];
        }),
      ),
    ).toContain("retirement_out_of_scope");
  });
});

describe("V7 — the write scope is the claim the invariants enforce", () => {
  it("rejects a widened scope", () => {
    expect(
      codes(
        mutate((m) => {
          m.write_scope.columns_written.push("public.projects.main_image_url");
        }),
      ),
    ).toContain("write_scope_widened");
  });
});

describe("V8/V9 — the plan must describe the target it will be applied to", () => {
  it("rejects a project id that is not a UUID", () => {
    expect(
      codes(
        mutate((m) => {
          m.projects[0].project_id = "coralina";
        }),
      ),
    ).toContain("unknown_project");
  });

  it("rejects overwriting a role production already records", () => {
    expect(
      codes(
        mutate((m) => {
          m.projects[0].urls[0].rows[0].current_semantic_role = "amenity";
        }),
      ),
    ).toContain("current_role_would_be_overwritten");
  });
});

describe("target refusal is stated in the file", () => {
  it("rejects a manifest that does not record what it refuses", () => {
    expect(
      codes(
        mutate((m) => {
          m.target.refuses_project_refs = [];
        }),
      ),
    ).toContain("target_refusal_missing");
  });

  it("rejects a manifest targeting the refused ref", () => {
    expect(
      codes(
        mutate((m) => {
          m.target.project_ref = "garjibjhlzeljsnpzisu";
        }),
      ),
    ).toContain("target_is_refused_ref");
  });
});

describe("acknowledgement", () => {
  it("rejects a superseded role nobody signed off", () => {
    expect(
      codes(
        mutate((m) => {
          for (const project of m.projects) {
            for (const url of project.urls) url.acknowledgement = null;
          }
        }),
      ),
    ).toContain("acknowledgement_missing");
  });
});

describe("schema", () => {
  it("rejects a manifest written by a different version", () => {
    expect(
      codes(
        mutate((m) => {
          m.schema_version = "forever-semantic-media-backfill.v2";
        }),
      ),
    ).toContain("schema_version_unknown");
  });
});
