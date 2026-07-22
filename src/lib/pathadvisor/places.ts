import { fetchPathAdvisor } from "./client";
import { getBuildingFloors } from "./floors";
import type { CampusBootstrap, CampusFootprint, PlaceDetail } from "./types";
import { asString, categoryFromRecord, normalizeSearchPlace, parseNumber } from "./utilities";

type AnyRecord = Record<string, unknown>;
type BuildingsResponse = { data: { buildings: Array<{ _id: string; full_name: string; description?: string }> } };
type BaseMapResponse = { data: { all_base_map: string } };
type LocationsResponse = { data: { locations: AnyRecord[] } };
type PlaceDetailResponse = { data: { location: AnyRecord } };

const placeCategoryCache = new Map<string, Promise<string | undefined>>();

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
  return { buildings, footprints: { type: "FeatureCollection", features } };
}

export async function searchCampusPlaces(query: string) {
  const response = await fetchPathAdvisor<LocationsResponse>("/locations", { search: query, page: 1, limit: 12 });
  return response.data.locations.map(normalizeSearchPlace);
}

export async function searchRouteablePlaces(query: string) {
  const response = await fetchPathAdvisor<LocationsResponse>("/directions/search", { search: query, page: 1, limit: 12 });
  return response.data.locations.map((record) => ({ ...normalizeSearchPlace(record), routeable: true }));
}

export async function getPlaceCategory(id: string, query: string) {
  let cached = placeCategoryCache.get(id);
  if (!cached) {
    cached = fetchPathAdvisor<LocationsResponse>("/locations", { search: query, page: 1, limit: 50 })
      .then((response) => {
        const record = response.data.locations.find((location) => asString(location._id) === id);
        return record ? categoryFromRecord(record, "point_of_interest" in record || "point_of_interest_type_name" in record ? "point_of_interest" : "is_building" in record || "full_name" in record ? "building" : "location") || undefined : undefined;
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
  const selectedFloorId = asString(location.building_floor_id) || asString(location.default_floor_id) || undefined;
  return {
    id: asString(location._id),
    name: asString(location.name || location.full_name),
    description: asString(location.description),
    kind: isBuilding ? "building" : "point_of_interest_information_id" in location ? "point_of_interest" : "location",
    routeable: !isBuilding,
    isBuilding,
    buildingId: buildingId || undefined,
    buildingName: asString(location.building_name || location.building_short_name || location.full_name) || undefined,
    floorId: selectedFloorId,
    floorName: asString(location.building_floor_name) || undefined,
    defaultFloorId: asString(location.default_floor_id) || undefined,
    remoteId: asString(location.remote_id) || undefined,
    coordinates: parseNumber(location.latitude) !== null && parseNumber(location.longitude) !== null ? [parseNumber(location.latitude) as number, parseNumber(location.longitude) as number] : null,
    address: asString(location.address) || undefined,
    floors,
  };
}
