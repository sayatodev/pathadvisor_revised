import Image from "next/image";
import type { BuildingFloorSummary, PlaceDetail, RouteData } from "@/lib/pathadvisor";
import { formatCampusAreaName } from "@/lib/venue-display";

export type RouteDraft = { start: import("@/lib/pathadvisor").SearchPlace | null; end: import("@/lib/pathadvisor").SearchPlace | null };
export type FloorOption = { id: string; label: string; elevation?: number | null };
type MdiIconName = "arrow-left" | "arrow-right" | "arrow-top-right" | "chevron-down" | "clock-outline" | "crosshairs-gps" | "directions" | "elevator-passenger" | "escalator" | "home-outline" | "magnify" | "magnify-scan" | "map-marker-outline" | "stairs" | "swap-vertical";

export function MdiIcon({ name, className = "" }: { name: MdiIconName; className?: string }) {
  return <Image src={`/mdi/${name}.svg`} alt="" width={20} height={20} className={className} />;
}

export function MdiMaskIcon({ name, className = "" }: { name: MdiIconName; className?: string }) {
  const mask = `url("/mdi/${name}.svg") center / contain no-repeat`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ WebkitMask: mask, mask }}
    />
  );
}

export function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 1) return "<1 min";
  return `${Math.round(minutes)} min`;
}

export function formatDistance(distance: number | null) {
  if (distance === null) return "—";
  return `${distance.toFixed(distance >= 100 ? 0 : 1)} m`;
}

export function floorChipLabel(floor: BuildingFloorSummary) {
  return floor.name === "G" ? "G" : floor.name;
}

const BUILDING_CHIP_LABELS: Record<string, string> = {
  "Academic Building": "Academic Bldg.",
  "Cheng Yu Tung Building": "CYT Bldg.",
  "HKUST Jockey Club Institute for Advanced Study/Lo Ka Chung Building": "IAS / LKC Bldg.",
  "Lee Shau Kee Business Building": "LSK Bldg.",
  "Martin Ka Shing Lee Innovation Building": "MKS Lee Innovation Bldg.",
};

export function buildingChipLabel(name: string) {
  return BUILDING_CHIP_LABELS[name] ?? name.replace(/Building$/, "Bldg.");
}

export function placeLocationLabel(place: PlaceDetail) {
  const floor = place.floorName ? (place.floorName.startsWith("Floor ") ? place.floorName : `Floor ${place.floorName}`) : "";
  return [floor, place.buildingName].filter(Boolean).join(", ") || place.address || "Campus";
}

export function venueDisplayName(name: string, category?: string) {
  const normalizedName = name.trim();
  const campusAreaName = formatCampusAreaName(normalizedName);
  const toiletCodePattern = /\d{1,5}T$/i;
  const verticalTransportCodePattern = /^(UG\d*|LG\d*|G\d*|B\d{1,2}|L\d{1,2}|\d{1,2})(ESC|SC|STAIR)([A-Z]{0,4}\d{2,3}[A-Z]?)$/i;
  const verticalTransportMatch = normalizedName.match(verticalTransportCodePattern);
  const roomCodePattern = /^(?:(?:UG|LG|G)|(?:B|L)\d{1,2}|\d{1,2})\d{2,4}[A-Z]?$/i;
  if (campusAreaName) return campusAreaName;
  if (toiletCodePattern.test(normalizedName)) {
    const normalizedCategory = category?.toLowerCase() ?? "";
    const toiletLabel = normalizedCategory.includes("disable") || normalizedCategory.includes("accessible") ? "Accessible Toilet" : normalizedCategory.includes("male") ? "Male Toilet" : normalizedCategory.includes("female") ? "Female Toilet" : "Toilet";
    return `${toiletLabel} (Rm. ${normalizedName})`;
  }
  if (verticalTransportMatch) {
    const [, floor, type, number] = verticalTransportMatch;
    return `${type.toUpperCase() === "ESC" ? "Escalator" : "Staircase"} ${number} (Floor ${floor})`;
  }
  return roomCodePattern.test(normalizedName) && !/^room\b/i.test(normalizedName) ? `Room ${normalizedName}` : normalizedName;
}

export function routeFloorOptions(routeData: RouteData | null) {
  if (!routeData) return [];
  const seen = new Set<string>();
  const options: FloorOption[] = [];
  for (const segment of routeData.segments) {
    if (!segment.floorId || segment.locationLabel.includes("Outdoor") || seen.has(segment.floorId)) continue;
    seen.add(segment.floorId);
    options.push({ id: segment.floorId, label: segment.locationLabel.replace("Floor ", "").replace(", Academic Building", "") });
  }
  return options;
}
