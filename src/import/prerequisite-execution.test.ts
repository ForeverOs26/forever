import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "docs/legacy-controlled-sql/20260718100000_coralina_prerequisite_execution_boundary.sql",
  "utf8",
);

type Row = { slug: string | null; name: string };
type State = { developers: Row[]; locations: Row[]; coralinaProjects: number; consumed: boolean; receipts: number };
const developer = { slug: "rhom-bho-property-public-company-limited", name: "Rhom Bho Property Public Company Limited" };
const location = { slug: "kamala", name: "Kamala" };

function execute(initial: State, failAfterDeveloper = false): State {
  const working = structuredClone(initial);
  if (working.consumed || working.receipts) throw new Error("single_use");
  if (working.coralinaProjects) throw new Error("project_collision");
  if (working.developers.filter((row) => row.slug === developer.slug).length > 1) throw new Error("developer_ambiguous");
  if (working.locations.filter((row) => row.slug === location.slug).length > 1) throw new Error("location_ambiguous");
  const sameDeveloper = working.developers.filter((row) => row.name === developer.name);
  if (!working.developers.some((row) => row.slug === developer.slug)) {
    if (sameDeveloper.length) throw new Error(sameDeveloper.some((row) => row.slug === null) ? "developer_null_slug" : "developer_identity_conflict");
    working.developers.push(developer);
  }
  if (failAfterDeveloper) throw new Error("injected_failure");
  if (!working.locations.some((row) => row.slug === location.slug)) working.locations.push(location);
  working.consumed = true;
  working.receipts = 1;
  return working;
}

const empty = (): State => ({ developers: [], locations: [], coralinaProjects: 0, consumed: false, receipts: 0 });

describe("RC5.6P prerequisite boundary — offline state matrix", () => {
  it("handles developer and location both absent", () => expect(execute(empty())).toMatchObject({ consumed: true, receipts: 1 }));
  it("handles developer present once and location absent", () => expect(execute({ ...empty(), developers: [developer] }).locations).toContainEqual(location));
  it("handles developer absent and location present once", () => expect(execute({ ...empty(), locations: [location] }).developers).toContainEqual(developer));
  it("handles both dependencies present exactly once", () => expect(execute({ ...empty(), developers: [developer], locations: [location] }).receipts).toBe(1));
  it("rejects a duplicate developer slug", () => expect(() => execute({ ...empty(), developers: [developer, developer] })).toThrow("developer_ambiguous"));
  it("rejects a duplicate location slug", () => expect(() => execute({ ...empty(), locations: [location, location] })).toThrow("location_ambiguous"));
  it("rejects a similar legal identity with another slug", () => expect(() => execute({ ...empty(), developers: [{ ...developer, slug: "other" }] })).toThrow("developer_identity_conflict"));
  it("rejects a null-slug legacy developer candidate", () => expect(() => execute({ ...empty(), developers: [{ ...developer, slug: null }] })).toThrow("developer_null_slug"));
  it("checks prerequisites while the project is absent", () => expect(execute(empty()).developers).toHaveLength(1));
  it("rejects an existing project collision", () => expect(() => execute({ ...empty(), coralinaProjects: 1 })).toThrow("project_collision"));
  it("models a failure after the first insert", () => expect(() => execute(empty(), true)).toThrow("injected_failure"));
  it("leaves the caller snapshot unchanged after rollback", () => { const state = empty(); try { execute(state, true); } catch {} expect(state).toEqual(empty()); });
  it("creates only the two approved dependencies", () => { const result = execute(empty()); expect(result.developers).toEqual([developer]); expect(result.locations).toEqual([location]); });
  it("rejects repeat execution using single-use state", () => expect(() => execute(execute(empty()))).toThrow("single_use"));
  it("lets the verifier detect incorrect identity or extra rows", () => { const result = execute(empty()); result.locations.push({ slug: "unexpected", name: "Unexpected" }); expect(result.locations).not.toEqual([location]); });
});

describe("RC5.6P prerequisite migration — static security contract", () => {
  it("has separate approvals, receipts, registration, execution, and wrapper objects", () => {
    for (const token of [
      "prerequisite_execution_approvals",
      "prerequisite_execution_receipts",
      "register_prerequisite_approval",
      "run_approved_prerequisites",
      "forever_execute_approved_prerequisites",
    ]) expect(migration).toContain(token);
  });
  it("limits writes to exact developer/location inserts and has no project insert/update/delete", () => {
    expect(migration).toContain("INSERT INTO public.developers");
    expect(migration).toContain("INSERT INTO public.locations");
    expect(migration).not.toMatch(/INSERT INTO public\.(projects|buildings|units|unit_price_history)/);
    expect(migration).not.toMatch(/(?:UPDATE|DELETE FROM) public\./);
  });
  it("binds exact identities, target, expiry, CAS consumption, and a durable receipt", () => {
    expect(migration).toContain("rhom-bho-property-public-company-limited");
    expect(migration).toContain("Rhom Bho Property Public Company Limited");
    expect(migration).toContain("slug='kamala' AND area_name='Kamala'");
    expect(migration).toContain("abtvsrcnfwlbawvrjeed");
    expect(migration).toContain("expires_at <= issued_at + INTERVAL '1 hour'");
    expect(migration).toContain("WHERE id=v_approval.id AND consumed_at IS NULL");
    expect(migration).toContain("INSERT INTO forever_import.prerequisite_execution_receipts");
  });
  it("revokes public/API access and grants only the dedicated executor wrapper", () => {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      expect(migration).toContain(`FROM ${role};`);
    }
    expect(migration).toContain("TO forever_import_executor;");
  });
});
