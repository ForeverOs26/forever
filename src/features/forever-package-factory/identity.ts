/**
 * Package Factory — the Project Identity Resolver.
 *
 * Decides, from deterministic evidence only, whether this source set is an
 * UPDATE of an existing production project or a NEW one — and refuses to guess
 * when the evidence genuinely points two ways.
 *
 * The duplicates this exists to prevent are all spelling, not semantics:
 * "The Title Modeva" vs "Modeva", "Coralina Kamala" vs "The Title Coralina",
 * hyphens, punctuation, Latin/Cyrillic transliteration, short brand names. They
 * all normalize to one comparison key.
 *
 * Production is read through a small injectable reader, so every test runs
 * without a credential and the resolver itself stays pure.
 */

export interface ProductionProject {
  id: string;
  slug: string;
  name: string;
  publicStatus: string | null;
}

/**
 * The only production access identity resolution needs.
 *
 * `null` means "no production view was available" — a generate-only run that
 * deliberately reads no credential. That is different from "production has no
 * projects", and the resolver treats the two differently: with no view it must
 * not conclude that an Owner-named existing project is absent.
 */
export interface ProductionIdentityReader {
  listProjects(): Promise<readonly ProductionProject[] | null>;
}

export type IdentityOutcome = "resolved_existing" | "resolved_new" | "ambiguous_identity";

export interface IdentityCandidate {
  slug: string;
  name: string;
  reason: string;
}

export interface IdentityResolution {
  outcome: IdentityOutcome;
  /** Canonical project name for the payload. Null only when ambiguous. */
  name: string | null;
  /** Canonical slug. For an update this is the STORED slug, never a new one. */
  slug: string | null;
  projectId: string | null;
  publicStatus: string | null;
  developer: string | null;
  area: string | null;
  aliases: string[];
  operation: "create" | "update" | null;
  evidence: string[];
  candidates: IdentityCandidate[];
}

/** Cyrillic → Latin for the transliterations these project names actually use. */
const TRANSLITERATION: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function transliterate(value: string): string {
  let out = "";
  for (const character of value) {
    out += TRANSLITERATION[character] ?? character;
  }
  return out;
}

/** Words that carry no distinguishing power between Phuket projects. */
const GENERIC_TOKENS = new Set([
  "the",
  "project",
  "residence",
  "residences",
  "condo",
  "condominium",
  "villa",
  "villas",
  "phuket",
  "thailand",
  "by",
  "at",
]);

/**
 * Comparison key: lowercase, transliterated, punctuation-free, generic-word-free.
 * "The Title Modeva", "modeva", "THE  MODEVA" and "the-modeva" all collapse here.
 */
export function identityKey(value: string): string {
  return distinctiveTokens(value).join("");
}

/** The tokens of a name that actually distinguish it, in order. */
export function distinctiveTokens(value: string): string[] {
  return transliterate(value.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => !GENERIC_TOKENS.has(token));
}

