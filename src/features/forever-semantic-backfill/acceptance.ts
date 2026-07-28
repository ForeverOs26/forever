/**
 * What the pages must look like afterwards, checked against the real policy
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Every check here calls `src/lib/public-media-policy.ts` — the same module the
 * catalogue, the project page, the Open Graph tag and the JSON-LD reader call.
 * That is the point. A backfill that satisfied a private reimplementation of
 * the rule would prove only that this file agrees with itself; the question
 * worth answering is whether the visitor stops seeing the launch party.
 *
 * Three verdicts, and `not_checkable` is a real one. There is no deployed
 * public origin today, so nothing here can fetch a page and look at it. Saying
 * "not_checkable" is honest; reporting a pass for a check that never ran is how
 * a release record becomes fiction.
 *
 * `kirara.no_eligible_cover` is expected to FAIL if the roles leave Villa
 * Kirara with a presentable cover. It is written so that it can fail. Forcing
 * the expected answer — by special-casing the slug, or by choosing the
 * expectation from the observation — would delete the only signal that the
 * classification went wrong for a project whose entire photograph set is a
 * launch party.
 */

import { heroEligibility, isSemanticRole } from "../forever-direct-publish/hero-policy";
import {
  isPublicPhotograph,
  isPubliclyPresentable,
  neverPublicUrls,
  presentableCoverUrl,
  prohibitedPhotographUrls,
  type RecordedMedia,
} from "../../lib/public-media-policy";
import { strictnessBand } from "./role-resolution";
import type { AcceptanceExpectation, ManifestProject } from "./types";

export type AcceptanceVerdict = "pass" | "fail" | "not_checkable";

export interface AcceptanceResult {
  id: string;
  verdict: AcceptanceVerdict;
  expected: string;
  observed: string;
  why: string;
}

/**
 * The checks each project's plan promises, by slug.
 *
 * Named projects get the criteria the Owner stated. Every other project gets
 * the two that are true of all of them, so no project ships with an empty
 * acceptance list — an empty list reads as "nothing to check" when it means
 * "nobody wrote one".
 */
const NAMED: Record<string, ReadonlyArray<{ id: string; checkable: boolean; expected: string }>> = {
  coralina: [
    {
      id: "coralina.single_active_exterior_cover",
      checkable: true,
      expected: "presentableCoverUrl returns exactly the active exterior cover",
    },
    {
      id: "coralina.old_event_cover_not_presentable",
      checkable: true,
      expected: "the superseded launch-event cover URL is barred from every photograph surface",
    },
    {
      id: "coralina.people_and_text_excluded",
      checkable: true,
      expected: "no URL recording event/group_photo/portrait/lifestyle/text_promo is presentable",
    },
    {
      id: "coralina.architecture_retained",
      checkable: true,
      expected: "the property photographs remain publicly presentable",
    },
    {
      id: "coralina.no_role_less_public_photograph",
      checkable: true,
      expected: "no cover or gallery row is left role-less without a written exception",
    },
  ],
  "the-title-sierra": [
    {
      id: "sierra.single_active_exterior_cover",
      checkable: true,
      expected: "presentableCoverUrl returns the active exterior render, on both of its rows",
    },
    {
      id: "sierra.holiday_moments_excluded",
      checkable: true,
      expected: "the advertising graphic is barred from every photograph surface",
    },
    {
      id: "sierra.lifestyle_excluded",
      checkable: true,
      expected: "every lifestyle URL is barred from every section, not only the gallery",
    },
    {
      id: "sierra.architecture_retained",
      checkable: true,
      expected: "the renders and exteriors remain publicly presentable",
    },
    {
      id: "sierra.no_unsafe_reader_selects_prohibited",
      checkable: false,
      expected: "no deployed public origin exists, so no reader can be observed",
    },
  ],
  "the-title-villa-kirara": [
    {
      id: "kirara.no_eligible_cover",
      checkable: true,
      expected: "presentableCoverUrl returns null — every photograph is launch-event material",
    },
    {
      id: "kirara.no_eligible_property_gallery",
      checkable: true,
      expected: "no gallery URL survives as a public photograph",
    },
    {
      id: "kirara.event_group_excluded",
      checkable: true,
      expected: "every event/group_photo URL is barred from every section",
    },
    {
      id: "kirara.plans_documents_retained",
      checkable: true,
      expected: "plan, map and document rows stay publicly presentable",
    },
    {
      id: "kirara.neutral_placeholder",
      checkable: false,
      expected: "the empty state is a rendering concern; reported by proxy, not observed here",
    },
    {
      id: "kirara.no_fabricated_exterior_role",
      checkable: true,
      expected: "no hero-eligible role was taken from a superseded package",
    },
  ],
};

