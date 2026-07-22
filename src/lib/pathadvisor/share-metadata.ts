import type { Metadata } from "next";
import { getDirections } from "./directions";
import { getPlaceDetail } from "./places";
import type { RouteData } from "./types";

const SITE_NAME = "PathAdvisor Revised (Unofficial)";
const APP_NAME = "HKUST PathAdvisor Revised";

function uniqueLocationParts(parts: Array<string | undefined>) {
  return parts.reduce<string[]>((result, part) => {
    if (part && !result.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      result.push(part);
    }
    return result;
  }, []);
}

function metadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      type: "website",
    },
  };
}

function routeFloorLabel(segment: RouteData["segments"][number]) {
  return segment.locationLabel.match(/floor\s+([^,]+)/i)?.[1].trim() ?? "?";
}

function routeFloorLevel(floor: string) {
  const normalized = floor.trim().toUpperCase();
  if (normalized === "G") return 0;

  const basement = normalized.match(/^B(\d+)$/);
  if (basement) return -Number.parseInt(basement[1], 10);

  const lowerGround = normalized.match(/^LG(\d*)$/);
  if (lowerGround) return -Number.parseInt(lowerGround[1] || "1", 10);

  const upperGround = normalized.match(/^UG(\d*)$/);
  if (upperGround) return Number.parseInt(upperGround[1] || "1", 10);

  const numeric = normalized.match(/^(?:L)?(\d+)$/);
  return numeric ? Number.parseInt(numeric[1], 10) : null;
}

function transitionKind(details: string) {
  const normalized = details.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const verticalCode = compact.match(/(?:ug\d*|lg\d*|g\d*|b\d{1,2}|l\d{1,2}|\d{1,2})(esc|sc|stair|lift|li)/i)?.[1]?.toLowerCase();

  if (normalized.includes("lift") || normalized.includes("elevator") || verticalCode === "lift" || verticalCode === "li") {
    return "lift";
  }
  if (normalized.includes("escalator") || verticalCode === "esc") return "escalator";
  if (normalized.includes("stair") || verticalCode === "sc" || verticalCode === "stair") return "staircase";
  return null;
}

function routeMetrics(route: RouteData) {
  const summary = { lifts: 0, staircaseFloors: 0, escalatorFloors: 0 };
  const floorSegments = route.segments.flatMap((segment, index) =>
    segment.floorId && segment.coordinates.length > 0 ? [{ segment, index }] : [],
  );

  for (let index = 1; index < floorSegments.length; index += 1) {
    const { segment: previousSegment, index: previousIndex } = floorSegments[index - 1];
    const { segment: nextSegment, index: nextIndex } = floorSegments[index];
    if (previousSegment.floorId === nextSegment.floorId) continue;

    const kind = transitionKind([
      previousSegment.end,
      previousSegment.info,
      ...route.segments.slice(previousIndex + 1, nextIndex).map((segment) => segment.info),
      nextSegment.start,
      nextSegment.info,
    ].filter(Boolean).join(" "));
    if (!kind) continue;

    if (kind === "lift") {
      summary.lifts += 1;
      continue;
    }

    const fromFloor = routeFloorLevel(routeFloorLabel(previousSegment));
    const toFloor = routeFloorLevel(routeFloorLabel(nextSegment));
    const floorSpan = fromFloor === null || toFloor === null ? 1 : Math.max(Math.abs(toFloor - fromFloor), 1);
    if (kind === "staircase") summary.staircaseFloors += floorSpan;
    else summary.escalatorFloors += floorSpan;
  }

  const duration = route.time === null ? "—" : route.time < 1 ? "<1 min" : `${Math.round(route.time)} min`;
  const distance = route.distance === null ? "—" : `${route.distance.toFixed(route.distance >= 100 ? 0 : 1)} m`;
  return `${duration} • ${distance} • Lifts: ${summary.lifts} • Stairs: ${summary.staircaseFloors} fl • Escalators: ${summary.escalatorFloors} fl`;
}

export async function viewShareMetadata({
  buildingId,
  floorId,
  placeId,
}: {
  buildingId: string;
  floorId?: string;
  placeId?: string;
}): Promise<Metadata | null> {
  try {
    const detail = await getPlaceDetail(placeId ?? buildingId);
    const isVenue = Boolean(placeId && !detail.isBuilding);
    const resolvedBuildingId = detail.buildingId ?? (detail.isBuilding ? detail.id : undefined);
    if (resolvedBuildingId !== buildingId) {
      return null;
    }

    const floor = floorId ? detail.floors.find((entry) => entry.id === floorId && entry.showInPathAdvisor) : undefined;
    if (floorId && !floor) {
      return null;
    }

    const buildingName = detail.isBuilding ? detail.name : detail.buildingName;
    if (!buildingName) {
      return null;
    }
    const floorName = floor?.name ?? (!floorId ? detail.floorName : undefined);
    const title = isVenue
      ? detail.name
      : floorName
        ? `${buildingName} - Floor ${floorName}`
        : buildingName;
    const location = uniqueLocationParts([
      isVenue ? detail.name : undefined,
      buildingName,
      floorName ? `Floor ${floorName}` : undefined,
    ]);

    return metadata(
      title,
      `View map of ${location.join(" - ")} on ${APP_NAME}`,
    );
  } catch {
    return null;
  }
}

export async function directionsShareMetadata({
  fromId,
  toId,
}: {
  fromId?: string;
  toId?: string;
}): Promise<Metadata | null> {
  try {
    const [from, to, route] = await Promise.all([
      fromId ? getPlaceDetail(fromId) : Promise.resolve(null),
      toId ? getPlaceDetail(toId) : Promise.resolve(null),
      fromId && toId ? getDirections({ start: fromId, end: toId }).catch(() => null) : Promise.resolve(null),
    ]);
    if ((fromId && !from) || (toId && !to)) {
      return null;
    }

    const title = to ? `Directions to ${to.name}` : "Directions";
    const description = from && to
      ? `View directions from ${from.name} to ${to.name} on ${APP_NAME}`
      : to
        ? `View directions to ${to.name} on ${APP_NAME}`
        : from
          ? `View directions from ${from.name} on ${APP_NAME}`
          : `View directions on ${APP_NAME}`;

    return metadata(title, route ? `${description}\n${routeMetrics(route)}` : description);
  } catch {
    return null;
  }
}
