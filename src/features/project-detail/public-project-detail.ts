/**
 * The explicit public serialization contract for Project Detail.
 *
 * Database rows and the broad internal `ProjectDetail` model stop here. Every
 * object returned by this module is newly constructed from an allowlist; no
 * internal object is spread, omitted from, or cast into a public type.
 */

import { developerIdentity } from "./developer-identity";
import {
  locationMapDocument,
  projectFloorPlans,
  projectMasterPlan,
  projectPhotographs,
  projectUnitPlans,
  projectVideos,
  publicProjectDocuments,
} from "./project-sections";
import type {
  ProjectAmenity,
  ProjectDetail,
  ProjectDetailMediaItem,
  ProjectDetailUnit,
} from "./project-detail-types";
import { publicHttpUrl } from "./public-url";
import { publicRecordedText } from "./public-value";

export interface PublicProjectMediaDTO {
  id: string;
  type: string;
  url: string;
  sortOrder: number;
  isMap?: true;
}

export interface PublicProjectMediaCollectionDTO {
  photographs?: PublicProjectMediaDTO[];
  floorPlans?: PublicProjectMediaDTO[];
  masterPlan?: PublicProjectMediaDTO;
  unitPlans?: PublicProjectMediaDTO[];
  videos?: PublicProjectMediaDTO[];
  documents?: PublicProjectMediaDTO[];
}

export interface PublicProjectUnitDTO {
  id: string;
  code: string;
  availabilityStatus: string;
  buildingCode?: string;
  type?: string;
  bedrooms?: number;
  sizeSqm?: number;
  floor?: number;
  basePriceTHB?: number;
  discountedPriceTHB?: number;
}

export interface PublicProjectAmenityDTO {
  name: string;
  isFeatured: boolean;
  sortOrder: number;
  id?: string;
  slug?: string;
  category?: string;
  icon?: string;
  note?: string;
}

export interface PublicProjectLocationDTO {
  area?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distanceToBeach?: string;
  distanceToAirport?: string;
  nearbySchools?: string[];
  nearbyHospitals?: string[];
  lifestyle?: string[];
}

export interface PublicProjectPricingDTO {
  startingPriceTHB?: number;
  lastPriceUpdate?: string;
}

export type PublicProjectDeveloperDTO =
  | { state: "withheld" }
  | {
      state: "resolved";
      name: string;
      verified: boolean;
      id?: string;
      description?: string;
      website?: string;
      logoUrl?: string;
    };

export interface PublicProjectDetailDTO {
  id: string;
  slug: string;
  name: string;
  projectType?: string;
  status?: string;
  constructionStatus?: string;
  isDemoPreview?: true;
  usesLocalPreviewData?: true;
  pricing?: PublicProjectPricingDTO;
  location?: PublicProjectLocationDTO;
  developer?: PublicProjectDeveloperDTO;
  media?: PublicProjectMediaCollectionDTO;
  units?: PublicProjectUnitDTO[];
  amenities?: PublicProjectAmenityDTO[];
}

