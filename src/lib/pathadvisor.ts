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

const PATHADVISOR_BASE_URL = "https://navigate.ust.hk/path/api/app";

type AnyRecord = Record<string, unknown>;

type BuildingsResponse = {
  data: {
    buildings: Array<{
      _id: string;
      full_name: string;
      description?: string;
    }>;
  };
};

type BaseMapResponse = {
  data: {
    all_base_map: string;
  };
};

type LocationsResponse = {
  data: {
    locations: AnyRecord[];
  };
};

type PlaceDetailResponse = {
  data: {
    location: AnyRecord;
  };
};

type FloorNavNodeSummary = {
  name: string;
  typeName: string;
  remoteId?: string;
  typeDisplaySetting?: string;
};

type FloorsResponse = {
  data: {
    location_building_floors: Array<{
      _id: string;
      is_default: boolean;
      show_in_path_advisor: boolean;
      name: string;
      elevation?: string;
    }>;
  };
};

type FloorGeoJsonResponse = {
  data: {
    building_floor: {
      _id: string;
      geojson: GeoJSON.FeatureCollection<
        GeoJSON.Polygon | GeoJSON.MultiPolygon,
        {
          location_id?: string;
          location_name?: string;
          point_of_interest_id?: string;
          type_name?: string;
          type_color_hex?: string;
        }
      >;
    };
  };
};

type FloorNavNodesResponse = {
  meta: {
    code: number;
    message: string;
  };
  data?: {
    nav_nodes: Array<{
      location_id?: string | null;
      point_of_interest_id?: string | null;
      name?: string;
      remote_id?: string;
      type_name?: string;
      type_display_setting?: string;
    }>;
  };
};

type DirectionsResponse = {
  data: {
    directions: {
      start_location_building_floor_id?: string;
      start_location_id: string;
      start: string;
      end: string;
      distance?: string;
      time?: string;
      paths: Array<{
        properties: {
          building_floor_id?: string;
          building_id?: string;
          location_id?: string;
          point_of_interest_id?: string;
          start?: string;
          end?: string;
          distance?: string;
          time?: string;
          location?: string;
          info?: string;
        };
        geometry: {
          coordinates: Array<[number, number] | string>;
        };
      }>;
    };
  };
};

function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function fetchPathAdvisor<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  const url = `${PATHADVISOR_BASE_URL}${path}${toQueryString(params ?? {})}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} for ${path}`);
  }

  return (await response.json()) as T;
}

const floorNavNodeSummaryCache = new Map<
  string,
  Promise<Map<string, FloorNavNodeSummary>>
>();
const buildingFloorsCache = new Map<string, Promise<BuildingFloorSummary[]>>();
const floorDataCache = new Map<string, Promise<FloorData>>();
const placeCategoryCache = new Map<string, Promise<string | undefined>>();
const FLOOR_PLAN_CACHE_PREFIX = "pathadvisor:floor-plan:v1:";
const FLOOR_PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type PersistedFloorPlan = {
  expiresAt: number;
  floorData: FloorData;
};

function readPersistedFloorPlan(buildingFloorId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cacheKey = `${FLOOR_PLAN_CACHE_PREFIX}${buildingFloorId}`;
    const storedValue = window.localStorage.getItem(cacheKey);

    if (!storedValue) {
      return null;
    }

    const cached = JSON.parse(storedValue) as PersistedFloorPlan;

    if (
      typeof cached.expiresAt !== "number" ||
      cached.expiresAt <= Date.now() ||
      !cached.floorData ||
      cached.floorData.id !== buildingFloorId
    ) {
      window.localStorage.removeItem(cacheKey);
      return null;
    }

    return cached.floorData;
  } catch {
    return null;
  }
}

