import { fetchPathAdvisor } from "./client";
import type { RouteData, RouteSegment } from "./types";
import { asString, parseNumber } from "./utilities";

type DirectionsResponse = {
  meta?: { code?: number; message?: string };
  data: {
    directions?: {
      start_location_building_floor_id?: string;
      start_location_id: string;
      start: string;
      end: string;
      distance?: string;
      time?: string;
      paths?: Array<{
        properties: { building_floor_id?: string; building_id?: string; start?: string; end?: string; distance?: string; time?: string; location?: string; info?: string };
        geometry: { coordinates: Array<[number, number] | string> };
      }>;
    };
  };
};

type DirectionPath = NonNullable<NonNullable<DirectionsResponse["data"]["directions"]>["paths"]>[number];

function normalizeSegment(path: DirectionPath, index: number): RouteSegment {
  const coordinates = (path.geometry.coordinates ?? [])
    .map((coordinate) => {
      const [lngValue, latValue] = typeof coordinate === "string" ? coordinate.trim().split(/\s+/) : coordinate;
      const lng = parseNumber(lngValue);
      const lat = parseNumber(latValue);
      return Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as [number, number]) : null;
    })
    .filter((point): point is [number, number] => Boolean(point))
    .reverse();
  return {
    id: `${path.properties.building_floor_id ?? "info"}-${index}`,
    floorId: path.properties.building_floor_id,
    buildingId: path.properties.building_id,
    start: asString(path.properties.start),
    end: asString(path.properties.end),
    locationLabel: asString(path.properties.location),
    distance: parseNumber(path.properties.distance),
    time: parseNumber(path.properties.time),
    info: asString(path.properties.info) || undefined,
    coordinates,
  };
}

export async function getDirections(params: { start: string; end: string; isWheelchairAccessible?: boolean; excludeEscalator?: boolean }) {
  const response = await fetchPathAdvisor<DirectionsResponse>("/directions", {
    start: params.start,
    end: params.end,
    is_wheelchair_accessible: params.isWheelchairAccessible ?? false,
    exclude_escalator: params.excludeEscalator ?? false,
  });
  const directions = response.data.directions;
  if (!directions?.paths?.length) {
    const message = response.meta?.message?.trim();
    throw new Error(
      !message || message.toLowerCase() === "path not found"
        ? "No route could be found between these locations."
        : message,
    );
  }

  return {
    startLabel: directions.start,
    endLabel: directions.end,
    startLocationId: directions.start_location_id,
    startFloorId: directions.start_location_building_floor_id,
    distance: parseNumber(directions.distance),
    time: parseNumber(directions.time),
    segments: directions.paths.map(normalizeSegment),
  } satisfies RouteData;
}
