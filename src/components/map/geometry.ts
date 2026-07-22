import type { GeoJSONSource, Map as MapLibreInstance } from "maplibre-gl";
import type { FloorData } from "@/lib/pathadvisor";
import { parseCampusAreaCode } from "@/lib/venue-display";

export type MapBoundsTuple = [[number, number], [number, number]];
type FloorFeatureProperties = FloorData["features"][number]["properties"];

export function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function normalizeColorHex(colorHex: string | undefined, fallback: string) {
  const normalized = colorHex?.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized ?? "") ? `#${normalized}` : fallback;
}

export function darkenColorHex(colorHex: string, amount: number) {
  const normalized = colorHex.slice(1);
  const channel = (offset: number) =>
    Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export function isPathwayLikeFeature(properties: FloorFeatureProperties) {
  const typeName = properties.typeName?.trim().toLowerCase() ?? "";
  return typeName.includes("path") || typeName.includes("corridor") || typeName.includes("walkway");
}

export function isCourtyardFeature(properties: FloorFeatureProperties) {
  return (
    parseCampusAreaCode(properties.name)?.kind === "Courtyard" ||
    /courtyard/i.test(properties.name) ||
    /courtyard/i.test(properties.remoteId ?? "") ||
    /courtyard/i.test(properties.typeName)
  );
}

export function isClickableFloorFeature(properties: FloorFeatureProperties) {
  return Boolean(properties.locationId || properties.pointOfInterestId);
}

export function featureCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const coordinates = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat(1);
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const ring of coordinates) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

export function boundsForGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [[number, number], [number, number]] {
  const coordinates = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat(1);
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const ring of coordinates) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function boundsIntersect(left: MapBoundsTuple, right: MapBoundsTuple) {
  return !(
    left[1][0] < right[0][0] ||
    left[0][0] > right[1][0] ||
    left[1][1] < right[0][1] ||
    left[0][1] > right[1][1]
  );
}

export function boundsCenter(bounds: MapBoundsTuple): [number, number] {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

export function distanceMeters(left: [number, number], right: [number, number]) {
  const latFactor = 111_320;
  const lngFactor = 111_320 * Math.cos(((left[0] + right[0]) / 2) * (Math.PI / 180));
  return Math.hypot((left[0] - right[0]) * latFactor, (left[1] - right[1]) * lngFactor);
}

export function setSourceData(map: MapLibreInstance, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) {
    void source.setData(data);
  }
}