function persistFloorPlan(buildingFloorId: string, floorData: FloorData) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const cached: PersistedFloorPlan = {
      expiresAt: Date.now() + FLOOR_PLAN_CACHE_TTL_MS,
      floorData,
    };

    window.localStorage.setItem(
      `${FLOOR_PLAN_CACHE_PREFIX}${buildingFloorId}`,
      JSON.stringify(cached),
    );
  } catch {
    // Storage can be unavailable or full; the in-memory cache still serves this session.
  }
}

async function mapWithConcurrency<T, R>(
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

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );

  return results;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function getFloorNavNodeSummaries(buildingFloorId: string) {
  let cached = floorNavNodeSummaryCache.get(buildingFloorId);

  if (!cached) {
    cached = fetchPathAdvisor<FloorNavNodesResponse>("/building-floors/nav-nodes", {
      building_floor_id: buildingFloorId,
    })
      .then((response) => {
        const summaries = new Map<string, FloorNavNodeSummary>();

        for (const node of response.data?.nav_nodes ?? []) {
          const key =
            asString(node.location_id) || asString(node.point_of_interest_id) || undefined;

          if (!key) {
            continue;
          }

          summaries.set(key, {
            name: asString(node.name),
            typeName: asString(node.type_name),
            remoteId: asString(node.remote_id) || undefined,
            typeDisplaySetting: asString(node.type_display_setting) || undefined,
          });
        }

        return summaries;
      })
      .catch(() => new Map<string, FloorNavNodeSummary>());

    floorNavNodeSummaryCache.set(buildingFloorId, cached);
  }

  return cached;
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

function categoryFromRecord(record: AnyRecord, kind: SearchPlaceKind) {
  return kind === "point_of_interest"
    ? asString(record.point_of_interest_type_name || record.type_name)
    : asString(record.type_name);
}

function normalizeSearchPlace(record: AnyRecord): SearchPlace {
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

function getFeatureBounds(
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

function sortFloors(floors: BuildingFloorSummary[]) {
  return [...floors].sort((left, right) => {
    const leftElevation = left.elevation ?? Number.NEGATIVE_INFINITY;
    const rightElevation = right.elevation ?? Number.NEGATIVE_INFINITY;
    return rightElevation - leftElevation;
  });
}

export async function getBuildingFloors(buildingId: string): Promise<BuildingFloorSummary[]> {
  let cached = buildingFloorsCache.get(buildingId);

  if (!cached) {
    cached = fetchPathAdvisor<FloorsResponse>("/locations/building-floors", {
      building_id: buildingId,
      limit: 100,
    }).then((response) =>
      sortFloors(
        (response.data.location_building_floors ?? []).map((floor) => ({
          id: floor._id,
          name: floor.name,
          elevation: parseNumber(floor.elevation),
          isDefault: floor.is_default,
          showInPathAdvisor: floor.show_in_path_advisor,
        })),
      ),
    );

    buildingFloorsCache.set(buildingId, cached);
  }

  return cached;
}

export async function getDefaultFloorIdForBuilding(buildingId: string) {
  const floors = await getBuildingFloors(buildingId);
  return (
    floors.find((floor) => floor.isDefault && floor.showInPathAdvisor)?.id ??
    floors.find((floor) => floor.showInPathAdvisor)?.id ??
    floors[0]?.id ??
    null
  );
}

export async function prefetchDefaultFloorDataForBuildings(buildingIds: string[]) {
  const uniqueBuildingIds = Array.from(new Set(buildingIds.filter(Boolean)));

  await mapWithConcurrency(uniqueBuildingIds, 8, async (buildingId) => {
    try {
      const defaultFloorId = await getDefaultFloorIdForBuilding(buildingId);

      if (!defaultFloorId) {
        return null;
      }

      await getFloorData(defaultFloorId);
      return defaultFloorId;
    } catch {
      return null;
    }
  });
}

export async function prefetchFloorDataForBuilding(buildingId: string) {
  const floors = await getBuildingFloors(buildingId);

  await mapWithConcurrency(floors, 4, async (floor) => {
    try {
      await getFloorData(floor.id, { persistForOneDay: true });
      return floor.id;
    } catch {
      return null;
    }
  });
}

function normalizeSegment(
  path: DirectionsResponse["data"]["directions"]["paths"][number],
  index: number,
): RouteSegment {
  const coordinates = (path.geometry.coordinates ?? [])
    .map((coordinate) => {
      const [lngValue, latValue] =
        typeof coordinate === "string" ? coordinate.trim().split(/\s+/) : coordinate;
      const lng = parseNumber(lngValue);
      const lat = parseNumber(latValue);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? ([lat, lng] as [number, number])
        : null;
    })
    .filter((point): point is [number, number] => Boolean(point));

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

export async function getCampusBootstrap(): Promise<CampusBootstrap> {
  const [buildingsResponse, baseMapResponse] = await Promise.all([
    fetchPathAdvisor<BuildingsResponse>("/buildings", { page: 1, limit: 100 }),
    fetchPathAdvisor<BaseMapResponse>("/assets/all-base-map"),
  ]);

  const buildings = buildingsResponse.data.buildings.map((building) => ({
    id: building._id,
    kind: "building" as const,
    name: building.full_name,
    subtitle: "Building",
    description: building.description ?? "",
    routeable: false,
    buildingId: building._id,
  }));

  const rawCollection = JSON.parse(baseMapResponse.data.all_base_map) as GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    { building_id?: string; name?: string }
  >;

  const features: CampusFootprint[] = rawCollection.features
    .filter((feature) => Boolean(feature.properties?.building_id && feature.properties?.name))
    .map((feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        id: asString(feature.properties.building_id),
        buildingId: asString(feature.properties.building_id),
        name: asString(feature.properties.name),
      },
    }));

  return {
    buildings,
    footprints: {
      type: "FeatureCollection",
      features,
    },
  };
}

export async function searchCampusPlaces(query: string) {
  const response = await fetchPathAdvisor<LocationsResponse>("/locations", {
    search: query,
    page: 1,
    limit: 12,
  });

  return response.data.locations.map(normalizeSearchPlace);
}

export async function searchRouteablePlaces(query: string) {
  const response = await fetchPathAdvisor<LocationsResponse>("/directions/search", {
    search: query,
    page: 1,
    limit: 12,
  });

  return response.data.locations.map((record) => ({
    ...normalizeSearchPlace(record),
    routeable: true,
  }));
}

export async function getPlaceCategory(id: string, query: string) {
  let cached = placeCategoryCache.get(id);

  if (!cached) {
    cached = fetchPathAdvisor<LocationsResponse>("/locations", {
      search: query,
      page: 1,
      limit: 50,
    })
      .then((response) => {
        const record = response.data.locations.find((location) => asString(location._id) === id);

        return record ? categoryFromRecord(record, locationKindFromRecord(record)) || undefined : undefined;
      })
      .catch((error) => {
        placeCategoryCache.delete(id);
        throw error;
      });

    placeCategoryCache.set(id, cached);
  }

  return cached;
}

export async function getPlaceDetail(id: string): Promise<PlaceDetail> {
  const placeResponse = await fetchPathAdvisor<PlaceDetailResponse>("/locations/id", { id });
  const location = placeResponse.data.location;
  const isBuilding = Boolean(location.is_building);
  const buildingId = asString(location.building_id || location._id);
  const floors = buildingId ? await getBuildingFloors(buildingId) : [];

  const selectedFloorId =
    asString(location.building_floor_id) || asString(location.default_floor_id) || undefined;

  return {
    id: asString(location._id),
    name: asString(location.name || location.full_name),
    description: asString(location.description),
    kind: isBuilding
      ? "building"
      : "point_of_interest_information_id" in location
        ? "point_of_interest"
        : "location",
    routeable: !isBuilding,
    isBuilding,
    buildingId: buildingId || undefined,
    buildingName:
      asString(location.building_name || location.building_short_name || location.full_name) ||
      undefined,
    floorId: selectedFloorId,
    floorName: asString(location.building_floor_name) || undefined,
    defaultFloorId: asString(location.default_floor_id) || undefined,
    remoteId: asString(location.remote_id) || undefined,
    coordinates:
      parseNumber(location.latitude) !== null && parseNumber(location.longitude) !== null
        ? [parseNumber(location.latitude) as number, parseNumber(location.longitude) as number]
        : null,
    address: asString(location.address) || undefined,
    floors,
  };
}

export async function getFloorData(
  buildingFloorId: string,
  options: { persistForOneDay?: boolean } = {},
): Promise<FloorData> {
  let cached = floorDataCache.get(buildingFloorId);

  if (!cached) {
    const persistedFloorPlan = readPersistedFloorPlan(buildingFloorId);

    cached = persistedFloorPlan
      ? Promise.resolve(persistedFloorPlan)
      : (async () => {
      const response = await fetchPathAdvisor<FloorGeoJsonResponse>("/building-floors/geojson", {
        building_floor_id: buildingFloorId,
      });

      const rawFeatures = response.data.building_floor.geojson.features;
      const navNodeSummaries = await getFloorNavNodeSummaries(buildingFloorId);

      const features: NormalizedFloorFeature[] = rawFeatures.map((feature, index) => {
        const locationId = asString(feature.properties.location_id) || undefined;
        const pointOfInterestId = asString(feature.properties.point_of_interest_id) || undefined;
        const navNodeSummary =
          (locationId ? navNodeSummaries.get(locationId) : undefined) ??
          (pointOfInterestId ? navNodeSummaries.get(pointOfInterestId) : undefined);

        return {
          id: String(feature.id ?? `${buildingFloorId}-${index}`),
          geometry: feature.geometry,
          properties: {
            locationId,
            pointOfInterestId,
            name:
              asString(feature.properties.location_name) ||
              navNodeSummary?.name ||
              "",
            typeName:
              asString(feature.properties.type_name) ||
              navNodeSummary?.typeName ||
              "",
            colorHex: asString(feature.properties.type_color_hex) || "DDE7F1",
            remoteId: navNodeSummary?.remoteId,
            typeDisplaySetting: navNodeSummary?.typeDisplaySetting,
          },
        };
      });

      let bounds: [[number, number], [number, number]] | null = null;
      for (const feature of features) {
        const featureBounds = getFeatureBounds({
          type: "Feature",
          geometry: feature.geometry,
          properties: {},
        });

        if (!featureBounds) {
          continue;
        }

        if (!bounds) {
          bounds = featureBounds;
          continue;
        }

        bounds = [
          [Math.min(bounds[0][0], featureBounds[0][0]), Math.min(bounds[0][1], featureBounds[0][1])],
          [Math.max(bounds[1][0], featureBounds[1][0]), Math.max(bounds[1][1], featureBounds[1][1])],
        ];
      }

      return {
        id: response.data.building_floor._id,
        bounds,
        features,
      };
    })().catch((error) => {
        floorDataCache.delete(buildingFloorId);
        throw error;
      });

    floorDataCache.set(buildingFloorId, cached);
  }

  const floorData = await cached;

  if (options.persistForOneDay) {
    persistFloorPlan(buildingFloorId, floorData);
  }

  return floorData;
}

export async function getDirections(params: {
  start: string;
  end: string;
  isWheelchairAccessible?: boolean;
  excludeEscalator?: boolean;
}) {
  const response = await fetchPathAdvisor<DirectionsResponse>("/directions", {
    start: params.start,
    end: params.end,
    is_wheelchair_accessible: params.isWheelchairAccessible ?? false,
    exclude_escalator: params.excludeEscalator ?? false,
  });

  const directions = response.data.directions;

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