/** Slug from a canonical name: the shape `projects.slug` accepts. */
export function slugify(name: string): string {
  return transliterate(name.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface IdentityInput {
  hint?: {
    name?: string;
    developer?: string;
    area?: string;
    existing_slug?: string;
    aliases?: string[];
  };
  /** Slugs named by `existing_forever_record` sources. */
  existingRecordSlugs?: readonly string[];
  /** Names observed inside official documents (e.g. a price-list heading). */
  documentNames?: readonly string[];
}

function candidateFrom(project: ProductionProject, reason: string): IdentityCandidate {
  return { slug: project.slug, name: project.name, reason };
}

/**
 * Resolve identity.
 *
 * Order matters: an explicit instruction from the Owner (an `existing_slug`
 * hint, or an `existing_forever_record` source) outranks inference, and
 * inference outranks creating anything. Two or more equally-good candidates is
 * the one outcome that stops the run.
 */
export async function resolveIdentity(
  input: IdentityInput,
  reader: ProductionIdentityReader,
): Promise<IdentityResolution> {
  const projects = await reader.listProjects();
  const evidence: string[] = [];
  const aliases = [
    ...new Set([...(input.hint?.aliases ?? [])].map((a) => a.trim()).filter(Boolean)),
  ];

  const base: IdentityResolution = {
    outcome: "ambiguous_identity",
    name: null,
    slug: null,
    projectId: null,
    publicStatus: null,
    developer: input.hint?.developer?.trim() || null,
    area: input.hint?.area?.trim() || null,
    aliases,
    operation: null,
    evidence,
    candidates: [],
  };

  const resolveExisting = (project: ProductionProject, why: string): IdentityResolution => {
    evidence.push(why);
    return {
      ...base,
      outcome: "resolved_existing",
      // The stored name and slug win: an update must never rename or re-slug a
      // live project just because the source set spelled it differently.
      name: project.name,
      slug: project.slug,
      projectId: project.id,
      publicStatus: project.publicStatus,
      operation: "update",
      candidates: [candidateFrom(project, why)],
    };
  };

  // 1. Explicit Owner instruction: an existing slug named directly.
  const explicitSlugs = [
    ...(input.hint?.existing_slug ? [input.hint.existing_slug] : []),
    ...(input.existingRecordSlugs ?? []),
  ].map((slug) => slug.trim().toLowerCase());

  const searchNames = [
    ...(input.hint?.name ? [input.hint.name] : []),
    ...aliases,
    ...(input.documentNames ?? []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  // No production view: a generate-only run reads no credential. The Owner's
  // explicit slug is still deterministic evidence, and using it is what keeps a
  // generated package pointed at the SAME project a later publish will update.
  // Direct Publish re-decides create-vs-update against the live database, so
  // trusting the stated slug here can never create a duplicate.
  if (projects === null) {
    if (explicitSlugs.length > 0) {
      evidence.push(
        `production was not consulted; using the Owner-stated existing slug "${explicitSlugs[0]}"`,
      );
      return {
        ...base,
        outcome: "resolved_existing",
        // Deliberately NO name. The stored name is the canonical one and we
        // cannot see it here, so writing the hint's spelling would silently
        // rename a live project. An update inherits the name it already has.
        name: null,
        slug: explicitSlugs[0],
        operation: "update",
      };
    }
    if (searchNames.length > 0 && slugify(searchNames[0])) {
      evidence.push("production was not consulted; treating this as a new project");
      return {
        ...base,
        outcome: "resolved_new",
        name: searchNames[0],
        slug: slugify(searchNames[0]),
        operation: "create",
      };
    }
    evidence.push("production was not consulted and there is no usable project name");
    return base;
  }

  for (const slug of explicitSlugs) {
    const project = projects.find((candidate) => candidate.slug === slug);
    if (project) return resolveExisting(project, `explicit existing slug "${slug}"`);
  }
  if (explicitSlugs.length > 0) {
    evidence.push(
      `named existing slug(s) ${explicitSlugs.join(", ")} are not present in production`,
    );
  }

  const keys = new Set(searchNames.map(identityKey).filter(Boolean));
  if (keys.size === 0) {
    evidence.push("no usable project name in the hint, aliases or documents");
    return { ...base, candidates: [] };
  }

  const exact = projects.filter(
    (project) => keys.has(identityKey(project.name)) || keys.has(identityKey(project.slug)),
  );
  const exactUnique = [...new Map(exact.map((project) => [project.id, project])).values()];
  if (exactUnique.length === 1) {
    return resolveExisting(exactUnique[0], "normalized name/slug match against production");
  }
  if (exactUnique.length > 1) {
    evidence.push("more than one production project matches this name");
    return {
      ...base,
      candidates: exactUnique.map((project) => candidateFrom(project, "normalized name match")),
    };
  }

  // 3. Containment on distinctive tokens ("Coralina" inside "The Title Coralina").
  const tokenSets = searchNames
    .map((value) => distinctiveTokens(value))
    .filter((t) => t.length > 0);
  const contained = projects.filter((project) => {
    const projectTokens = new Set([
      ...distinctiveTokens(project.name),
      ...distinctiveTokens(project.slug),
    ]);
    return tokenSets.some(
      (tokens) =>
        tokens.every((token) => projectTokens.has(token)) ||
        [...projectTokens].every((token) => tokens.includes(token)),
    );
  });
  const containedUnique = [...new Map(contained.map((project) => [project.id, project])).values()];
  if (containedUnique.length === 1) {
    return resolveExisting(containedUnique[0], "distinctive-token match against production");
  }
  if (containedUnique.length > 1) {
    evidence.push("more than one production project shares this project's distinctive tokens");
    return {
      ...base,
      candidates: containedUnique.map((project) =>
        candidateFrom(project, "distinctive-token match"),
      ),
    };
  }

  // 4. Nothing matches: this is a new project, provided we have a real name.
  const canonicalName = searchNames[0];
  const slug = slugify(canonicalName);
  if (!slug) {
    evidence.push(`"${canonicalName}" does not reduce to a usable slug`);
    return { ...base, candidates: [] };
  }
  evidence.push("no production project matches; this is a new project");
  return {
    ...base,
    outcome: "resolved_new",
    name: canonicalName,
    slug,
    operation: "create",
  };
}
