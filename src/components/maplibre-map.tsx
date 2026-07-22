"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreInstance,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from "maplibre-gl";
import type {
  CampusBootstrap,
  FloorData,
  PlaceDetail,
  RouteData,
  SearchPlace,
} from "@/lib/pathadvisor";
import { getDefaultFloorIdForBuilding, getFloorData } from "@/lib/pathadvisor";
import { parseCampusAreaCode } from "@/lib/venue-display";

const HKUST_CENTER: [number, number] = [114.2651, 22.3368];
const AUTO_FLOOR_MIN_ZOOM = 16.5;
const MAX_AUTO_BUILDINGS = 6;
const BUILDING_FLOOR_FOCUS_ZOOM = 18.8;
const VENUE_FOCUS_ZOOM = 19.2;
const MAP_TAP_MIN_FOCUS_ZOOM = 17;
const ROUTE_CONNECTOR_MIN_DISTANCE_METERS = 5;
const ROUTE_CONNECTOR_DOT_SPACING_METERS = 4;
const ROUTE_TRANSITION_COMPACT_ZOOM = 17.5;

const SOURCE_IDS = {
  campus: "campus-footprints",
  autoFloors: "auto-floors",
  selectedFloor: "selected-floor",
  lifts: "lifts",
  facilities: "facilities",
  labels: "venue-labels",
  focusedLabel: "focused-venue-label",
  routes: "routes",
} as const;

const LAYER_IDS = {
  campusFill: "campus-fill",
  campusOutline: "campus-outline",
  autoFloorFill: "auto-floor-fill",
  autoFloorOutline: "auto-floor-outline",
  selectedFloorFill: "selected-floor-fill",
  selectedFloorOutline: "selected-floor-outline",
  routeContextOutline: "route-context-outline",
  routeContextLine: "route-context-line",
  routeConnectorDots: "route-connector-dots",
  routeOutline: "route-outline",
  routeLine: "route-line",
  liftIcons: "lift-icons",
  facilityIcons: "facility-icons",
  venueLabels: "venue-labels",
  focusedVenueLabel: "focused-venue-label",
} as const;

const FACILITY_ICONS: Record<string, string> = {
  "Lift Shaft": "/floor-icons/elevator.png",
  Escalator: "/floor-icons/escalator.png",
  Staircase: "/floor-icons/staircase.png",
  "Drinking Fountain": "/floor-icons/drinking_fountain.png",
  "Toilet(Male)": "/floor-icons/toilet_male.png",
  "Toilet(Female)": "/floor-icons/toilet_female.png",
  "Toilet(Disable)": "/floor-icons/toilet_disabled.png",
};

const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: { "raster-resampling": "linear" },
    },
  ],
};

type MapBoundsTuple = [[number, number], [number, number]];
type FloorFeatureProperties = FloorData["features"][number]["properties"];

type MapLibreMapProps = {
  bootstrap: CampusBootstrap | null;
  floorData: FloorData | null;
  focusedBuildingId: string | null;
  isFloorSelectorVisible: boolean;
  onAutoVisibleBuildingChange: (buildingId: string | null) => void;
  routeData: RouteData | null;
  selectedFloorId: string | null;
  selectedPlace: SearchPlace | null;
  venueFocusRequest: number;
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

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function normalizeColorHex(colorHex: string | undefined, fallback: string) {
  const normalized = colorHex?.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized ?? "") ? `#${normalized}` : fallback;
}