export function acceptanceExpectations(slug: string): AcceptanceExpectation[] {
  const named = NAMED[slug];
  if (named) return named.map((entry) => ({ ...entry }));
  return [
    {
      id: `${slug}.no_role_less_public_photograph`,
      checkable: true,
      expected: "no cover or gallery row is left role-less without a written exception",
    },
    {
      id: `${slug}.cover_presentable_or_absent`,
      checkable: true,
      expected: "presentableCoverUrl returns the recorded cover, or null — never a barred URL",
    },
  ];
}

function verdict(pass: boolean): AcceptanceVerdict {
  return pass ? "pass" : "fail";
}

/**
 * Evaluate one project's acceptance criteria against the rows as they will be.
 *
 * `afterRows` is the projected or observed post-write state. Both callers use
 * the same function: the plan reports what it expects, and `verify` reports
 * what it found, so a divergence between them is visible rather than argued.
 */
export function evaluateProjectAcceptance(
  project: ManifestProject,
  afterRows: readonly RecordedMedia[],
  mainImageUrl: string | null,
  /**
   * URLs a written exception accounts for.
   *
   * Passed in rather than inferred from the row, because "somebody wrote down
   * why this is role-less" is a fact about the exceptions file and nothing
   * else. An earlier version used `requires_acknowledgement` as a stand-in and
   * silently passed a launch-event cover that had been left unclassified — the
   * acknowledgement was for a role that was no longer being proposed.
   */
  excusedUrls: ReadonlySet<string> = new Set(),
): AcceptanceResult[] {
  const barredPhotographs = prohibitedPhotographUrls(afterRows);
  const barredEverywhere = neverPublicUrls(afterRows);
  const cover = presentableCoverUrl(mainImageUrl, afterRows);
  const roleByUrl = new Map<string, string | null>();
  for (const url of project.urls) roleByUrl.set(url.url, url.proposed_semantic_role);

  const galleryUrls = new Set(
    afterRows.filter((row) => row.mediaType === "gallery").map((row) => row.url),
  );
  const publicPhotographs = afterRows.filter((row) => isPublicPhotograph(row));
  const publicGalleryUrls = new Set(
    publicPhotographs.filter((row) => row.mediaType === "gallery").map((row) => row.url),
  );

  const rolesWithBand = (maxBand: number) =>
    [...roleByUrl.entries()].filter(
      ([, role]) => role && isSemanticRole(role) && strictnessBand(role) <= maxBand,
    );

  const roleLessGoverned = project.urls.filter(
    (url) =>
      url.proposed_semantic_role === null &&
      url.rows.some((row) => row.media_type === "cover" || row.media_type === "gallery") &&
      !excusedUrls.has(url.url),
  );

  const results: AcceptanceResult[] = [];
  const add = (id: string, v: AcceptanceVerdict, expected: string, observed: string, why: string) =>
    results.push({ id, verdict: v, expected, observed, why });

  for (const expectation of acceptanceExpectations(project.slug)) {
    const { id, expected } = expectation;
    if (!expectation.checkable) {
      add(id, "not_checkable", expected, "not observed", expected);
      continue;
    }

    switch (true) {
      case id.endsWith(".single_active_exterior_cover"): {
        const role = cover ? roleByUrl.get(cover) : null;
        const eligible =
          cover !== null &&
          isSemanticRole(role) &&
          heroEligibility(role) !== "prohibited" &&
          !barredPhotographs.has(cover);
        add(
          id,
          verdict(eligible),
          expected,
          cover
            ? `presentableCoverUrl -> ${cover} (role ${role ?? "none"})`
            : "presentableCoverUrl -> null",
          "presentableCoverUrl resolves projects.main_image_url against the project's own rows; " +
            "a barred URL on any row makes it null.",
        );
        break;
      }
      case id.endsWith(".old_event_cover_not_presentable"): {
        const supersededCovers = project.retirement_candidates.map((entry) => entry.url);
        const allBarred = supersededCovers.every((url) => barredPhotographs.has(url));
        add(
          id,
          supersededCovers.length === 0 ? "not_checkable" : verdict(allBarred),
          expected,
          supersededCovers.length === 0
            ? "this project holds no second cover row"
            : `${supersededCovers.filter((u) => barredPhotographs.has(u)).length}/${supersededCovers.length} barred`,
          "The migration performs no DML, so the second cover row survives. Only its role " +
            "removes it, and prohibitedPhotographUrls is per URL.",
        );
        break;
      }
      case id.endsWith(".people_and_text_excluded"): {
        const shouldBeBarred = rolesWithBand(1).map(([url]) => url);
        const leaked = shouldBeBarred.filter((url) => !barredPhotographs.has(url));
        add(
          id,
          verdict(leaked.length === 0),
          expected,
          leaked.length === 0
            ? `${shouldBeBarred.length} URL(s) barred as planned`
            : `${leaked.length} still presentable`,
          "Bands 0 and 1 are exactly the roles GALLERY_ELIGIBILITY refuses.",
        );
        break;
      }
      case id.endsWith(".architecture_retained"): {
        const retained = [...publicGalleryUrls].length;
        add(
          id,
          verdict(retained >= project.project_totals.expected_public_gallery_count),
          expected,
          `${retained} public gallery URL(s); plan expected ${project.project_totals.expected_public_gallery_count}`,
          "A contract that empties a gallery has not protected it, it has deleted it.",
        );
        break;
      }
      case id.endsWith(".no_role_less_public_photograph"): {
        add(
          id,
          verdict(roleLessGoverned.length === 0),
          expected,
          `${roleLessGoverned.length} role-less cover/gallery URL(s) without an exception`,
          "This is the same condition evaluateReleaseGate blocks on at after_backfill.",
        );
        break;
      }
      case id.endsWith(".holiday_moments_excluded"): {
        // Measure the OBJECT this criterion is named after, not a role that
        // happens to be nearby.
        //
        // The first version filtered for `text_promo` and asserted that every
        // such URL was barred. But the classifier reads the seasonal graphic's
        // recorded source path and returns `lifestyle`, so the set being
        // measured never contained the advertisement at all: the criterion
        // passed while asserting nothing about the thing it names. An
        // independent review caught it. The outcome was right and the
        // instrument was not, which is the more dangerous pair of the two.
        //
        // The superseded cover is identified structurally — a cover-typed row
        // that is not the active cover — rather than by a hard-coded object
        // hash, so the check keeps measuring the right row after a future
        // re-publish moves it.
        const supersededCovers = project.urls.filter(
          (entry) =>
            entry.url !== project.expected_active_cover &&
            entry.rows.some((row) => row.media_type === "cover"),
        );
        const barred = supersededCovers.filter((entry) => barredPhotographs.has(entry.url));
        const roles = supersededCovers
          .map((entry) => entry.proposed_semantic_role ?? "NONE")
          .join(", ");
        add(
          id,
          supersededCovers.length === 0
            ? "fail"
            : verdict(barred.length === supersededCovers.length),
          expected,
          supersededCovers.length === 0
            ? "no superseded cover row found — the advertisement is unaccounted for"
            : `${supersededCovers.length} superseded cover URL(s) [${roles}], ` +
                `${barred.length} barred from every photograph surface`,
          "The graphic is still served publicly from storage; only the role removes it from the page.",
        );
        break;
      }
      case id.endsWith(".lifestyle_excluded"): {
        const lifestyle = [...roleByUrl.entries()].filter(([, role]) => role === "lifestyle");
        const allBarred = lifestyle.every(([url]) => barredEverywhere.has(url));
        add(
          id,
          lifestyle.length === 0 ? "not_checkable" : verdict(allBarred),
          expected,
          lifestyle.length === 0
            ? "no URL was classified lifestyle in this plan"
            : `${lifestyle.length} lifestyle URL(s), ${lifestyle.filter(([u]) => barredEverywhere.has(u)).length} barred everywhere`,
          "lifestyle is in NEVER_PUBLIC_ROLES, so it leaves the Documents and Location sections too.",
        );
        break;
      }
      case id.endsWith(".no_eligible_cover"): {
        add(
          id,
          verdict(cover === null),
          expected,
          cover === null ? "presentableCoverUrl -> null" : `presentableCoverUrl -> ${cover}`,
          "Stated as an expectation and allowed to fail. A cover surviving here means a " +
            "launch-event photograph was classified as something else.",
        );
        break;
      }
      case id.endsWith(".no_eligible_property_gallery"): {
        const surviving = [...publicGalleryUrls];
        add(
          id,
          verdict(surviving.length === 0),
          expected,
          `${surviving.length} of ${galleryUrls.size} gallery URL(s) still public`,
          "Villa Kirara's photograph set is 24 launch-event images and nothing else.",
        );
        break;
      }
      case id.endsWith(".event_group_excluded"): {
        const people = [...roleByUrl.entries()].filter(
          ([, role]) => role === "event" || role === "group_photo",
        );
        const allBarred = people.every(([url]) => barredEverywhere.has(url));
        add(
          id,
          people.length === 0 ? "fail" : verdict(allBarred),
          expected,
          people.length === 0
            ? "no URL was classified event or group_photo"
            : `${people.length} URL(s), ${people.filter(([u]) => barredEverywhere.has(u)).length} barred everywhere`,
          "NEVER_PUBLIC_ROLES is the floor beneath every section, not only the gallery.",
        );
        break;
      }
      case id.endsWith(".plans_documents_retained"): {
        const documentRows = afterRows.filter(
          (row) =>
            row.mediaType === "floor_plan" ||
            row.mediaType === "master_plan" ||
            row.mediaType === "unit_plan" ||
            row.mediaType === "payment_plan" ||
            row.mediaType === "document" ||
            row.mediaType === "brochure",
        );
        const lost = documentRows.filter((row) => !isPubliclyPresentable(row));
        add(
          id,
          verdict(lost.length === 0),
          expected,
          `${documentRows.length - lost.length}/${documentRows.length} still presentable`,
          "plan, map and text_promo are excluded from the GALLERY, never from their own sections. " +
            "Applying the gallery list to Documents would delete every plan Forever publishes.",
        );
        break;
      }
      case id.endsWith(".no_fabricated_exterior_role"): {
        const fabricated = project.urls.filter(
          (url) =>
            url.restrictive_override &&
            url.proposed_semantic_role !== null &&
            isSemanticRole(url.proposed_semantic_role) &&
            strictnessBand(url.proposed_semantic_role) >= 2,
        );
        add(
          id,
          verdict(fabricated.length === 0),
          expected,
          `${fabricated.length} role(s) taken from a superseded package that would reveal`,
          "The pre-fix run declared villa_exterior for two House Plan sheets. A superseded " +
            "manifest may only hide.",
        );
        break;
      }
      case id.endsWith(".cover_presentable_or_absent"): {
        const consistent = cover === null || !barredPhotographs.has(cover);
        add(
          id,
          verdict(consistent),
          expected,
          cover === null ? "presentableCoverUrl -> null" : `presentableCoverUrl -> ${cover}`,
          "A cover that survives while its URL is barred would mean the two rules disagree.",
        );
        break;
      }
      default:
        add(
          id,
          "not_checkable",
          expected,
          "no evaluator for this id",
          "unreachable by construction",
        );
    }
  }

  return results;
}
