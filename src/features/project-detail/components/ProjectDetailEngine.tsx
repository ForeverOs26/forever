import type { ProjectDetail } from "../project-detail-types";
import { ForeverPassportCard } from "@/features/passport/components/ForeverPassportCard";
import { ForeverIntelligenceSection } from "./ForeverIntelligenceSection";
import { ProjectContactCTA } from "./ProjectContactCTA";
import { ProjectDeveloper } from "./ProjectDeveloper";
import { ProjectDocuments } from "./ProjectDocuments";
import { ProjectFloorPlans } from "./ProjectFloorPlans";
import { ProjectGallery } from "./ProjectGallery";
import { ProjectHero } from "./ProjectHero";
import { ProjectInvestmentAnalysis } from "./ProjectInvestmentAnalysis";
import { ProjectInventory } from "./ProjectInventory";
import { ProjectMasterPlan } from "./ProjectMasterPlan";
import { ProjectTrustSummary } from "./ProjectTrustSummary";
import { ProjectUnitPlans } from "./ProjectUnitPlans";

type ProjectDetailEngineProps = {
  project: ProjectDetail;
};

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
      <ProjectHero project={project} />
      <ForeverPassportCard project={project} />
      <ProjectTrustSummary project={project} />
      {hasAdvisoryEvidence ? <ForeverIntelligenceSection project={project} /> : null}
      <ProjectInvestmentAnalysis project={project} />
      <ProjectInventory project={project} />
      <ProjectGallery project={project} />
      <ProjectFloorPlans project={project} />
      <ProjectMasterPlan project={project} />
      <ProjectUnitPlans project={project} />
      <ProjectDocuments project={project} />
      <ProjectDeveloper project={project} />
      <ProjectContactCTA project={project} />
    </>
  );
}
