import { fetchPathAdvisor } from "./client";
import type { BuildingFloorSummary, FloorData, NormalizedFloorFeature } from "./types";
import { asString, getFeatureBounds, mapWithConcurrency, parseNumber, sortFloors } from "./utilities";

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

type FloorNavNodeSummary = {
  name: string;
  typeName: string;
  remoteId?: string;
  typeDisplaySetting?: string;
};

type FloorNavNodesResponse = {
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

type PlaceDetailResponse = { data: { location: Record<string, unknown> } };
type LocationSummary = { name: string; remoteId?: string; typeName?: string };
type PersistedFloorPlan = { expiresAt: number; floorData: FloorData };

const FLOOR_PLAN_CACHE_PREFIX = "pathadvisor:floor-plan:v2:";
const FLOOR_PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const floorNavNodeSummaryCache = new Map<string, Promise<Map<string, FloorNavNodeSummary>>>();
const buildingFloorsCache = new Map<string, Promise<BuildingFloorSummary[]>>();
const floorDataCache = new Map<string, Promise<FloorData>>();
const locationSummaryCache = new Map<string, Promise<LocationSummary>>();

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
    window.localStorage.setItem(
      `${FLOOR_PLAN_CACHE_PREFIX}${buildingFloorId}`,
      JSON.stringify({ expiresAt: Date.now() + FLOOR_PLAN_CACHE_TTL_MS, floorData } satisfies PersistedFloorPlan),
    );
  } catch {
    // Storage can be unavailable or full; the in-memory cache still serves this session.
  }
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
          const key = asString(node.location_id) || asString(node.point_of_interest_id) || undefined;
          if (key) {
            summaries.set(key, {
              name: asString(node.name),
              typeName: asString(node.type_name),
              remoteId: asString(node.remote_id) || undefined,
              typeDisplaySetting: asString(node.type_display_setting) || undefined,
            });
          }
        }
        return summaries;
      })
      .catch(() => new Map<string, FloorNavNodeSummary>());
    floorNavNodeSummaryCache.set(buildingFloorId, cached);
  }

  return cached;
}

async function getLocationSummary(locationId: string) {
  let cached = locationSummaryCache.get(locationId);

  if (!cached) {
    cached = fetchPathAdvisor<PlaceDetailResponse>("/locations/id", { id: locationId })
      .then((response) => {
        const location = response.data.location;
        return {
          name: asString(location.name || location.full_name),
          remoteId: asString(location.remote_id) || undefined,
          typeName: asString(location.type_name) || undefined,
        };
      })
      .catch((error) => {
        locationSummaryCache.delete(locationId);
        throw error;
      });
    locationSummaryCache.set(locationId, cached);
  }

  return cached;
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
          const unresolvedLocationIds = Array.from(
            new Set(
              rawFeatures.flatMap((feature) => {
                const locationId = asString(feature.properties.location_id);
                const hasName = Boolean(asString(feature.properties.location_name));
                const isWhiteFeature = asString(feature.properties.type_color_hex).toUpperCase() === "FFFFFF";
                return locationId && !hasName && isWhiteFeature && !navNodeSummaries.has(locationId)
                  ? [locationId]
                  : [];
              }),
            ),
          );
          const resolvedLocations = new Map<string, LocationSummary>();
          await mapWithConcurrency(unresolvedLocationIds, 4, async (locationId) => {
            try {
              resolvedLocations.set(locationId, await getLocationSummary(locationId));
            } catch {
              // Missing names fall back to the upstream floor-plan data.
            }
          });

          const features: NormalizedFloorFeature[] = rawFeatures.map((feature, index) => {
            const locationId = asString(feature.properties.location_id) || undefined;
            const pointOfInterestId = asString(feature.properties.point_of_interest_id) || undefined;
            const navNodeSummary =
              (locationId ? navNodeSummaries.get(locationId) : undefined) ??
              (pointOfInterestId ? navNodeSummaries.get(pointOfInterestId) : undefined);
            const locationSummary = locationId ? resolvedLocations.get(locationId) : undefined;
            return {
              id: String(feature.id ?? `${buildingFloorId}-${index}`),
              geometry: feature.geometry,
              properties: {
                locationId,
                pointOfInterestId,
                name: asString(feature.properties.location_name) || navNodeSummary?.name || locationSummary?.name || "",
                typeName: asString(feature.properties.type_name) || navNodeSummary?.typeName || locationSummary?.typeName || "",
                colorHex: asString(feature.properties.type_color_hex) || "DDE7F1",
                remoteId: navNodeSummary?.remoteId ?? locationSummary?.remoteId,
                typeDisplaySetting: navNodeSummary?.typeDisplaySetting,
              },
            };
          });

          let bounds: [[number, number], [number, number]] | null = null;
          for (const feature of features) {
            const featureBounds = getFeatureBounds({ type: "Feature", geometry: feature.geometry, properties: {} });
            if (!featureBounds) {
              continue;
            }
            bounds = bounds
              ? [
                  [Math.min(bounds[0][0], featureBounds[0][0]), Math.min(bounds[0][1], featureBounds[0][1])],
                  [Math.max(bounds[1][0], featureBounds[1][0]), Math.max(bounds[1][1], featureBounds[1][1])],
                ]
              : featureBounds;
          }

          return { id: response.data.building_floor._id, bounds, features };
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