function darkenColorHex(colorHex: string, amount: number) {
  const normalized = colorHex.slice(1);
  const channel = (offset: number) =>
    Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function isPathwayLikeFeature(properties: FloorFeatureProperties) {
  const typeName = properties.typeName?.trim().toLowerCase() ?? "";
  return typeName.includes("path") || typeName.includes("corridor") || typeName.includes("walkway");
}

function isCourtyardFeature(properties: FloorFeatureProperties) {
  return (
    parseCampusAreaCode(properties.name)?.kind === "Courtyard" ||
    /courtyard/i.test(properties.name) ||
    /courtyard/i.test(properties.remoteId ?? "") ||
    /courtyard/i.test(properties.typeName)
  );
}

function isClickableFloorFeature(properties: FloorFeatureProperties) {
  return Boolean(properties.locationId || properties.pointOfInterestId);
}

function featureCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
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

function boundsForGeometry(
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

function distanceMeters(left: [number, number], right: [number, number]) {
  const latFactor = 111_320;
  const lngFactor = 111_320 * Math.cos(((left[0] + right[0]) / 2) * (Math.PI / 180));
  return Math.hypot((left[0] - right[0]) * latFactor, (left[1] - right[1]) * lngFactor);
}

function setSourceData(map: MapLibreInstance, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) {
    void source.setData(data);
  }
}

function floorCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.map((feature) => {
        const isCourtyard = isCourtyardFeature(feature.properties);
        const fillColor = normalizeColorHex(
          isCourtyard ? "#a8e6b6" : feature.properties.colorHex,
          isPathwayLikeFeature(feature.properties) ? "#ffffff" : "#d1d5db",
        );
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);

        return {
          type: "Feature" as const,
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            ...feature.properties,
            fillColor,
            selectedFillColor: darkenColorHex(fillColor, 0.22),
            selectedOutlineColor: darkenColorHex(fillColor, 0.42),
            isCourtyard,
            isSelected,
            isClickable: isClickableFloorFeature(feature.properties),
            isPathway: isPathwayLikeFeature(feature.properties),
          },
        };
      })),
  };
}

function facilityCollection(floors: FloorData[]) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const icon = FACILITY_ICONS[feature.properties.typeName];
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          feature.properties.remoteId ??
          `${floor.id}:${feature.id}`;

        if (feature.properties.typeName === "Lift Shaft" || !icon || seen.has(dedupeKey)) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: {
              icon: `facility-${feature.properties.typeName}`,
              name: feature.properties.name || feature.properties.typeName,
            },
          },
        ];
      }),
    ),
  };
}

function compressLiftNumbers(labels: string[]) {
  const numbers = Array.from(
    new Set(
      labels
        .map((label) => {
          const match = label.match(/(\d+)/);
          return match ? Number.parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null),
    ),
  ).sort((left, right) => left - right);

  if (numbers.length === 0) {
    return "Lift";
  }

  const ranges: string[] = [];
  let rangeStart = numbers[0];
  let previous = numbers[0];

  for (const current of numbers.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
  return `Lift ${ranges.join(",")}`;
}

function liftCollection(floors: FloorData[]) {
  const groups: Array<{ center: [number, number]; names: string[] }> = [];

  for (const floor of floors) {
    for (const feature of floor.features) {
      if (feature.properties.typeName !== "Lift Shaft") {
        continue;
      }

      const [lng, lat] = featureCenter(feature.geometry);
      const center: [number, number] = [lat, lng];
      const group = groups.find((entry) => distanceMeters(entry.center, center) < 7);

      if (group) {
        group.names.push(feature.properties.name || "Lift");
      } else {
        groups.push({ center, names: [feature.properties.name || "Lift"] });
      }
    }
  }

  return {
    type: "FeatureCollection" as const,
    features: groups.map((group, index) => ({
      type: "Feature" as const,
      id: `lift-group-${index}`,
      geometry: {
        type: "Point" as const,
        coordinates: [group.center[1], group.center[0]],
      },
      properties: {
        icon: "facility-Lift Shaft",
        label: compressLiftNumbers(group.names),
      },
    })),
  };
}

function labelCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);
        const name = feature.properties.name.trim();
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          feature.properties.remoteId ??
          `${floor.id}:${feature.id}`;

        if (
          !name ||
          isSelected ||
          FACILITY_ICONS[feature.properties.typeName] ||
          feature.properties.typeName === "Lift Shaft" ||
          seen.has(dedupeKey)
        ) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: { name },
          },
        ];
      }),
    ),
  };
}

function focusedLabelCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);
        const name = feature.properties.name.trim();
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          `${floor.id}:${feature.id}`;

        if (!isSelected || !name || seen.has(dedupeKey)) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: { name },
          },
        ];
      }),
    ),
  };
}

