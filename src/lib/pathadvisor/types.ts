export type SearchPlaceKind = "building" | "location" | "point_of_interest";

export type SearchPlace = {
  id: string;
  kind: SearchPlaceKind;
  name: string;
  subtitle: string;
  category?: string;
  description: string;
  buildingId?: string;
  buildingName?: string;
  floorId?: string;
  floorName?: string;
  routeable: boolean;
  remoteId?: string;
};

export type BuildingFloorSummary = {
  id: string;
  name: string;
  elevation: number | null;
  isDefault: boolean;
  showInPathAdvisor: boolean;
};

export type PlaceDetail = {
  id: string;
  name: string;
  description: string;
  kind: SearchPlaceKind;
  routeable: boolean;
  isBuilding: boolean;
  buildingId?: string;
  buildingName?: string;
  floorId?: string;
  floorName?: string;
  defaultFloorId?: string;
  remoteId?: string;
  coordinates: [number, number] | null;
  address?: string;
  floors: BuildingFloorSummary[];
};

export type NormalizedFloorFeature = {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    locationId?: string;
    pointOfInterestId?: string;
    name: string;
    typeName: string;
    colorHex: string;
    remoteId?: string;
    typeDisplaySetting?: string;
  };
};

export type FloorData = {
  id: string;
  bounds: [[number, number], [number, number]] | null;
  features: NormalizedFloorFeature[];
};

export type RouteSegment = {
  id: string;
  floorId?: string;
  buildingId?: string;
  start: string;
  end: string;
  locationLabel: string;
  distance: number | null;
  time: number | null;
  info?: string;
  coordinates: [number, number][];
};

export type RouteData = {
  startLabel: string;
  endLabel: string;
  startLocationId: string;
  startFloorId?: string;
  distance: number | null;
  time: number | null;
  segments: RouteSegment[];
};

export type CampusFootprint = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    id: string;
    buildingId: string;
    name: string;
  }
>;

export type CampusBootstrap = {
  footprints: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    CampusFootprint["properties"]
  >;
  buildings: SearchPlace[];
};
