import type { ForeverConstructionProgress } from "./construction-progress";
import type { ForeverDeveloper } from "./developer";
import type { ForeverDocument } from "./document";
import type { ForeverInvestmentInformation } from "./investment-information";
import type { ForeverLocation } from "./location";
import type { ForeverMedia } from "./media";
import type { ForeverPaymentPlan } from "./payment-plan";
import type { ForeverProject } from "./project";
import type { ForeverRentalInformation } from "./rental-information";
import type { ForeverUnit } from "./unit";

/**
 * The full set of canonical records for one project.
 *
 * This is the aggregate an adapter produces and an import pipeline persists.
 * The `project` is the parent; every other collection is normalized and
 * linked back by id. Nullable single relations (`developer`, `location`) are
 * `null` when the source has none, rather than omitted, so the shape is
 * always complete and predictable.
 */
export interface ForeverDatabaseRecord {
  project: ForeverProject;
  developer: ForeverDeveloper | null;
  location: ForeverLocation | null;
  units: ForeverUnit[];
  media: ForeverMedia[];
  documents: ForeverDocument[];
  paymentPlans: ForeverPaymentPlan[];
  constructionProgress: ForeverConstructionProgress[];
  rentalInformation: ForeverRentalInformation[];
  investmentInformation: ForeverInvestmentInformation[];
}
