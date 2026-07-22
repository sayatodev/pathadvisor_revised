import type { BuildingFloorSummary, SearchPlace, SearchPlaceKind } from "./types";

export type AnyRecord = Record<string, unknown>;

export function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function locationKindFromRecord(record: AnyRecord): SearchPlaceKind {
  if ("point_of_interest_information_id" in record || "point_of_interest_type_name" in record) {
    return "point_of_interest";
  }

  if ("is_building" in record || "full_name" in record) {
    return "building";
  }

  return "location";
}

export function categoryFromRecord(record: AnyRecord, kind: SearchPlaceKind) {
  return kind === "point_of_interest"
    ? asString(record.point_of_interest_type_name || record.type_name)
    : asString(record.type_name);
}

export function normalizeSearchPlace(record: AnyRecord): SearchPlace {
  const kind = locationKindFromRecord(record);
  const buildingName = asString(record.building_name || record.building_short_name);
  const floorIdValue = record.building_floor_id;
  const floorId =
    typeof floorIdValue === "string"
      ? floorIdValue
      : floorIdValue && typeof floorIdValue === "object" && "_id" in floorIdValue
        ? asString((floorIdValue as AnyRecord)._id)
        : undefined;
  const floorName =
    floorIdValue && typeof floorIdValue === "object" && "name" in floorIdValue
      ? asString((floorIdValue as AnyRecord).name)
      : asString(record.building_floor_name);
  const name =
    kind === "building" ? asString(record.full_name) : asString(record.name || record.full_name);
  const description = asString(record.description);
  const category = categoryFromRecord(record, kind);
  const subtitleParts = [buildingName, floorName].filter(Boolean);

  return {
    id: asString(record._id),
    kind,
    name,
    subtitle:
      kind === "building"
        ? "Building"
        : subtitleParts.length > 0
          ? subtitleParts.join(" • ")
          : kind === "point_of_interest"
            ? asString(record.point_of_interest_type_name)
            : category,
    category: category || undefined,
    description,
    buildingId: asString(record.building_id) || undefined,
    buildingName: buildingName || undefined,
    floorId,
    floorName: floorName || undefined,
    routeable: kind !== "building",
    remoteId: asString(record.remote_id) || undefined,
  };
}

function walkCoordinates(input: unknown, pointHandler: (point: [number, number]) => void) {
  if (!Array.isArray(input) || input.length === 0) {
    return;
  }

  if (typeof input[0] === "number") {
    const lng = input[0];
    const lat = input[1];
    if (typeof lng === "number" && typeof lat === "number") {
      pointHandler([lat, lng]);
    }
    return;
  }

  for (const nested of input) {
    walkCoordinates(nested, pointHandler);
  }
}

export function getFeatureBounds(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): [[number, number], [number, number]] | null {
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  walkCoordinates(feature.geometry.coordinates, ([lat, lng]) => {
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  });

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) {
    return null;
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

export function sortFloors(floors: BuildingFloorSummary[]) {
  return [...floors].sort((left, right) => {
    const leftElevation = left.elevation ?? Number.NEGATIVE_INFINITY;
    const rightElevation = right.elevation ?? Number.NEGATIVE_INFINITY;
    return rightElevation - leftElevation;
  });
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