function routeConnectorDots(segments: RouteData["segments"]) {
  return segments.slice(1).flatMap((segment, index) => {
    const previousSegment = segments[index];
    const previousEnd = previousSegment.coordinates[previousSegment.coordinates.length - 1];
    const nextStart = segment.coordinates[0];

    if (!previousEnd || !nextStart) {
      return [];
    }

    const gapDistance = distanceMeters(previousEnd, nextStart);
    if (gapDistance < ROUTE_CONNECTOR_MIN_DISTANCE_METERS) {
      return [];
    }

    const dotCount = Math.max(1, Math.floor(gapDistance / ROUTE_CONNECTOR_DOT_SPACING_METERS));
    return Array.from({ length: dotCount }, (_, dotIndex) => {
      const progress = (dotIndex + 1) / (dotCount + 1);
      const latitude = previousEnd[0] + (nextStart[0] - previousEnd[0]) * progress;
      const longitude = previousEnd[1] + (nextStart[1] - previousEnd[1]) * progress;

      return {
        type: "Feature" as const,
        id: `route-connector-${previousSegment.id}-${segment.id}-${dotIndex}`,
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude],
        },
        properties: { display: "connector" },
      };
    });
  });
}

function routeFloorLabel(segment: RouteData["segments"][number]) {
  return segment.locationLabel.match(/floor\s+([^,]+)/i)?.[1].trim() ?? "?";
}

type RouteTransitionChip = {
  id: string;
  coordinates: [number, number];
  iconSrc?: string;
  liftLabel?: string;
  fromFloor: string;
  toFloor: string;
};