export interface PublicProjectDetailOptions {
  usesLocalPreviewData?: boolean;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function coordinate(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= minimum && number <= maximum ? number : undefined;
}

function publicList(values: readonly string[]): string[] | undefined {
  const result = values.map(publicRecordedText).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function publicProjectMediaDTO(item: ProjectDetailMediaItem): PublicProjectMediaDTO {
  return {
    id: item.id,
    type: item.type,
    url: item.url.trim(),
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
  };
}

function publicProjectUnitDTO(unit: ProjectDetailUnit): PublicProjectUnitDTO {
  const result: PublicProjectUnitDTO = {
    id: unit.id,
    code: unit.code.trim(),
    availabilityStatus: unit.availabilityStatus.trim(),
  };

  const buildingCode = unit.buildingCode?.trim();
  const type = publicRecordedText(unit.type);
  const bedrooms = finiteNumber(unit.bedrooms);
  const sizeSqm = finiteNumber(unit.sizeSqm);
  const floor = finiteNumber(unit.floor);
  const basePriceTHB = finiteNumber(unit.basePriceTHB);
  const discountedPriceTHB = finiteNumber(unit.discountedPriceTHB);

  if (buildingCode) result.buildingCode = buildingCode;
  if (type) result.type = type;
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  if (sizeSqm !== undefined) result.sizeSqm = sizeSqm;
  if (floor !== undefined) result.floor = floor;
  if (basePriceTHB !== undefined) result.basePriceTHB = basePriceTHB;
  if (discountedPriceTHB !== undefined) result.discountedPriceTHB = discountedPriceTHB;

  return result;
}

function publicProjectAmenityDTO(amenity: ProjectAmenity): PublicProjectAmenityDTO | null {
  const name = publicRecordedText(amenity.name);
  if (!name) return null;

  const result: PublicProjectAmenityDTO = {
    name,
    isFeatured: amenity.isFeatured === true,
    sortOrder: Number.isFinite(amenity.sortOrder) ? Math.max(0, amenity.sortOrder) : 0,
  };
  const id = amenity.id.trim();
  const slug = amenity.slug.trim();
  const category = publicRecordedText(amenity.category);
  const icon = publicRecordedText(amenity.icon);
  const note = publicRecordedText(amenity.note);

  if (id) result.id = id;
  if (slug) result.slug = slug;
  if (category) result.category = category;
  if (icon) result.icon = icon;
  if (note) result.note = note;

  return result;
}

function publicProjectLocationDTO(project: ProjectDetail): PublicProjectLocationDTO | undefined {
  const result: PublicProjectLocationDTO = {};
  const area = publicRecordedText(project.location.area || project.core.location);
  const address = publicRecordedText(project.core.address);
  const latitude = coordinate(project.location.latitude, -90, 90);
  const longitude = coordinate(project.location.longitude, -180, 180);
  const distanceToBeach = publicRecordedText(project.location.distanceToBeach);
  const distanceToAirport = publicRecordedText(project.location.distanceToAirport);
  const nearbySchools = publicList(project.location.nearbySchools);
  const nearbyHospitals = publicList(project.location.nearbyHospitals);
  const lifestyle = publicList(project.location.lifestyle);

  if (area) result.area = area;
  if (address) result.address = address;
  if (latitude !== undefined) result.latitude = latitude;
  if (longitude !== undefined) result.longitude = longitude;
  if (distanceToBeach) result.distanceToBeach = distanceToBeach;
  if (distanceToAirport) result.distanceToAirport = distanceToAirport;
  if (nearbySchools) result.nearbySchools = nearbySchools;
  if (nearbyHospitals) result.nearbyHospitals = nearbyHospitals;
  if (lifestyle) result.lifestyle = lifestyle;

  return Object.keys(result).length > 0 ? result : undefined;
}

function publicProjectPricingDTO(project: ProjectDetail): PublicProjectPricingDTO | undefined {
  const result: PublicProjectPricingDTO = {};
  const startingPriceTHB = finiteNumber(project.pricing.startingPriceTHB);
  const lastPriceUpdate = publicRecordedText(project.pricing.lastPriceUpdate);

  if (startingPriceTHB !== undefined && startingPriceTHB > 0) {
    result.startingPriceTHB = startingPriceTHB;
  }
  if (lastPriceUpdate) result.lastPriceUpdate = lastPriceUpdate;

  return Object.keys(result).length > 0 ? result : undefined;
}

function publicProjectDeveloperDTO(project: ProjectDetail): PublicProjectDeveloperDTO | undefined {
  const identity = developerIdentity(project);
  if (identity.state === "withheld") return { state: "withheld" };
  if (identity.state === "absent") return undefined;

  const name = publicRecordedText(identity.name);
  if (!name) return undefined;

  const result: Extract<PublicProjectDeveloperDTO, { state: "resolved" }> = {
    state: "resolved",
    name,
    verified: identity.verified,
  };

  if (!identity.verified || !project.developer) return result;

  const id = project.developer.id.trim();
  const description = publicRecordedText(project.developer.description);
  const website = publicHttpUrl(project.developer.website);
  const logoUrl = publicHttpUrl(project.developer.logoUrl);

  if (id) result.id = id;
  if (description) result.description = description;
  if (website) result.website = website;
  if (logoUrl) result.logoUrl = logoUrl;

  return result;
}

function publicProjectMediaCollectionDTO(
  project: ProjectDetail,
): PublicProjectMediaCollectionDTO | undefined {
  const result: PublicProjectMediaCollectionDTO = {};
  const photographs = projectPhotographs(project).map(publicProjectMediaDTO);
  const floorPlans = projectFloorPlans(project).map(publicProjectMediaDTO);
  const masterPlan = projectMasterPlan(project);
  const unitPlans = projectUnitPlans(project).map(publicProjectMediaDTO);
  const videos = projectVideos(project).map(publicProjectMediaDTO);
  const mapDocument = locationMapDocument(project);
  const documents = publicProjectDocuments(project).map((document) => {
    const item = publicProjectMediaDTO(document);
    if (
      mapDocument &&
      mapDocument.id === document.id &&
      mapDocument.url.trim() === document.url.trim()
    ) {
      item.isMap = true;
    }
    return item;
  });

  if (photographs.length > 0) result.photographs = photographs;
  if (floorPlans.length > 0) result.floorPlans = floorPlans;
  if (masterPlan) result.masterPlan = publicProjectMediaDTO(masterPlan);
  if (unitPlans.length > 0) result.unitPlans = unitPlans;
  if (videos.length > 0) result.videos = videos;
  if (documents.length > 0) result.documents = documents;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Construct the only Project Detail object permitted to cross query caching,
 * route loading, SSR serialization, and client hydration.
 */
export function publicProjectDetail(
  project: ProjectDetail,
  options: PublicProjectDetailOptions = {},
): PublicProjectDetailDTO {
  const result: PublicProjectDetailDTO = {
    id: project.core.id,
    slug: project.core.slug.trim(),
    name: project.core.name.trim(),
  };
  const projectType = publicRecordedText(project.core.type);
  const status = publicRecordedText(project.core.status);
  const constructionStatus = publicRecordedText(project.core.constructionStatus);
  const pricing = publicProjectPricingDTO(project);
  const location = publicProjectLocationDTO(project);
  const developer = publicProjectDeveloperDTO(project);
  const media = publicProjectMediaCollectionDTO(project);
  const units = (project.units ?? []).map(publicProjectUnitDTO);
  const amenities = (project.amenities ?? [])
    .map(publicProjectAmenityDTO)
    .filter((amenity): amenity is PublicProjectAmenityDTO => amenity !== null);

  if (projectType) result.projectType = projectType;
  if (status) result.status = status;
  if (constructionStatus) result.constructionStatus = constructionStatus;
  if (project.core.isDemoPreview) result.isDemoPreview = true;
  if (project.core.usesLocalPreviewData || options.usesLocalPreviewData) {
    result.usesLocalPreviewData = true;
  }
  if (pricing) result.pricing = pricing;
  if (location) result.location = location;
  if (developer) result.developer = developer;
  if (media) result.media = media;
  if (units.length > 0) result.units = units;
  if (amenities.length > 0) result.amenities = amenities;

  return result;
}

/** The first already-allowlisted public photograph, shared by metadata surfaces. */
export function publicProjectSocialImage(project: PublicProjectDetailDTO): string | null {
  return project.media?.photographs?.[0]?.url ?? null;
}
