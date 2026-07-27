import type { ProjectDetail } from "../project-detail-types";
import { projectSections } from "../project-sections";
import { ForeverPassportCard } from "@/features/passport/components/ForeverPassportCard";
import { ForeverIntelligenceSection } from "./ForeverIntelligenceSection";
import { ProjectDeveloper } from "./ProjectDeveloper";
import { ProjectDocuments } from "./ProjectDocuments";
import { ProjectFacilities } from "./ProjectFacilities";
import { ProjectFloorPlans } from "./ProjectFloorPlans";
import { ProjectInvestmentAnalysis } from "./ProjectInvestmentAnalysis";
import { ProjectInventory } from "./ProjectInventory";
import { ProjectLocation } from "./ProjectLocation";
import { ProjectMasterPlan } from "./ProjectMasterPlan";
import { ProjectMobileCTA } from "./ProjectMobileCTA";
import { ProjectOverview } from "./ProjectOverview";
import { ProjectPaymentPlan } from "./ProjectPaymentPlan";
import { ProjectPhotos } from "./ProjectPhotos";
import { ProjectSectionNav } from "./ProjectSectionNav";
import { ProjectTopSection } from "./ProjectTopSection";
import { ProjectTrustSummary } from "./ProjectTrustSummary";
import { ProjectUnitPlans } from "./ProjectUnitPlans";
import { ProjectUnitPreview } from "./ProjectUnitPreview";

type ProjectDetailEngineProps = {
  project: ProjectDetail;
};

/**
 * Project page order (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * What the page answers, in the order a buyer asks it: what does it look like,
 * where is it, what does it cost, what can I do next — then what is it, what is
 * available, and only then the supporting material.
 *
 * The previous order opened with a darkened full-bleed photograph carrying the
 * headline and four buttons, and put the gallery and the unit list near the
 * bottom, behind the advisory panels. A visitor had to scroll past everything
 * Forever wanted to say before reaching the two things they came for.
 */
export function ProjectDetailEngine({ project }: ProjectDetailEngineProps) {
  const hasAdvisoryEvidence =
    project.trust.foreverVerified ||
    project.trust.trustScore > 0 ||
    project.investment.investmentValue > 0 ||
    Boolean(
      project.trust.lastInspection ||
      project.trust.marketPosition ||
      project.trust.verdict ||
      project.investment.rentalYield ||
      project.investment.rentalDemand ||
      project.investment.capitalGrowthEstimate,
    );

  return (
    <>
      <ProjectTopSection project={project} />
      <ProjectSectionNav sections={projectSections(project)} />

      {/* Bottom padding clears the sticky mobile bar. */}
      <div className="pb-24 lg:pb-0">
        <ProjectOverview project={project} />
        <ProjectUnitPreview project={project} />
        <ProjectPhotos project={project} />
        <ProjectFacilities project={project} />
        <ProjectMasterPlan project={project} />
        <ProjectFloorPlans project={project} />
        <ProjectUnitPlans project={project} />
        <ProjectInventory project={project} />
        <ProjectPaymentPlan project={project} />
        <ProjectDeveloper project={project} />
        <ProjectLocation project={project} />
        <ForeverPassportCard project={project} />
        <ProjectTrustSummary project={project} />
        {hasAdvisoryEvidence ? <ForeverIntelligenceSection project={project} /> : null}
        <ProjectInvestmentAnalysis project={project} />
        <ProjectDocuments project={project} />
      </div>

      <ProjectMobileCTA project={project} />
    </>
  );
}