function routeTransitionType(
  previousSegment: RouteData["segments"][number],
  nextSegment: RouteData["segments"][number],
  instruction?: string,
) {
  const transitionDetails = [
    previousSegment.end,
    previousSegment.info,
    instruction,
    nextSegment.start,
    nextSegment.info,
  ]
    .join(" ")
    .toLowerCase();
  const compactTransitionDetails = transitionDetails.replace(/[^a-z0-9]/g, "");
  const verticalCode = compactTransitionDetails.match(
    /(?:ug\d*|lg\d*|g\d*|b\d{1,2}|l\d{1,2}|\d{1,2})(esc|sc|stair|lift|li)/i,
  )?.[1]?.toLowerCase();
  const hasLiftCode = verticalCode === "lift" || verticalCode === "li";
  const hasEscalatorCode = verticalCode === "esc";
  const hasStairCode = verticalCode === "sc" || verticalCode === "stair";

  if (
    transitionDetails.includes("lift") ||
    transitionDetails.includes("elevator") ||
    hasLiftCode
  ) {
    const liftNumber = transitionDetails.match(
      /(?:lift|elevator)\s*(?:no\.?|#)?\s*([a-z]*\d+[a-z]*)/i,
    )?.[1];
    return {
      iconSrc: FACILITY_ICONS["Lift Shaft"],
      liftLabel: liftNumber ? `Lift ${liftNumber.toUpperCase()}` : "Lift",
    };
  }

  if (transitionDetails.includes("escalator") || hasEscalatorCode) {
    return { iconSrc: FACILITY_ICONS.Escalator };
  }

  if (transitionDetails.includes("stair") || hasStairCode) {
    return { iconSrc: FACILITY_ICONS.Staircase };
  }

  return null;
}

function routeTransitionChips(segments: RouteData["segments"]): RouteTransitionChip[] {
  return segments.flatMap((instructionSegment, index) => {
    if (!instructionSegment.info) {
      return [];
    }

    const previousSegment = [...segments.slice(0, index)]
      .reverse()
      .find((segment) => Boolean(segment.floorId && segment.coordinates.length > 0));
    const nextSegment = segments
      .slice(index + 1)
      .find((segment) => Boolean(segment.floorId && segment.coordinates.length > 0));

    if (
      !previousSegment ||
      !nextSegment ||
      previousSegment.floorId === nextSegment.floorId
    ) {
      return [];
    }

    const previousEnd = previousSegment.coordinates[previousSegment.coordinates.length - 1];
    const nextStart = nextSegment.coordinates[0];
    if (!previousEnd || !nextStart) {
      return [];
    }

    const transition = routeTransitionType(
      previousSegment,
      nextSegment,
      instructionSegment.info,
    );
    if (!transition) {
      return [];
    }

    const latitude = (previousEnd[0] + nextStart[0]) / 2;
    const longitude = (previousEnd[1] + nextStart[1]) / 2;

    return [
      {
        id: `route-transition-${previousSegment.id}-${nextSegment.id}`,
        coordinates: [latitude, longitude] as [number, number],
        iconSrc: transition.iconSrc,
        liftLabel: transition.liftLabel,
        fromFloor: routeFloorLabel(previousSegment),
        toFloor: routeFloorLabel(nextSegment),
      },
    ];
  });
}

function createRouteTransitionChipElement(transition: RouteTransitionChip) {
  const marker = document.createElement("div");
  marker.className = "pathadvisor-route-transition-marker";

  const element = document.createElement("div");
  element.className = "pathadvisor-route-transition-chip";
  element.title = `Floor ${transition.fromFloor} to Floor ${transition.toFloor}`;
  Object.assign(element.style, {
    alignItems: "center",
    backgroundColor: "#3d5181",
    border: "1px solid rgba(255, 255, 255, 0.32)",
    borderRadius: "6px",
    boxShadow: "0 4px 10px rgba(15, 23, 42, 0.28)",
    color: "#ffffff",
    display: "flex",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "12px",
    fontWeight: "700",
    gap: "6px",
    lineHeight: "1",
    padding: "6px 8px",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  });

  if (transition.iconSrc) {
    const icon = document.createElement("img");
    icon.className = "pathadvisor-route-transition-chip__icon";
    icon.src = transition.iconSrc;
    icon.alt = "";
    Object.assign(icon.style, {
      display: "block",
      flex: "0 0 16px",
      height: "16px",
      maxHeight: "16px",
      maxWidth: "16px",
      objectFit: "contain",
      width: "16px",
    });
    element.append(icon);

    const divider = document.createElement("span");
    divider.className = "pathadvisor-route-transition-chip__divider";
    divider.textContent = "|";
    element.append(divider);
  }

  if (transition.liftLabel) {
    const liftLabel = document.createElement("span");
    liftLabel.className = "pathadvisor-route-transition-chip__lift";
    liftLabel.textContent = `${transition.liftLabel} ·`;
    element.append(liftLabel);
  }

  const floorChange = document.createElement("span");
  floorChange.textContent = transition.fromFloor;
  element.append(floorChange);

  const arrow = document.createElement("img");
  arrow.className = "pathadvisor-route-transition-chip__arrow";
  arrow.src = "/mdi/chevron-down.svg";
  arrow.alt = "to";
  Object.assign(arrow.style, {
    filter: "brightness(0) invert(1)",
    height: "13px",
    transform: "rotate(-90deg)",
    width: "13px",
  });
  element.append(arrow);

  const toFloor = document.createElement("span");
  toFloor.textContent = transition.toFloor;
  element.append(toFloor);

  marker.append(element);
  return marker;
}

function routeCollection(routeData: RouteData | null, selectedFloorId: string | null) {
  const segmentFeatures =
    routeData?.segments.flatMap((segment) => {
      if (segment.coordinates.length < 2) {
        return [];
      }

      const isOutdoor = segment.locationLabel.toLowerCase().includes("outdoor");

      // Only the selected indoor floor is the active route; all other context is dimmed.
      const display =
        !isOutdoor && segment.floorId === selectedFloorId ? "active" : "context";

      return [
        {
          type: "Feature" as const,
          id: segment.id,
          geometry: {
            type: "LineString" as const,
            coordinates: segment.coordinates.map(([lat, lng]) => [lng, lat]),
          },
          properties: { id: segment.id, display },
        },
      ];
    }) ?? [];

  return {
    type: "FeatureCollection" as const,
    features: [
      ...segmentFeatures,
      ...(routeData ? routeConnectorDots(routeData.segments) : []),
    ],
  };
}

async function loadFacilityImages(map: MapLibreInstance) {
  await Promise.all(
    Object.entries(FACILITY_ICONS).map(async ([typeName, imageUrl]) => {
      const imageId = `facility-${typeName}`;
      if (map.hasImage(imageId)) {
        return;
      }

      try {
        const image = await map.loadImage(imageUrl);
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, image.data, { pixelRatio: 2 });
        }
      } catch {
        // A missing facility icon should not prevent the map from rendering.
      }
    }),
  );

  if (!map.getLayer(LAYER_IDS.liftIcons)) {
    map.addLayer({
      id: LAYER_IDS.liftIcons,
      type: "symbol",
      source: SOURCE_IDS.lifts,
      minzoom: 17.5,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.385,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 11,
        "text-anchor": "left",
        "text-offset": [1.1, 0],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#a5c3f2",
        "text-halo-color": "rgba(15,23,42,0.9)",
        "text-halo-width": 1,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.facilityIcons)) {
    map.addLayer({
      id: LAYER_IDS.facilityIcons,
      type: "symbol",
      source: SOURCE_IDS.facilities,
      minzoom: 18.2,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.385,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.focusedVenueLabel)) {
    map.addLayer({
      id: LAYER_IDS.focusedVenueLabel,
      type: "symbol",
      source: SOURCE_IDS.focusedLabel,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 0, 12, 20, 15],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#f2a5bd",
        "text-halo-color": "#000000",
        "text-halo-width": 1.1,
      },
    });
  }
}

