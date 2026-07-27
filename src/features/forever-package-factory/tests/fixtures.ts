/**
 * Package Factory — test fixtures.
 *
 * Synthetic price schedules in exactly the shapes the real official documents
 * produce, so every layout rule is exercised without any project file entering
 * the repository.
 */

import type { ProductionIdentityReader, ProductionProject } from "../identity";

/** Column order `area, price/sqm, total` (Coralina, Sierra, Adora). */
export const CONDO_AREA_PSQM_TOTAL = [
  "CORALINA Price List -    Updated : 17.07.26 (Internal Use Only)",
  "Tower  Floor  Status     Room No.  Code Type  Room Type          Area   Price/sqm  Selling Price",
  "                                                                 (sqm)",
  "A      2      Available  CKA201    2B-2m      2 BEDROOM          64     146,556    9,379,584.00",
  "A      2      Available  CKA202    2BS1-2     2 BEDROOM          64     146,556    9,379,584.00",
  "A      3      Available  CKA303    1BPLC1-2   1 BEDROOM PLUS     46     149,660    6,884,360.00",
].join("\n");

/** Column order `area, total, price/sqm` (Modeva, KataBello). */
export const CONDO_AREA_TOTAL_PSQM = [
  "THE    MODEVA Price list -       Updated  : 17.07.26 (Internal      Use Only)",
  "Tower  Floor  Status     Room    Type     Room Type         Area    Units Price    Price/Sq.m.",
  "                         No.                                (sqm)",
  "A      1      Available  MBA101  1BLA     1 BEDROOM LA      43.00   7,525,000.00   175,000.00",
  "A      2      Available  MBA214  1BPC     1 BEDROOM PLUS C  55.00   8,951,250.00   162,750.00",
  "G      7      Available  MBG710  1BS      1 BEDROOM S       29.00   4,902,450.00   169,050.00",
].join("\n");

/** A room type that begins with a digit, and a hyphenated penthouse name. */
export const CONDO_AWKWARD_ROOM_TYPES = [
  "TEST Price List - Updated : 01.02.26",
  "Tower  Floor  Status     Room No.  Type     Room Type            Area   Price/sqm  Selling Price",
  "A      1      Available  TSA101    1BL      1 BEDROOM L          40.00  150,000    6,000,000.00",
  "A      9      Available  TSA901    PH3B     PH-3 BEDROOM C - GD  180.00 250,000    45,000,000.00",
  "B      2      Available  TSB218    1BS(M)   1 BEDROOM S(M)       28.40  102,349    2,906,712.00",
].join("\n");

/** A shifted row: neither column order satisfies the invariant. */
export const CONDO_WITH_SHIFTED_ROW = [
  "TEST Price List - Updated : 01.02.26",
  "Tower  Floor  Status     Room No.  Type   Room Type    Area   Price/sqm  Selling Price",
  "A      1      Available  TSA101    1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
  "A      2      Available  TSA201    1BL    1 BEDROOM    40.00  150,000    9,999,999.00",
].join("\n");

/** A unit code that disagrees with its own tower/floor columns. */
export const CONDO_WITH_CODE_DISAGREEMENT = [
  "TEST Price List - Updated : 01.02.26",
  "Tower  Floor  Status     Room No.  Type   Room Type    Area   Price/sqm  Selling Price",
  "A      1      Available  TSA101    1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
  "A      3      Available  TSA101    1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
].join("\n");

/** Thousands groups split across a cell gap, as `pdftotext` renders them. */
export const CONDO_WITH_SPLIT_NUMBERS = [
  "TEST Price List - Updated : 01.02.26",
  "Tower  Floor  Status     Room No.  Type   Room Type    Area   Price/sqm  Selling Price",
  "A      1      Available  TSA101    1BL    1 BEDROOM    40.00  141,  290  5,651,  600.00",
].join("\n");

/** Two pages with a repeated header. */
export const CONDO_MULTI_PAGE = [
  "TEST Price List - Updated : 01.02.26",
  "Tower  Floor  Status     Room No.  Type   Room Type    Area   Price/sqm  Selling Price",
  "A      1      Available  TSA101    1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
  "\fTower  Floor  Status     Room No.  Type   Room Type    Area   Price/sqm  Selling Price",
  "B      2      Available  TSB201    1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
].join("\n");

/** No tower and no floor column at all. */
export const CONDO_NO_BUILDING_NO_FLOOR = [
  "TEST Price List - Updated : 01.02.26",
  "Room No.  Status     Type   Room Type    Area   Price/sqm  Selling Price",
  "TSA101    Available  1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
  "TSA102    Available  1BL    1 BEDROOM    40.00  150,000    6,000,000.00",
].join("\n");

/** Villa schedule: no price-per-sqm column; sq.wah and sq.m both stated. */
export const VILLA_SCHEDULE = [
  "TEST VILLAS Price List - Updated : 01.02.26",
  "Plot  Zone  Status     Villa Type  Plot Code  Land (wah)  Land (sqm)  Built (sqm)  Beds/Baths  Price",
  "AVA   Z1    Available  Type A      AVA12      100.00      400.00      320.00       4 beds / 5 baths  25,000,000.00",
  "MVA   Z1    Available  Type M      MVA03      120.00      480.00      380.00       5 beds / 6 baths  32,000,000.00",
  "LVA   Z2    Available  Type L      LVA07      150.00      600.00      450.00       5 beds / 6 baths  41,000,000.00",
].join("\n");

/** A villa row whose sq.wah and sq.m columns disagree (a shifted row). */
export const VILLA_WITH_LAND_MISMATCH = [
  "TEST VILLAS Price List - Updated : 01.02.26",
  "Plot  Zone  Status     Villa Type  Plot Code  Land (wah)  Land (sqm)  Built (sqm)  Beds/Baths  Price",
  "AVA   Z1    Available  Type A      AVA12      100.00      999.00      320.00       4 beds / 5 baths  25,000,000.00",
].join("\n");

/** A schedule that matches no registered layout. */
export const UNSUPPORTED_LAYOUT = [
  "Some developer newsletter",
  "We are pleased to announce the launch of our newest project.",
  "Please contact your agent for details.",
].join("\n");

/** An official note announcing a sale. */
export const SOLD_NOTE = "SOLD CKA201";

export class FakeIdentityReader implements ProductionIdentityReader {
  constructor(private readonly projects: readonly ProductionProject[]) {}

  async listProjects(): Promise<readonly ProductionProject[]> {
    return this.projects;
  }
}

export function productionProject(
  slug: string,
  name: string,
  publicStatus: string | null = "published",
): ProductionProject {
  return { id: `id-${slug}`, slug, name, publicStatus };
}
