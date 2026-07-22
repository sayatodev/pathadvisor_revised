import type { Metadata } from "next";
import { getPlaceDetail } from "./places";

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
    const [from, to] = await Promise.all([
      fromId ? getPlaceDetail(fromId) : Promise.resolve(null),
      toId ? getPlaceDetail(toId) : Promise.resolve(null),
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

    return metadata(title, description);
  } catch {
    return null;
  }
}
