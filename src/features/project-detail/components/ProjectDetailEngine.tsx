import {
  buildDecisionDeckModel,
  type DecisionDeckRelatedProjectInput,
  type DecisionDeckValue,
} from "../decision-deck-model";
import type { ProjectDetail } from "../project-detail-types";
import "../decision-deck.css";

import { ProjectDecisionAmenities } from "./ProjectDecisionAmenities";
import { ProjectDecisionDeveloper } from "./ProjectDecisionDeveloper";
import { ProjectDecisionDocuments } from "./ProjectDecisionDocuments";
import { ProjectDecisionIntelligence } from "./ProjectDecisionIntelligence";
import { ProjectDecisionLocation } from "./ProjectDecisionLocation";
import { ProjectDecisionOverview } from "./ProjectDecisionOverview";
import { ProjectFeaturedAmenities } from "./ProjectFeaturedAmenities";
import { ProjectFilm } from "./ProjectFilm";
import { ProjectFullPassport } from "./ProjectFullPassport";
import { ProjectPlans } from "./ProjectPlans";
import { ProjectRelatedProjects } from "./ProjectRelatedProjects";
import { ProjectSectionNav } from "./ProjectSectionNav";
import { ProjectTopSection } from "./ProjectTopSection";
import { ProjectUnitPreview } from "./ProjectUnitPreview";
import { ProjectUpdates } from "./ProjectUpdates";

export interface ProjectDetailEngineProps {
  project: ProjectDetail;
  relatedProjects?: readonly DecisionDeckRelatedProjectInput[];
}

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

/**
 * The single production Project Detail engine, evolved into the approved
 * Forever Decision Deck. Rendering and navigation consume one pure model.
 */
export function ProjectDetailEngine({ project, relatedProjects = [] }: ProjectDetailEngineProps) {
  const model = buildDecisionDeckModel(project, { relatedProjects });

  return (
    <div
      className="decision-deck-page"
      data-testid="decision-deck-page"
      data-composition-order={model.compositionOrder.join(",")}
    >
      <ProjectTopSection project={project} model={model} />
      <ProjectSectionNav sections={model.navigation} />

      <div data-testid="decision-deck-sections">
        <ProjectDecisionOverview overview={model.overview} />
        <ProjectFeaturedAmenities amenities={model.amenities.featured} />
        {model.sectionStates.units ? (
          <ProjectUnitPreview
            units={model.units}
            lastPriceUpdate={model.passport.compact.lastPriceUpdate}
          />
        ) : null}
        <ProjectFilm film={supported(model.media.film) ? model.media.film.value : null} />
        <ProjectPlans plans={model.plans} />
        {model.sectionStates.passport ? (
          <ProjectFullPassport passport={model.passport.full} />
        ) : null}
        <ProjectDecisionIntelligence intelligence={model.intelligence} />
        <ProjectDecisionAmenities amenities={model.amenities.all} />
        <ProjectDecisionLocation location={model.location} />
        <ProjectDecisionDeveloper developer={model.developer} />
        <ProjectUpdates updates={model.updates} />
        <ProjectDecisionDocuments documents={model.documents} />
        <ProjectRelatedProjects related={model.related} />
      </div>
    </div>
  );
}