export function MapLibreMap(props: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const routeTransitionMarkerRef = useRef<maplibregl.Marker[]>([]);
  const focusedBuildingIdRef = useRef<string | null>(props.focusedBuildingId);
  const preserveZoomForMapSelectionRef = useRef<{
    id: string;
    bounds: [[number, number], [number, number]] | null;
  } | null>(null);
  const { onAutoVisibleBuildingChange } = props;
  const callbacksRef = useRef({
    onSelectBuilding: props.onSelectBuilding,
    onSelectVenue: props.onSelectVenue,
  });
  const [mapReady, setMapReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(16);
  const [viewportBounds, setViewportBounds] = useState<MapBoundsTuple | null>(null);
  const [autoFloorDataByBuilding, setAutoFloorDataByBuilding] = useState<Record<string, FloorData>>({});

  useEffect(() => {
    callbacksRef.current = {
      onSelectBuilding: props.onSelectBuilding,
      onSelectVenue: props.onSelectVenue,
    };
  }, [props.onSelectBuilding, props.onSelectVenue]);

  useEffect(() => {
    focusedBuildingIdRef.current = props.focusedBuildingId;
  }, [props.focusedBuildingId]);

  const resolvedPlaceDetail =
    props.placeDetail?.id === props.selectedPlace?.id ? props.placeDetail : null;
  const selectedLocationId =
    resolvedPlaceDetail?.kind === "location"
      ? resolvedPlaceDetail.id
      : props.selectedPlace?.kind === "location"
        ? props.selectedPlace.id
        : undefined;
  const selectedPointOfInterestId =
    resolvedPlaceDetail?.kind === "point_of_interest"
      ? resolvedPlaceDetail.id
      : props.selectedPlace?.kind === "point_of_interest"
        ? props.selectedPlace.id
        : undefined;
  const activeBuildingId =
    props.selectedPlace?.kind === "building"
      ? props.selectedPlace.id
        : props.selectedPlace?.buildingId ?? props.placeDetail?.buildingId ?? null;
  const transitionChips = useMemo(
    () => (props.routeData ? routeTransitionChips(props.routeData.segments) : []),
    [props.routeData],
  );

  const buildingBounds = useMemo(
    () =>
      props.bootstrap?.footprints.features.map((feature) => {
        const [[west, south], [east, north]] = boundsForGeometry(feature.geometry);
        return {
          buildingId: feature.properties.buildingId,
          mapBounds: [
            [south, west],
            [north, east],
          ] as MapBoundsTuple,
        };
      }) ?? [],
    [props.bootstrap],
  );

  const visibleAutoBuildings = useMemo(() => {
    if (!viewportBounds || zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      return [];
    }

    const viewportCenter = boundsCenter(viewportBounds);
    return buildingBounds
      .filter((building) => boundsIntersect(viewportBounds, building.mapBounds))
      .sort(
        (left, right) =>
          distanceMeters(viewportCenter, boundsCenter(left.mapBounds)) -
          distanceMeters(viewportCenter, boundsCenter(right.mapBounds)),
      )
      .slice(0, MAX_AUTO_BUILDINGS);
  }, [buildingBounds, viewportBounds, zoomLevel]);

  const autoFloorLayers = useMemo(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      return [];
    }

    const visibleBuildingIds = new Set(visibleAutoBuildings.map((building) => building.buildingId));
    return Object.entries(autoFloorDataByBuilding)
      .filter(([buildingId]) => visibleBuildingIds.has(buildingId) && buildingId !== activeBuildingId)
      .map(([, floor]) => floor)
      .filter((floor) => floor.id !== props.floorData?.id);
  }, [activeBuildingId, autoFloorDataByBuilding, props.floorData?.id, visibleAutoBuildings, zoomLevel]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: HKUST_CENTER,
      zoom: 16,
      maxZoom: 22,
      touchZoomRotate: true,
      touchPitch: false,
      dragRotate: true,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });

    const reportViewport = () => {
      const bounds = map.getBounds();
      setZoomLevel(map.getZoom());
      setViewportBounds([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ]);
    };

    map.on("load", () => {
      for (const sourceId of Object.values(SOURCE_IDS)) {
        map.addSource(sourceId, { type: "geojson", data: emptyCollection() });
      }

      map.addLayer({
        id: LAYER_IDS.campusFill,
        type: "fill",
        source: SOURCE_IDS.campus,
        paint: {
          "fill-color": ["case", ["get", "isSelected"], "#4b5563", "#374151"],
          "fill-opacity": ["case", ["get", "isSelected"], 0.98, 0.92],
        },
      });
      map.addLayer({
        id: LAYER_IDS.campusOutline,
        type: "line",
        source: SOURCE_IDS.campus,
        paint: {
          "line-color": ["case", ["get", "isSelected"], "#334155", "#475569"],
          "line-width": ["case", ["get", "isSelected"], 1.45, 0.9],
        },
      });

      for (const [sourceId, fillLayer, outlineLayer, opacity] of [
        [SOURCE_IDS.autoFloors, LAYER_IDS.autoFloorFill, LAYER_IDS.autoFloorOutline, 0.6],
        [SOURCE_IDS.selectedFloor, LAYER_IDS.selectedFloorFill, LAYER_IDS.selectedFloorOutline, 1],
      ] as const) {
        map.addLayer({
          id: fillLayer,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": [
              "case",
              ["get", "isSelected"],
              ["get", "selectedFillColor"],
              ["get", "isCourtyard"],
              "#a8e6b6",
              ["get", "fillColor"],
            ],
            "fill-opacity": opacity,
          },
        });
        map.addLayer({
          id: outlineLayer,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": [
              "case",
              ["get", "isSelected"],
              ["get", "selectedOutlineColor"],
              ["get", "isClickable"],
              "#64748b",
              "#cbd5e1",
            ],
            "line-width": ["case", ["get", "isSelected"], 1.1, ["get", "isClickable"], 0.7, 0.38],
          },
        });
      }

      map.addLayer({
        id: LAYER_IDS.routeContextOutline,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "context"],
        paint: {
          "line-color": "#1e3a5f",
          "line-width": 4,
          "line-opacity": 0.65,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeContextLine,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "context"],
        paint: {
          "line-color": "#60a5fa",
          "line-width": 2,
          "line-opacity": 0.62,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeConnectorDots,
        type: "circle",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "connector"],
        paint: {
          "circle-color": "#2d9aed",
          "circle-radius": 3.5,
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.75,
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeOutline,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "active"],
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.96 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: LAYER_IDS.routeLine,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "active"],
        paint: { "line-color": "#2d9aed", "line-width": 3, "line-opacity": 0.92 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: LAYER_IDS.venueLabels,
        type: "symbol",
        source: SOURCE_IDS.labels,
        minzoom: 16.8,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 16.8, 10, 20, 13],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#334155",
          "text-halo-color": "rgba(255,255,255,0.9)",
          "text-halo-width": 1.2,
        },
      });

      const selectCampus = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const buildingId = feature?.properties?.buildingId;
        const name = feature?.properties?.name;
        if (
          typeof buildingId === "string" &&
          typeof name === "string" &&
          buildingId !== focusedBuildingIdRef.current
        ) {
          callbacksRef.current.onSelectBuilding(buildingId, name);
        }
      };
      const selectVenue = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const properties = feature?.properties;
        const locationId = properties?.locationId;
        const pointOfInterestId = properties?.pointOfInterestId;
        const geometry = feature?.geometry;
        const bounds =
          geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
            ? boundsForGeometry(geometry)
            : null;

        if (typeof locationId === "string") {
          preserveZoomForMapSelectionRef.current = { id: locationId, bounds };
          callbacksRef.current.onSelectVenue({
            id: locationId,
            kind: "location",
            name: typeof properties?.name === "string" ? properties.name : "Venue",
            subtitle: typeof properties?.typeName === "string" ? properties.typeName : "Location",
          });
        } else if (typeof pointOfInterestId === "string") {
          preserveZoomForMapSelectionRef.current = { id: pointOfInterestId, bounds };
          callbacksRef.current.onSelectVenue({
            id: pointOfInterestId,
            kind: "point_of_interest",
            name: typeof properties?.name === "string" ? properties.name : "Point of interest",
            subtitle:
              typeof properties?.typeName === "string" ? properties.typeName : "Point of interest",
          });
        }
      };
      const showPointer = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const clearPointer = () => {
        map.getCanvas().style.cursor = "";
      };

      map.on("click", LAYER_IDS.campusFill, selectCampus);
      map.on("click", LAYER_IDS.autoFloorFill, selectVenue);
      map.on("click", LAYER_IDS.selectedFloorFill, selectVenue);
      map.on("mouseenter", LAYER_IDS.campusFill, showPointer);
      map.on("mouseleave", LAYER_IDS.campusFill, clearPointer);
      map.on("mouseenter", LAYER_IDS.autoFloorFill, showPointer);
      map.on("mouseleave", LAYER_IDS.autoFloorFill, clearPointer);
      map.on("mouseenter", LAYER_IDS.selectedFloorFill, showPointer);
      map.on("mouseleave", LAYER_IDS.selectedFloorFill, clearPointer);
      void loadFacilityImages(map);
      reportViewport();
      setMapReady(true);
    });

    map.on("moveend", reportViewport);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    mapRef.current = map;

    return () => {
      routeTransitionMarkerRef.current.forEach((marker) => marker.remove());
      routeTransitionMarkerRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    routeTransitionMarkerRef.current.forEach((marker) => marker.remove());
    const markers = transitionChips.map((transition) =>
      new maplibregl.Marker({
        element: createRouteTransitionChipElement(transition),
        anchor: "center",
      })
        .setLngLat([transition.coordinates[1], transition.coordinates[0]])
        .addTo(map),
    );
    routeTransitionMarkerRef.current = markers;

    const updateChipScale = () => {
      const isCompact = map.getZoom() < ROUTE_TRANSITION_COMPACT_ZOOM;
      for (const marker of markers) {
        marker
          .getElement()
          .firstElementChild
          ?.classList.toggle("pathadvisor-route-transition-chip--compact", isCompact);
      }
    };

    updateChipScale();
    map.on("zoom", updateChipScale);

    return () => {
      map.off("zoom", updateChipScale);
      markers.forEach((marker) => marker.remove());
      if (routeTransitionMarkerRef.current === markers) {
        routeTransitionMarkerRef.current = [];
      }
    };
  }, [mapReady, transitionChips]);

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
    void Promise.all(
      visibleAutoBuildings.map(async (building) => {
        try {
          const defaultFloorId = await getDefaultFloorIdForBuilding(building.buildingId);
          return defaultFloorId ? ([building.buildingId, await getFloorData(defaultFloorId)] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setAutoFloorDataByBuilding(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, FloorData] => entry !== null)),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visibleAutoBuildings, zoomLevel]);

  const campusData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        props.bootstrap?.footprints.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            isSelected: feature.properties.buildingId === props.selectedPlace?.id,
          },
        })) ?? [],
    }),
    [props.bootstrap, props.selectedPlace?.id],
  );
  const selectedFloorData = useMemo(
    () =>
      floorCollection(
        props.floorData ? [props.floorData] : [],
        selectedLocationId,
        selectedPointOfInterestId,
      ),
    [props.floorData, selectedLocationId, selectedPointOfInterestId],
  );
  const autoFloorData = useMemo(
    () => floorCollection(autoFloorLayers, selectedLocationId, selectedPointOfInterestId),
    [autoFloorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const floorLayers = useMemo(
    () => [props.floorData, ...autoFloorLayers].filter((floor): floor is FloorData => Boolean(floor)),
    [autoFloorLayers, props.floorData],
  );
  const facilitiesData = useMemo(() => facilityCollection(floorLayers), [floorLayers]);
  const liftsData = useMemo(() => liftCollection(floorLayers), [floorLayers]);
  const labelsData = useMemo(
    () => labelCollection(floorLayers, selectedLocationId, selectedPointOfInterestId),
    [floorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const focusedLabelData = useMemo(
    () => focusedLabelCollection(floorLayers, selectedLocationId, selectedPointOfInterestId),
    [floorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const routesData = useMemo(
    () => routeCollection(props.routeData, props.selectedFloorId),
    [props.routeData, props.selectedFloorId],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSourceData(map, SOURCE_IDS.campus, campusData);
    setSourceData(map, SOURCE_IDS.selectedFloor, selectedFloorData);
    setSourceData(map, SOURCE_IDS.autoFloors, autoFloorData);
    setSourceData(map, SOURCE_IDS.lifts, liftsData);
    setSourceData(map, SOURCE_IDS.facilities, facilitiesData);
    setSourceData(map, SOURCE_IDS.labels, labelsData);
    setSourceData(map, SOURCE_IDS.focusedLabel, focusedLabelData);
    setSourceData(map, SOURCE_IDS.routes, routesData);
  }, [
    autoFloorData,
    campusData,
    facilitiesData,
    focusedLabelData,
    labelsData,
    liftsData,
    mapReady,
    routesData,
    selectedFloorData,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady && map.getLayer(LAYER_IDS.autoFloorFill)) {
      map.setPaintProperty(
        LAYER_IDS.autoFloorFill,
        "fill-opacity",
        props.isFloorSelectorVisible ? 0.6 : 1,
      );
    }
  }, [mapReady, props.isFloorSelectorVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (props.routeData) {
      const segment =
        props.routeData.segments.find((entry) => entry.id === props.focusedSegmentId) ??
        props.routeData.segments.find((entry) => entry.coordinates.length > 1);
      if (segment && segment.coordinates.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const [lat, lng] of segment.coordinates) {
          bounds.extend([lng, lat]);
        }
        map.fitBounds(bounds, { padding: 72, maxZoom: 19.8, duration: 500 });
      }
      return;
    }

    if (resolvedPlaceDetail?.coordinates) {
      const mapSelection = preserveZoomForMapSelectionRef.current;
      if (mapSelection && mapSelection.id === props.selectedPlace?.id) {
        const selectionBounds = mapSelection.bounds;
        preserveZoomForMapSelectionRef.current = null;

        const currentZoom = map.getZoom();
        const fitZoom = selectionBounds
          ? map.cameraForBounds(selectionBounds, { padding: 72 })?.zoom
          : undefined;
        const targetZoom =
          currentZoom < MAP_TAP_MIN_FOCUS_ZOOM
            ? MAP_TAP_MIN_FOCUS_ZOOM
            : fitZoom !== undefined && currentZoom > fitZoom
              ? fitZoom
              : null;

        if (targetZoom !== null) {
          map.flyTo({
            center: [resolvedPlaceDetail.coordinates[1], resolvedPlaceDetail.coordinates[0]],
            zoom: targetZoom,
            duration: 700,
          });
        }

        return;
      }

      map.flyTo({
        center: [resolvedPlaceDetail.coordinates[1], resolvedPlaceDetail.coordinates[0]],
        zoom: Math.max(map.getZoom(), VENUE_FOCUS_ZOOM),
        duration: 700,
      });
      return;
    }

    if (props.selectedPlace?.kind === "building" && props.bootstrap) {
      const footprint = props.bootstrap.footprints.features.find(
        (feature) => feature.properties.buildingId === props.selectedPlace?.id,
      );
      if (footprint) {
        map.fitBounds(boundsForGeometry(footprint.geometry), {
          padding: 84,
          maxZoom: BUILDING_FLOOR_FOCUS_ZOOM,
          duration: 500,
        });
      }
    }
  }, [mapReady, props.bootstrap, props.focusedSegmentId, props.routeData, props.selectedPlace, resolvedPlaceDetail, props.venueFocusRequest]);

  return <div ref={containerRef} className="absolute! inset-0!" />;
}
