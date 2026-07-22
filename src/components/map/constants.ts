import type { StyleSpecification } from "maplibre-gl";

export const HKUST_CENTER: [number, number] = [114.2651, 22.3368];
export const AUTO_FLOOR_MIN_ZOOM = 16.5;
export const MAX_AUTO_BUILDINGS = 6;
export const BUILDING_FLOOR_FOCUS_ZOOM = 18.8;
export const VENUE_FOCUS_ZOOM = 19.2;
export const MAP_TAP_MIN_FOCUS_ZOOM = 17;
export const ROUTE_CONNECTOR_MIN_DISTANCE_METERS = 5;
export const ROUTE_CONNECTOR_DOT_SPACING_METERS = 4;
export const ROUTE_TRANSITION_COMPACT_ZOOM = 17.5;

export const SOURCE_IDS = {
  campus: "campus-footprints",
  autoFloors: "auto-floors",
  selectedFloor: "selected-floor",
  lifts: "lifts",
  facilities: "facilities",
  labels: "venue-labels",
  focusedLabel: "focused-venue-label",
  routes: "routes",
} as const;
;
export const LAYER_IDS = {
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
;
export const FACILITY_ICONS: Record<string, string> = {
  "Lift Shaft": "/floor-icons/elevator.png",
  Escalator: "/floor-icons/escalator.png",
  Staircase: "/floor-icons/staircase.png",
  "Drinking Fountain": "/floor-icons/drinking_fountain.png",
  "Toilet(Male)": "/floor-icons/toilet_male.png",
  "Toilet(Female)": "/floor-icons/toilet_female.png",
  "Toilet(Disable)": "/floor-icons/toilet_disabled.png",
};
;
export const BASE_STYLE: StyleSpecification = {
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
};;
