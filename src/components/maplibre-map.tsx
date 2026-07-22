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

const HKUST_CENTER: [number, number] = [114.2651, 22.3368];
const AUTO_FLOOR_MIN_ZOOM = 16.5;
const MAX_AUTO_BUILDINGS = 6;
const BUILDING_FLOOR_FOCUS_ZOOM = 18.8;
const VENUE_FOCUS_ZOOM = 19.2;

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
        const fillColor = normalizeColorHex(
          feature.properties.colorHex,
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

function labelCollection(floors: FloorData[]) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const name = feature.properties.name.trim();
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          feature.properties.remoteId ??
          `${floor.id}:${feature.id}`;

        if (
          !name ||
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

function routeCollection(routeData: RouteData | null, selectedFloorId: string | null) {
  return {
    type: "FeatureCollection" as const,
    features:
      routeData?.segments.flatMap((segment) => {
        if (
          segment.coordinates.length < 2 ||
          (selectedFloorId && segment.floorId !== selectedFloorId)
        ) {
          return [];
        }

        return [
          {
            type: "Feature" as const,
            id: segment.id,
            geometry: {
              type: "LineString" as const,
              coordinates: segment.coordinates.map(([lat, lng]) => [lng, lat]),
            },
            properties: { id: segment.id },
          },
        ];
      }) ?? [],
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
        id: LAYER_IDS.routeOutline,
        type: "line",
        source: SOURCE_IDS.routes,
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.96 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: LAYER_IDS.routeLine,
        type: "line",
        source: SOURCE_IDS.routes,
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
        if (typeof buildingId === "string" && typeof name === "string") {
          callbacksRef.current.onSelectBuilding(buildingId, name);
        }
      };
      const selectVenue = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const properties = feature?.properties;
        const locationId = properties?.locationId;
        const pointOfInterestId = properties?.pointOfInterestId;

        if (typeof locationId === "string") {
          callbacksRef.current.onSelectVenue({
            id: locationId,
            kind: "location",
            name: typeof properties?.name === "string" ? properties.name : "Venue",
            subtitle: typeof properties?.typeName === "string" ? properties.typeName : "Location",
          });
        } else if (typeof pointOfInterestId === "string") {
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
      mapRef.current = null;
      map.remove();
    };
  }, []);

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
  const labelsData = useMemo(() => labelCollection(floorLayers), [floorLayers]);
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

  return <div ref={containerRef} className="!absolute !inset-0" />;
}
