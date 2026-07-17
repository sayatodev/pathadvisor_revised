"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type {
  CampusBootstrap,
  FloorData,
  PlaceDetail,
  RouteData,
  SearchPlace,
} from "@/lib/pathadvisor";
import { getDefaultFloorIdForBuilding, getFloorData } from "@/lib/pathadvisor";

const HKUST_CENTER: [number, number] = [22.3368, 114.2651];
const AUTO_FLOOR_MIN_ZOOM = 17.5;
const MAX_AUTO_BUILDINGS = 6;
const LABEL_ZOOM_LEVEL_2 = 18.2;
const LABEL_ZOOM_LEVEL_3 = 19.1;
const LABEL_COLLISION_FREE_ZOOM = 20;
const FLOOR_TYPE_ICON_PATHS: Partial<Record<string, string>> = {
  "Lift Shaft": "/floor-icons/elevator.png",
  Escalator: "/floor-icons/escalator.png",
  Staircase: "/floor-icons/staircase.png",
  "Drinking Fountain": "/floor-icons/drinking_fountain.png",
  "Toilet(Male)": "/floor-icons/toilet_male.png",
  "Toilet(Female)": "/floor-icons/toilet_female.png",
  "Toilet(Disable)": "/floor-icons/toilet_disabled.png",
};

type FloorFeatureProperties = {
  locationId?: string;
  pointOfInterestId?: string;
  name?: string;
  typeName?: string;
  colorHex?: string;
  typeDisplaySetting?: string;
};

type MapBoundsTuple = [[number, number], [number, number]];

type OSMMapProps = {
  bootstrap: CampusBootstrap | null;
  floorData: FloorData | null;
  interactionSource: "search" | "map";
  onAutoVisibleBuildingChange: (buildingId: string | null) => void;
  routeData: RouteData | null;
  selectedFloorId: string | null;
  selectedPlace: SearchPlace | null;
  placeDetail: PlaceDetail | null;
  focusedSegmentId: string | null;
  onSelectBuilding: (buildingId: string, name: string) => void;
  onSelectVenue: (venue: {
    id: string;
    kind: "location" | "point_of_interest";
    name: string;
    subtitle: string;
  }) => void;
};

function featureBounds(feature: GeoJSON.GeoJsonObject) {
  return L.geoJSON(feature as GeoJSON.FeatureCollection | GeoJSON.Feature).getBounds();
}

function featureCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  return L.geoJSON({
    type: "Feature",
    geometry,
    properties: {},
  } as GeoJSON.Feature).getBounds().getCenter();
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

function geometryAreaHint(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  walkCoordinates(geometry.coordinates, ([lat, lng]) => {
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  });

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) {
    return 0;
  }

  const latMeters = (maxLat - minLat) * 111_320;
  const lngMeters =
    (maxLng - minLng) * 111_320 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));

  return Math.max(0, latMeters * lngMeters);
}

function pointInRing(point: [number, number], ring: number[][]) {
  let inside = false;
  const [lat, lng] = point;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const currentPoint = ring[current];
    const previousPoint = ring[previous];

    const currentLng = currentPoint[0];
    const currentLat = currentPoint[1];
    const previousLng = previousPoint[0];
    const previousLat = previousPoint[1];

    const intersects =
      currentLat > lat !== previousLat > lat &&
      lng <
        ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) +
          currentLng;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInGeometry(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const polygon of polygons) {
    const [outerRing, ...holes] = polygon;

    if (!outerRing || !pointInRing(point, outerRing)) {
      continue;
    }

    if (holes.some((hole) => pointInRing(point, hole))) {
      continue;
    }

    return true;
  }

  return false;
}

function ringCentroid(ring: number[][]) {
  let areaAccumulator = 0;
  let lngAccumulator = 0;
  let latAccumulator = 0;

  for (let current = 0; current < ring.length - 1; current += 1) {
    const [currentLng, currentLat] = ring[current];
    const [nextLng, nextLat] = ring[current + 1];
    const cross = currentLng * nextLat - nextLng * currentLat;

    areaAccumulator += cross;
    lngAccumulator += (currentLng + nextLng) * cross;
    latAccumulator += (currentLat + nextLat) * cross;
  }

  if (Math.abs(areaAccumulator) < 1e-12) {
    const lngAverage = ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length;
    const latAverage = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    return [latAverage, lngAverage] as [number, number];
  }

  const area = areaAccumulator / 2;
  return [
    latAccumulator / (6 * area),
    lngAccumulator / (6 * area),
  ] as [number, number];
}

function geometryBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): MapBoundsTuple | null {
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  walkCoordinates(geometry.coordinates, ([lat, lng]) => {
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

function labelPointWithinGeometry(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const bounds = geometryBounds(geometry);

  if (!bounds) {
    const center = featureCenter(geometry);
    return [center.lat, center.lng] as [number, number];
  }

  const boundsMidpoint = boundsCenter(bounds);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const candidates: [number, number][] = [boundsMidpoint];

  for (const polygon of polygons) {
    const [outerRing] = polygon;

    if (!outerRing || outerRing.length < 4) {
      continue;
    }

    candidates.push(ringCentroid(outerRing));

    const ringBounds = geometryBounds({
      type: "Polygon",
      coordinates: [outerRing],
    });

    if (ringBounds) {
      candidates.push(boundsCenter(ringBounds));
    }
  }

  const insideCandidates = candidates.filter((candidate) => pointInGeometry(candidate, geometry));

  if (insideCandidates.length > 0) {
    return insideCandidates.sort(
      (left, right) =>
        distanceMeters(left, boundsMidpoint) - distanceMeters(right, boundsMidpoint),
    )[0];
  }

  let bestPoint: [number, number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let searchBounds = bounds;

  for (let pass = 0; pass < 3; pass += 1) {
    const latStep = (searchBounds[1][0] - searchBounds[0][0]) / 6;
    const lngStep = (searchBounds[1][1] - searchBounds[0][1]) / 6;

    for (let row = 0; row <= 6; row += 1) {
      for (let column = 0; column <= 6; column += 1) {
        const candidate: [number, number] = [
          searchBounds[0][0] + latStep * row,
          searchBounds[0][1] + lngStep * column,
        ];

        if (!pointInGeometry(candidate, geometry)) {
          continue;
        }

        const candidateDistance = distanceMeters(candidate, boundsMidpoint);

        if (candidateDistance < bestDistance) {
          bestPoint = candidate;
          bestDistance = candidateDistance;
        }
      }
    }

    if (!bestPoint) {
      continue;
    }

    searchBounds = [
      [
        Math.max(bounds[0][0], bestPoint[0] - latStep),
        Math.max(bounds[0][1], bestPoint[1] - lngStep),
      ],
      [
        Math.min(bounds[1][0], bestPoint[0] + latStep),
        Math.min(bounds[1][1], bestPoint[1] + lngStep),
      ],
    ];
  }

  if (bestPoint) {
    return bestPoint;
  }

  const center = featureCenter(geometry);
  return [center.lat, center.lng] as [number, number];
}

function boundsIntersect(left: MapBoundsTuple, right: MapBoundsTuple) {
  return !(
    left[1][0] < right[0][0] ||
    left[0][0] > right[1][0] ||
    left[1][1] < right[0][1] ||
    left[0][1] > right[1][1]
  );
}

function boundsCenter(bounds: MapBoundsTuple): [number, number] {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

function isClickableFloorFeature(
  properties:
    | {
        locationId?: string;
        pointOfInterestId?: string;
      }
    | undefined,
) {
  return Boolean(properties?.locationId || properties?.pointOfInterestId);
}

function normalizeColorHex(colorHex: string | undefined) {
  const normalized = colorHex?.trim().replace(/^#/, "").toUpperCase() ?? "";
  return normalized.length === 6 ? `#${normalized}` : null;
}

function isPathwayLikeFeature(
  properties:
    | {
        name?: string;
        typeName?: string;
        colorHex?: string;
      }
    | undefined,
) {
  const normalizedType = properties?.typeName?.trim().toLowerCase() ?? "";
  const normalizedName = properties?.name?.trim().toUpperCase() ?? "";
  const normalizedColorHex = properties?.colorHex?.trim().toUpperCase() ?? "";

  if (normalizedColorHex === "F9FCFF" || normalizedColorHex === "FFFFFF") {
    return true;
  }

  if (
    normalizedType.includes("corridor") ||
    normalizedType.includes("pathway") ||
    normalizedType.includes("hallway") ||
    normalizedType.includes("passage") ||
    normalizedType.includes("walkway") ||
    normalizedType.includes("concourse")
  ) {
    return true;
  }

  return (
    /^GAT\d+[A-Z]*$/.test(normalizedName) ||
    /^[A-Z]*COR\d+[A-Z]*$/.test(normalizedName) ||
    /^[A-Z]*CONCOURSE\d+[A-Z]*$/.test(normalizedName)
  );
}

function isMajorRoomFeature(
  properties: FloorFeatureProperties | undefined,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
) {
  const normalizedType = properties?.typeName?.trim().toLowerCase() ?? "";
  const areaHint = geometryAreaHint(geometry);

  return (
    normalizedType.includes("classroom") ||
    normalizedType.includes("canteen") ||
    normalizedType.includes("library") ||
    normalizedType.includes("performance hall") ||
    normalizedType.includes("indoor sports") ||
    normalizedType.includes("foyer") ||
    normalizedType.includes("lounge") ||
    normalizedType.includes("shop") ||
    normalizedType.includes("entrance") ||
    areaHint > 650
  );
}

function labelMinZoom(
  properties: FloorFeatureProperties | undefined,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
) {
  const normalizedType = properties?.typeName?.trim().toLowerCase() ?? "";

  if (normalizedType === "lift shaft") {
    return Number.POSITIVE_INFINITY;
  }

  if (isPathwayLikeFeature(properties)) {
    return Number.POSITIVE_INFINITY;
  }

  if (iconPathForType(properties?.typeName) && normalizedType !== "escalator") {
    return LABEL_ZOOM_LEVEL_3;
  }

  if (normalizedType === "escalator") {
    return LABEL_ZOOM_LEVEL_2;
  }

  if (isMajorRoomFeature(properties, geometry)) {
    return LABEL_ZOOM_LEVEL_2;
  }

  return LABEL_ZOOM_LEVEL_3;
}

function labelPriority(
  properties: FloorFeatureProperties | undefined,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
) {
  const displaySetting = properties?.typeDisplaySetting ?? "";
  const normalizedType = properties?.typeName?.trim().toLowerCase() ?? "";
  const areaHint = geometryAreaHint(geometry);
  // Floor area is deliberately weighted strongly so a large venue keeps its label
  // when it competes with many nearby rooms.
  let priority = Math.min(10, areaHint / 120) + Math.log10(areaHint + 10);

  if (displaySetting === "show_icon") {
    priority += 8;
  } else if (displaySetting === "show_location_name") {
    priority += 5;
  }

  if (
    normalizedType.includes("lift") ||
    normalizedType.includes("canteen") ||
    normalizedType.includes("toilet") ||
    normalizedType.includes("library")
  ) {
    priority += 5;
  }

  if (isPathwayLikeFeature(properties)) {
    priority += 2.5;
  }

  return priority;
}

type LabelCollisionBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function labelCollisionBox(center: [number, number], label: string, zoom: number): LabelCollisionBox {
  const point = L.CRS.EPSG3857.latLngToPoint(L.latLng(center[0], center[1]), zoom);
  const padding =
    zoom >= LABEL_COLLISION_FREE_ZOOM ? 8 : zoom >= 19.4 ? 12 : zoom >= 18.2 ? 18 : 24;
  const width = Math.min(120, Math.max(32, label.length * 7.2)) + padding * 2;
  const height = 18 + padding * 2;

  return {
    left: point.x - width / 2,
    right: point.x + width / 2,
    top: point.y - height / 2,
    bottom: point.y + height / 2,
  };
}

function collisionBoxesOverlap(left: LabelCollisionBox, right: LabelCollisionBox) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

function floorStyle({
  isClickable,
  isPathwayLike,
  isSelected,
  colorHex,
}: {
  isClickable: boolean;
  isPathwayLike: boolean;
  isSelected: boolean;
  colorHex?: string;
}) {
  if (isSelected) {
    return {
      color: "#64748b",
      weight: 1.05,
      fillColor: "#7dd3fc",
      fillOpacity: 1,
    };
  }

  const upstreamFillColor = normalizeColorHex(colorHex);

  if (isPathwayLike) {
    return {
      color: "#cbd5e1",
      weight: 0.38,
      fillColor: upstreamFillColor ?? "#ffffff",
      fillOpacity: 1,
    };
  }

  if (isClickable) {
    return {
      color: "#64748b",
      weight: 0.7,
      fillColor: upstreamFillColor ?? "#d1d5db",
      fillOpacity: 1,
    };
  }

  return {
    color: "#cbd5e1",
    weight: 0.38,
    fillColor: upstreamFillColor ?? "#ffffff",
    fillOpacity: 1,
  };
}

function iconPathForType(typeName: string | undefined) {
  return typeName ? FLOOR_TYPE_ICON_PATHS[typeName] ?? null : null;
}

function createLiftIcon(label: string) {
  const visibleLabel = label === "↕" ? "Lift" : `Lift ${label}`;
  const iconPath = FLOOR_TYPE_ICON_PATHS["Lift Shaft"];

  return L.divIcon({
    className: "pathadvisor-lift-icon",
    html: `
      <div class="pathadvisor-lift-marker" aria-label="${visibleLabel}">
        <span class="pathadvisor-lift-badge" aria-hidden="true">
          <img src="${iconPath}" alt="" class="pathadvisor-facility-img" style="width:22px;height:22px;display:block;" />
        </span>
        <span class="pathadvisor-lift-label" style="color:#a5c3f2;">${visibleLabel}</span>
      </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function createFacilityIcon({
  typeName,
  label,
}: {
  typeName: string;
  label: string;
}) {
  const iconPath = iconPathForType(typeName);

  if (!iconPath) {
    return null;
  }

  return L.divIcon({
    className: "pathadvisor-facility-icon",
    html: `
      <div class="pathadvisor-facility-marker" aria-label="${label}">
        <span class="pathadvisor-facility-badge" aria-hidden="true">
          <img src="${iconPath}" alt="" class="pathadvisor-facility-img" style="width:22px;height:22px;display:block;" />
        </span>
      </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function createVenueLabelIcon(label: string) {
  return L.divIcon({
    className: "pathadvisor-venue-label-icon",
    html: `<div class="pathadvisor-venue-label">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function toFloorGeoJson(floorData: FloorData): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: floorData.features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry,
      properties: feature.properties,
    })),
  };
}

function compressLiftNumbers(labels: string[]) {
  const numbers = labels
    .map((label) => {
      const match = label.match(/(\d+)/);
      return match ? Number.parseInt(match[1], 10) : null;
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (numbers.length === 0) {
    return "↕";
  }

  if (numbers.length === 1) {
    return String(numbers[0]);
  }

  const ranges: string[] = [];
  let rangeStart = numbers[0];
  let previous = numbers[0];

  for (let index = 1; index < numbers.length; index += 1) {
    const current = numbers[index];

    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
  return ranges.join(",");
}

function distanceMeters(left: [number, number], right: [number, number]) {
  const latFactor = 111_320;
  const lngFactor = 111_320 * Math.cos(((left[0] + right[0]) / 2) * (Math.PI / 180));
  const deltaLat = (left[0] - right[0]) * latFactor;
  const deltaLng = (left[1] - right[1]) * lngFactor;
  return Math.hypot(deltaLat, deltaLng);
}

function ViewportController({
  bootstrap,
  disableVenueFocus,
  routeData,
  selectedPlace,
  placeDetail,
  focusedSegmentId,
}: Pick<
  OSMMapProps,
  "bootstrap" | "routeData" | "selectedPlace" | "placeDetail" | "focusedSegmentId"
> & {
  disableVenueFocus: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (routeData) {
      const focusedSegment =
        routeData.segments.find((segment) => segment.id === focusedSegmentId) ??
        routeData.segments.find((segment) => segment.coordinates.length > 1);

      if (focusedSegment && focusedSegment.coordinates.length > 0) {
        map.fitBounds(focusedSegment.coordinates, {
          padding: [72, 72],
          maxZoom: 19.8,
        });
      }

      return;
    }

    if (placeDetail?.coordinates && !disableVenueFocus) {
      map.flyTo(placeDetail.coordinates, 19.2, {
        animate: true,
        duration: 0.7,
      });
      return;
    }

    if (selectedPlace?.kind === "building" && bootstrap) {
      const footprint = bootstrap.footprints.features.find(
        (feature) => feature.properties.buildingId === selectedPlace.id,
      );

      if (footprint) {
        const bounds = featureBounds(footprint);
        const padding = L.point(84, 84);
        const targetZoom = Math.min(map.getBoundsZoom(bounds, false, padding), 18.8);

        if (targetZoom > map.getZoom()) {
          map.fitBounds(bounds, {
            padding: [84, 84],
            maxZoom: 18.8,
          });
        } else {
          map.panTo(bounds.getCenter(), { animate: true });
        }

        return;
      }
    }
  }, [
    bootstrap,
    disableVenueFocus,
    focusedSegmentId,
    map,
    placeDetail,
    routeData,
    selectedPlace,
  ]);

  return null;
}

function ViewportWatcher({
  onZoomChange,
  onBoundsChange,
}: {
  onZoomChange: (zoom: number) => void;
  onBoundsChange: (bounds: MapBoundsTuple) => void;
}) {
  const map = useMapEvents({
    zoomend: () => {
      const bounds = map.getBounds();
      onZoomChange(map.getZoom());
      onBoundsChange([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ]);
    },
    moveend: () => {
      const bounds = map.getBounds();
      onZoomChange(map.getZoom());
      onBoundsChange([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ]);
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onZoomChange(map.getZoom());
    onBoundsChange([
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
    ]);
  }, [map, onBoundsChange, onZoomChange]);

  return null;
}

function FloorLayer({
  floorData,
  selectedLocationId,
  selectedPointOfInterestId,
  onSelectVenue,
}: {
  floorData: FloorData;
  selectedLocationId?: string;
  selectedPointOfInterestId?: string;
  onSelectVenue: OSMMapProps["onSelectVenue"];
}) {
  const floorGeoJson = useMemo(() => toFloorGeoJson(floorData), [floorData]);

  const isFeatureSelected = (properties: FloorFeatureProperties | undefined) =>
    (Boolean(selectedLocationId) && properties?.locationId === selectedLocationId) ||
    (Boolean(selectedPointOfInterestId) &&
      properties?.pointOfInterestId === selectedPointOfInterestId);

  return (
    <GeoJSON
      key={`floor-${floorData.id}`}
      data={floorGeoJson}
      style={(feature) => {
        const properties = feature?.properties as FloorFeatureProperties | undefined;
        const isSelected = isFeatureSelected(properties);
        const isClickable = isClickableFloorFeature(properties);
        const isPathwayLike = isPathwayLikeFeature(properties);

        return floorStyle({
          isClickable,
          isPathwayLike,
          isSelected,
          colorHex: properties?.colorHex,
        });
      }}
      onEachFeature={(feature, layer) => {
        const properties = feature.properties as FloorFeatureProperties | undefined;
        const isClickable = isClickableFloorFeature(properties);
        const isPathwayLike = isPathwayLikeFeature(properties);

        if (isClickable) {
          layer.on("click", () => {
            layer.closeTooltip?.();
            layer.unbindTooltip?.();
            if (properties?.locationId) {
              onSelectVenue({
                id: properties.locationId,
                kind: "location",
                name: properties.name || "Venue",
                subtitle: properties.typeName || "Location",
              });
            } else if (properties?.pointOfInterestId) {
              onSelectVenue({
                id: properties.pointOfInterestId,
                kind: "point_of_interest",
                name: properties.name || "Point of interest",
                subtitle: properties.typeName || "Point of interest",
              });
            }
          });
        }

        layer.on("mouseover", () => {
          if (!isClickable || isPathwayLike) {
            return;
          }

        (layer as L.Path).setStyle({
          color: "#475569",
          weight: 1,
          fillOpacity: 1,
        });
      });

        layer.on("mouseout", () => {
          (layer as L.Path).setStyle(
            floorStyle({
              isClickable,
              isPathwayLike,
              isSelected: isFeatureSelected(properties),
              colorHex: properties?.colorHex,
            }),
          );
        });
      }}
    />
  );
}

export function OSMMap(props: OSMMapProps) {
  const [rotationReady, setRotationReady] = useState(false);
  const [rotationEnabled, setRotationEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const leafletWindow = window as typeof window & { L?: typeof L };
    leafletWindow.L = L;

    void import("leaflet-rotate")
      .then(() => {
        if (!cancelled) {
          setRotationEnabled(true);
          setRotationReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRotationReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!rotationReady) {
    return <div className="absolute inset-0 bg-[#d6e7f5]" />;
  }

  return <RotatableOSMMap {...props} rotationEnabled={rotationEnabled} />;
}

function RotatableOSMMap({
  bootstrap,
  floorData,
  interactionSource,
  onAutoVisibleBuildingChange,
  routeData,
  selectedFloorId,
  selectedPlace,
  placeDetail,
  focusedSegmentId,
  onSelectBuilding,
  onSelectVenue,
  rotationEnabled,
}: OSMMapProps & { rotationEnabled: boolean }) {
  const [zoomLevel, setZoomLevel] = useState(16);
  const [viewportBounds, setViewportBounds] = useState<MapBoundsTuple | null>(null);
  const [autoFloorDataByBuilding, setAutoFloorDataByBuilding] = useState<
    Record<string, FloorData>
  >({});

  const selectedLocationId =
    selectedPlace?.kind === "location" ? selectedPlace.id : placeDetail?.kind === "location" ? placeDetail.id : undefined;
  const selectedPointOfInterestId =
    selectedPlace?.kind === "point_of_interest"
      ? selectedPlace.id
      : placeDetail?.kind === "point_of_interest"
        ? placeDetail.id
        : undefined;
  const disableVenueFocusEffects =
    interactionSource === "map" &&
    (selectedPlace?.kind === "location" || selectedPlace?.kind === "point_of_interest");
  const activeBuildingId =
    selectedPlace?.kind === "building"
      ? selectedPlace.id
      : selectedPlace?.buildingId ?? placeDetail?.buildingId ?? null;

  const visibleSegments = useMemo(
    () =>
      routeData?.segments.filter((segment) =>
        selectedFloorId ? segment.floorId === selectedFloorId || segment.coordinates.length === 0 : true,
      ) ?? [],
    [routeData, selectedFloorId],
  );

  const buildingBounds = useMemo(
    () =>
      bootstrap?.footprints.features.map((feature) => {
        const bounds = featureBounds(feature);

        return {
          buildingId: feature.properties.buildingId,
          mapBounds: [
            [bounds.getSouth(), bounds.getWest()],
            [bounds.getNorth(), bounds.getEast()],
          ] as MapBoundsTuple,
        };
      }) ?? [],
    [bootstrap],
  );

  const visibleAutoBuildings = useMemo(() => {
    if (!viewportBounds || zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      return [];
    }

    const viewportCenter = boundsCenter(viewportBounds);

    return buildingBounds
      .filter((building) => boundsIntersect(viewportBounds, building.mapBounds))
      .sort((left, right) => {
        const leftCenter = boundsCenter(left.mapBounds);
        const rightCenter = boundsCenter(right.mapBounds);
        return (
          distanceMeters(viewportCenter, leftCenter) - distanceMeters(viewportCenter, rightCenter)
        );
      })
      .slice(0, MAX_AUTO_BUILDINGS);
  }, [buildingBounds, viewportBounds, zoomLevel]);

  useEffect(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      onAutoVisibleBuildingChange(null);
      return;
    }

    onAutoVisibleBuildingChange(
      visibleAutoBuildings.length === 1 ? visibleAutoBuildings[0].buildingId : null,
    );
  }, [onAutoVisibleBuildingChange, visibleAutoBuildings, zoomLevel]);

  useEffect(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM || visibleAutoBuildings.length === 0) {
      return;
    }

    let cancelled = false;

    const loadAutoFloors = async () => {
      const entries = await Promise.all(
        visibleAutoBuildings.map(async (building) => {
          try {
            const defaultFloorId = await getDefaultFloorIdForBuilding(building.buildingId);

            if (!defaultFloorId) {
              return null;
            }

            const data = await getFloorData(defaultFloorId);
            return [building.buildingId, data] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setAutoFloorDataByBuilding(
        Object.fromEntries(
          entries.filter((entry): entry is readonly [string, FloorData] => entry !== null),
        ),
      );
    };

    void loadAutoFloors();

    return () => {
      cancelled = true;
    };
  }, [visibleAutoBuildings, zoomLevel]);

  const autoFloorLayers = useMemo(
    () => {
      if (zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
        return [];
      }

      const visibleBuildingIds = new Set(
        visibleAutoBuildings.map((building) => building.buildingId),
      );

      return Object.entries(autoFloorDataByBuilding)
        .filter(([buildingId]) => visibleBuildingIds.has(buildingId))
        .filter(([buildingId]) => buildingId !== activeBuildingId)
        .map(([, autoFloor]) => autoFloor)
        .filter((autoFloor) => autoFloor.id !== floorData?.id);
    },
    [activeBuildingId, autoFloorDataByBuilding, floorData?.id, visibleAutoBuildings, zoomLevel],
  );

  const liftFeatures = useMemo(
    () =>
      [floorData, ...autoFloorLayers].flatMap((layer) =>
        layer?.features.filter((feature) => feature.properties.typeName === "Lift Shaft") ?? [],
      ),
    [autoFloorLayers, floorData],
  );

  const mergedLiftGroups = useMemo(() => {
    const groups: Array<{
      center: [number, number];
      label: string;
      names: string[];
    }> = [];

    for (const feature of liftFeatures) {
      const center = featureCenter(feature.geometry);
      const point: [number, number] = [center.lat, center.lng];
      const existingGroup = groups.find((group) => distanceMeters(group.center, point) < 7);

      if (existingGroup) {
        existingGroup.names.push(feature.properties.name || "Lift");
        existingGroup.label = compressLiftNumbers(existingGroup.names);
        continue;
      }

      groups.push({
        center: point,
        names: [feature.properties.name || "Lift"],
        label: compressLiftNumbers([feature.properties.name || "Lift"]),
      });
    }

    return groups;
  }, [liftFeatures]);

  const visibleFacilityIcons = useMemo(() => {
    if (zoomLevel < LABEL_ZOOM_LEVEL_2) {
      return [];
    }

    const layers = [floorData, ...autoFloorLayers].filter(
      (layer): layer is FloorData => Boolean(layer),
    );
    const seen = new Set<string>();

    return layers.flatMap((layer) =>
      layer.features.flatMap((feature) => {
        if (feature.properties.typeName === "Lift Shaft") {
          return [];
        }

        const iconPath = iconPathForType(feature.properties.typeName);

        if (!iconPath) {
          return [];
        }

        const iconMinZoom =
          feature.properties.typeName === "Escalator"
            ? LABEL_ZOOM_LEVEL_2
            : LABEL_ZOOM_LEVEL_3;

        if (zoomLevel < iconMinZoom) {
          return [];
        }

        const dedupeKey =
          feature.properties.locationId ||
          feature.properties.pointOfInterestId ||
          feature.properties.remoteId ||
          `${layer.id}:${feature.id}`;

        if (seen.has(dedupeKey)) {
          return [];
        }

        seen.add(dedupeKey);

        const markerCenter = labelPointWithinGeometry(feature.geometry);
        const icon = createFacilityIcon({
          typeName: feature.properties.typeName,
          label: feature.properties.name || feature.properties.typeName,
        });

        if (!icon) {
          return [];
        }

        return [
          {
            id: dedupeKey,
            center: markerCenter,
            icon,
          },
        ];
      }),
    );
  }, [autoFloorLayers, floorData, zoomLevel]);

  const visibleVenueLabels = useMemo(() => {
    if (zoomLevel < 16.8) {
      return [];
    }

    const layers = [floorData, ...autoFloorLayers].filter(
      (layer): layer is FloorData => Boolean(layer),
    );

    if (layers.length === 0) {
      return [];
    }

    const dedupedFeatures: Array<{
      dedupeKey: string;
      featureId: string;
      geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
      properties: FloorData["features"][number]["properties"];
    }> = [];
    const seen = new Set<string>();

    for (const layer of layers) {
      for (const feature of layer.features) {
        const dedupeKey =
          feature.properties.locationId ||
          feature.properties.pointOfInterestId ||
          feature.properties.remoteId ||
          `${layer.id}:${feature.id}`;

        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        dedupedFeatures.push({
          dedupeKey,
          featureId: feature.id,
          geometry: feature.geometry,
          properties: feature.properties,
        });
      }
    }

    const eligibleFeatures = dedupedFeatures.filter((feature) => {
      const label = feature.properties.name.trim();
      return (
        label &&
        !iconPathForType(feature.properties.typeName) &&
        labelMinZoom(feature.properties, feature.geometry) <= zoomLevel &&
        feature.properties.typeName !== "Lift Shaft"
      );
    });

    const maxLabels =
      zoomLevel >= LABEL_COLLISION_FREE_ZOOM
        ? Number.POSITIVE_INFINITY
        : zoomLevel >= 19.4
          ? 220
          : zoomLevel >= 18.9
            ? 120
            : zoomLevel >= 18.2
              ? 70
              : zoomLevel >= 17.5
                ? 28
                : 12;

    const sortedFeatures = eligibleFeatures.sort(
      (left, right) =>
        labelPriority(right.properties, right.geometry) -
        labelPriority(left.properties, left.geometry),
    );

    const cappedFeatures =
      maxLabels === Number.POSITIVE_INFINITY
        ? sortedFeatures
        : sortedFeatures.slice(0, maxLabels);

    if (zoomLevel >= LABEL_COLLISION_FREE_ZOOM) {
      return cappedFeatures.map((feature) => ({
        id: feature.dedupeKey,
        center: labelPointWithinGeometry(feature.geometry),
        label: feature.properties.name,
      }));
    }

    const occupiedLabelBoxes: LabelCollisionBox[] = [];

    return cappedFeatures.flatMap((feature) => {
      const center = labelPointWithinGeometry(feature.geometry);
      const label = feature.properties.name;
      const collisionBox = labelCollisionBox(center, label, zoomLevel);

      if (
        occupiedLabelBoxes.some((occupiedBox) =>
          collisionBoxesOverlap(occupiedBox, collisionBox),
        )
      ) {
        return [];
      }

      occupiedLabelBoxes.push(collisionBox);

      return [
        {
          id: feature.dedupeKey,
          center,
          label,
        },
      ];
    });
  }, [autoFloorLayers, floorData, zoomLevel]);

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={HKUST_CENTER}
        zoom={16}
        maxZoom={22}
        rotate={rotationEnabled}
        touchRotate={rotationEnabled}
        rotateControl={false}
        shiftKeyRotate={false}
        zoomControl={false}
        attributionControl
        className="h-full w-full"
      >
        <ZoomControl position="bottomright" />
        <ViewportWatcher
          onZoomChange={setZoomLevel}
          onBoundsChange={setViewportBounds}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={22}
        />

        {bootstrap ? (
          <GeoJSON
            key="campus-footprints"
            data={bootstrap.footprints}
            style={(feature) => ({
              color:
                feature?.properties?.buildingId === placeDetail?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.id
                  ? "#334155"
                  : "#475569",
              weight:
                feature?.properties?.buildingId === placeDetail?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.id
                  ? 1.45
                  : 0.9,
              fillColor:
                feature?.properties?.buildingId === placeDetail?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.id
                  ? "#4b5563"
                  : "#374151",
              fillOpacity:
                feature?.properties?.buildingId === placeDetail?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.buildingId ||
                feature?.properties?.buildingId === selectedPlace?.id
                  ? 0.98
                  : 0.92,
            })}
            onEachFeature={(feature, layer) => {
              layer.on("click", () => {
                onSelectBuilding(feature.properties.buildingId, feature.properties.name);
              });
            }}
          />
        ) : null}

        {autoFloorLayers.map((autoFloor) => (
          <FloorLayer
            key={`auto-floor-${autoFloor.id}`}
            floorData={autoFloor}
            selectedLocationId={disableVenueFocusEffects ? undefined : selectedLocationId}
            selectedPointOfInterestId={
              disableVenueFocusEffects ? undefined : selectedPointOfInterestId
            }
            onSelectVenue={onSelectVenue}
          />
        ))}

        {floorData ? (
          <FloorLayer
            key={`selected-floor-${floorData.id}`}
            floorData={floorData}
            selectedLocationId={disableVenueFocusEffects ? undefined : selectedLocationId}
            selectedPointOfInterestId={
              disableVenueFocusEffects ? undefined : selectedPointOfInterestId
            }
            onSelectVenue={onSelectVenue}
          />
        ) : null}

        {mergedLiftGroups.map((group) => {
          return (
            <Marker
              key={`lift-${group.label}-${group.center[0]}-${group.center[1]}`}
              position={group.center}
              icon={createLiftIcon(group.label)}
            />
          );
        })}

        {visibleFacilityIcons.map((feature) => (
          <Marker
            key={`facility-icon-${feature.id}`}
            position={feature.center}
            icon={feature.icon}
            interactive={false}
          />
        ))}

        {visibleVenueLabels.map((feature) => (
          <Marker
            key={`label-${feature.id}`}
            position={feature.center}
            icon={createVenueLabelIcon(feature.label)}
            interactive={false}
          />
        ))}

        {routeData
          ? visibleSegments
              .filter((segment) => segment.coordinates.length > 1)
              .map((segment) => (
                <Polyline
                  key={segment.id}
                  positions={segment.coordinates}
                  pathOptions={{
                    color: segment.id === focusedSegmentId ? "#0f172a" : "#0ea5e9",
                    opacity: segment.id === focusedSegmentId ? 0.96 : 0.8,
                    weight: segment.id === focusedSegmentId ? 7 : 5,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              ))
          : null}

        {placeDetail?.coordinates && !disableVenueFocusEffects ? (
          <CircleMarker
            center={placeDetail.coordinates}
            radius={8}
            pathOptions={{
              color: "#ffffff",
              fillColor: "#0f172a",
              fillOpacity: 1,
              weight: 3,
            }}
          />
        ) : null}

        <ViewportController
          bootstrap={bootstrap}
          disableVenueFocus={disableVenueFocusEffects}
          focusedSegmentId={focusedSegmentId}
          placeDetail={placeDetail}
          routeData={routeData}
          selectedPlace={selectedPlace}
        />
      </MapContainer>
    </div>
  );
}
