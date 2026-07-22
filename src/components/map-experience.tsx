"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCampusBootstrap,
  getBuildingFloors,
  prefetchDefaultFloorDataForBuildings,
  prefetchFloorDataForBuilding,
  getDirections,
  getFloorData,
  getPlaceCategory,
  getPlaceDetail,
  searchCampusPlaces,
  searchRouteablePlaces,
  type BuildingFloorSummary,
  type CampusBootstrap,
  type FloorData,
  type PlaceDetail,
  type RouteData,
  type RouteSegment,
  type SearchPlace,
} from "@/lib/pathadvisor";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const CampusMap = dynamic(
  () => import("@/components/maplibre-map").then((module) => module.MapLibreMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 animate-pulse bg-[linear-gradient(180deg,#d9e7f4_0%,#ecf4fb_100%)]" />
    ),
  },
);

type RouteDraft = {
  start: SearchPlace | null;
  end: SearchPlace | null;
};

type MdiIconName =
  | "arrow-left"
  | "arrow-right"
  | "arrow-top-right"
  | "chevron-down"
  | "clock-outline"
  | "crosshairs-gps"
  | "directions"
  | "home-outline"
  | "magnify"
  | "magnify-scan"
  | "map-marker-outline"
  | "swap-vertical";

function MdiIcon({
  name,
  className = "",
}: {
  name: MdiIconName;
  className?: string;
}) {
  return <Image src={`/mdi/${name}.svg`} alt="" width={20} height={20} className={className} />;
}

function formatDuration(minutes: number | null) {
  if (minutes === null) {
    return "—";
  }

  if (minutes < 1) {
    return "<1 min";
  }

  return `${Math.round(minutes)} min`;
}

function formatDistance(distance: number | null) {
  if (distance === null) {
    return "—";
  }

  return `${distance.toFixed(distance >= 100 ? 0 : 1)} m`;
}

function floorChipLabel(floor: BuildingFloorSummary) {
  return floor.name === "G" ? "G" : floor.name;
}

const BUILDING_CHIP_LABELS: Record<string, string> = {
  "Academic Building": "Academic Bldg.",
  "Cheng Yu Tung Building": "CYT Bldg.",
  "HKUST Jockey Club Institute for Advanced Study/Lo Ka Chung Building": "IAS / LKC Bldg.",
  "Lee Shau Kee Business Building": "LSK Bldg.",
  "Martin Ka Shing Lee Innovation Building": "MKS Lee Innovation Bldg.",
};

function buildingChipLabel(name: string) {
  return BUILDING_CHIP_LABELS[name] ?? name.replace(/Building$/, "Bldg.");
}

function placeLocationLabel(place: PlaceDetail) {
  const floor = place.floorName
    ? place.floorName.startsWith("Floor ")
      ? place.floorName
      : `Floor ${place.floorName}`
    : "";

  return [floor, place.buildingName].filter(Boolean).join(", ") || place.address || "Campus";
}

function venueDisplayName(name: string, category?: string) {
  const normalizedName = name.trim();
  const toiletCodePattern = /\d{1,5}T$/i;
  const verticalTransportCodePattern = /^(UG\d*|LG\d*|G\d*|B\d{1,2}|L\d{1,2}|\d{1,2})(ESC|SC|STAIR)([A-Z]{0,4}\d{2,3}[A-Z]?)$/i;
  const verticalTransportMatch = normalizedName.match(verticalTransportCodePattern);
  const roomCodePattern = /^(?:(?:UG|LG|G)|(?:B|L)\d{1,2}|\d{1,2})\d{2,4}[A-Z]?$/i;

  if (toiletCodePattern.test(normalizedName)) {
    const normalizedCategory = category?.toLowerCase() ?? "";
    const toiletLabel = normalizedCategory.includes("disable") || normalizedCategory.includes("accessible")
      ? "Accessible Toilet"
      : normalizedCategory.includes("male")
        ? "Male Toilet"
        : normalizedCategory.includes("female")
          ? "Female Toilet"
          : "Toilet";

    return `${toiletLabel} (Rm. ${normalizedName})`;
  }

  if (verticalTransportMatch) {
    const [, floor, type, number] = verticalTransportMatch;
    const typeLabel = type.toUpperCase() === "ESC" ? "Escalator" : "Staircase";

    return `${typeLabel} ${number} (Floor ${floor})`;
  }

  return roomCodePattern.test(normalizedName) && !/^room\b/i.test(normalizedName)
    ? `Room ${normalizedName}`
    : normalizedName;
}

function routeFloorOptions(routeData: RouteData | null) {
  if (!routeData) {
    return [];
  }

  const seen = new Set<string>();
  const options: Array<{ id: string; label: string }> = [];

  for (const segment of routeData.segments) {
    if (!segment.floorId || segment.locationLabel.includes("Outdoor") || seen.has(segment.floorId)) {
      continue;
    }

    seen.add(segment.floorId);
    options.push({
      id: segment.floorId,
      label: segment.locationLabel.replace("Floor ", "").replace(", Academic Building", ""),
    });
  }

  return options;
}

export function MapExperience() {
  const [bootstrap, setBootstrap] = useState<CampusBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<SearchPlace | null>(null);
  const [placeDetail, setPlaceDetail] = useState<PlaceDetail | null>(null);
  const [fetchedPlaceCategory, setFetchedPlaceCategory] = useState<{
    placeId: string;
    category: string;
  } | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchPlace[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [routeMode, setRouteMode] = useState(false);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>({ start: null, end: null });
  const [routeInputs, setRouteInputs] = useState({ start: "", end: "" });
  const [activeRouteField, setActiveRouteField] = useState<"start" | "end" | null>(null);
  const [routeSearchResults, setRouteSearchResults] = useState<SearchPlace[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [loadingDirections, setLoadingDirections] = useState(false);
  const [focusedSegmentId, setFocusedSegmentId] = useState<string | null>(null);
  const [venueFocusRequest, setVenueFocusRequest] = useState(0);
  const [floorMenuOpen, setFloorMenuOpen] = useState(false);
  const [autoVisibleBuildingId, setAutoVisibleBuildingId] = useState<string | null>(null);
  const [autoVisibleBuildingFloors, setAutoVisibleBuildingFloors] = useState<
    BuildingFloorSummary[]
  >([]);
  const preferredFloorSelectionRef = useRef<string | null>(null);
  const routeInputRefs = useRef<Partial<Record<"start" | "end", HTMLInputElement | null>>>({});

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 220);
  const debouncedRouteQuery = useDebouncedValue(
    activeRouteField ? routeInputs[activeRouteField] : "",
    220,
  );
  const routeStart = routeDraft.start;
  const routeEnd = routeDraft.end;

  useEffect(() => {
    getCampusBootstrap()
      .then((data) => {
        setBootstrap(data);
        void prefetchDefaultFloorDataForBuildings(
          data.buildings.map((building) => building.buildingId ?? building.id),
        );
      })
      .catch((error: unknown) => {
        setBootstrapError(error instanceof Error ? error.message : "Failed to load campus data.");
      });
  }, []);

  useEffect(() => {
    if (!selectedPlace) {
      return;
    }

    const loadPlace = async () => {
      setLoadingPlace(true);
      setSearchError(null);

      try {
        const detail = await getPlaceDetail(selectedPlace.id);
        setPlaceDetail(detail);
        setSelectedFloorId(
          preferredFloorSelectionRef.current ??
            detail.floorId ??
            detail.defaultFloorId ??
            detail.floors[0]?.id ??
            null,
        );
        preferredFloorSelectionRef.current = null;
      } catch (error: unknown) {
        setSearchError(error instanceof Error ? error.message : "Failed to load place detail.");
      } finally {
        setLoadingPlace(false);
      }
    };

    void loadPlace();
  }, [selectedPlace]);

  useEffect(() => {
    if (
      !selectedPlace ||
      !placeDetail ||
      placeDetail.id !== selectedPlace.id ||
      Boolean(placeDetail.description || selectedPlace.category)
    ) {
      return;
    }

    let cancelled = false;

    getPlaceCategory(placeDetail.id, placeDetail.name)
      .then((category) => {
        if (!cancelled) {
          setFetchedPlaceCategory(category ? { placeId: placeDetail.id, category } : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedPlaceCategory(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placeDetail, selectedPlace]);

  useEffect(() => {
    if (!autoVisibleBuildingId || routeMode || selectedPlace) {
      return;
    }

    let cancelled = false;

    getBuildingFloors(autoVisibleBuildingId)
      .then((floors) => {
        if (!cancelled) {
          const visibleFloors = floors.filter((floor) => floor.showInPathAdvisor);
          setAutoVisibleBuildingFloors(visibleFloors);
          setSelectedFloorId(
            visibleFloors.find((floor) => floor.isDefault)?.id ??
              visibleFloors[0]?.id ??
              null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutoVisibleBuildingFloors([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [autoVisibleBuildingId, routeMode, selectedPlace]);

  const activeAutoVisibleBuildingFloors = useMemo(
    () =>
      !autoVisibleBuildingId || routeMode || selectedPlace ? [] : autoVisibleBuildingFloors,
    [autoVisibleBuildingFloors, autoVisibleBuildingId, routeMode, selectedPlace],
  );

  const focusedBuildingId = useMemo(() => {
    if (routeMode) {
      return null;
    }

    if (selectedPlace) {
      return selectedPlace.kind === "building"
        ? selectedPlace.id
        : selectedPlace.buildingId ?? placeDetail?.buildingId ?? null;
    }

    return activeAutoVisibleBuildingFloors.length > 0 ? autoVisibleBuildingId : null;
  }, [
    activeAutoVisibleBuildingFloors.length,
    autoVisibleBuildingId,
    placeDetail?.buildingId,
    routeMode,
    selectedPlace,
  ]);

  const focusedBuildingName = useMemo(() => {
    if (!focusedBuildingId || routeMode) {
      return null;
    }

    const building = bootstrap?.buildings.find((entry) => entry.id === focusedBuildingId);
    const name =
      (selectedPlace?.kind === "building" && selectedPlace.id === focusedBuildingId
        ? selectedPlace.name
        : undefined) ??
      (placeDetail?.buildingId === focusedBuildingId ? placeDetail.buildingName : undefined) ??
      building?.name;

    return name ? buildingChipLabel(name) : null;
  }, [bootstrap?.buildings, focusedBuildingId, placeDetail?.buildingId, placeDetail?.buildingName, routeMode, selectedPlace]);

  useEffect(() => {
    if (!focusedBuildingId) {
      return;
    }

    void prefetchFloorDataForBuilding(focusedBuildingId);
  }, [focusedBuildingId]);

  useEffect(() => {
    if (!selectedFloorId) {
      return;
    }

    getFloorData(selectedFloorId)
      .then((data) => {
        setFloorData(data);
      })
      .catch(() => {
        setFloorData(null);
      });
  }, [selectedFloorId]);

  useEffect(() => {
    if (routeMode) {
      return;
    }

    if (!debouncedSearchQuery.trim()) {
      return;
    }

    searchCampusPlaces(debouncedSearchQuery)
      .then((results) => {
        setSearchResults(results);
      })
      .catch((error: unknown) => {
        setSearchError(error instanceof Error ? error.message : "Search failed.");
      });
  }, [debouncedSearchQuery, routeMode]);

  useEffect(() => {
    if (!routeMode || !activeRouteField || !debouncedRouteQuery.trim()) {
      return;
    }

    searchRouteablePlaces(debouncedRouteQuery)
      .then((results) => {
        setRouteSearchResults(results);
      })
      .catch((error: unknown) => {
        setRouteError(error instanceof Error ? error.message : "Route search failed.");
      });
  }, [activeRouteField, debouncedRouteQuery, routeMode]);

  useEffect(() => {
    if (!routeMode || !routeStart || !routeEnd) {
      return;
    }

    if (routeStart.id === routeEnd.id) {
      return;
    }

    const loadDirections = async () => {
      setLoadingDirections(true);
      setRouteError(null);

      try {
        const data = await getDirections({
          start: routeStart.id,
          end: routeEnd.id,
        });

        setRouteData(data);
        setFocusedSegmentId(
          data.segments.find((segment) => segment.coordinates.length > 0)?.id ?? null,
        );
        setSelectedFloorId(
          data.startFloorId ??
            data.segments.find((segment) => Boolean(segment.floorId))?.floorId ??
            null,
        );
      } catch (error: unknown) {
        setRouteData(null);
        setRouteError(error instanceof Error ? error.message : "Directions failed.");
      } finally {
        setLoadingDirections(false);
      }
    };

    void loadDirections();
  }, [routeEnd, routeMode, routeStart]);

  const visibleSearchResults = useMemo(() => {
    if (routeMode) {
      return routeSearchResults;
    }

    return searchQuery.trim() ? searchResults : [];
  }, [routeMode, routeSearchResults, searchQuery, searchResults]);

  const effectiveRouteData =
    routeMode && routeStart && routeEnd ? routeData : null;

  const floorOptions = useMemo(() => {
    if (routeMode && routeData) {
      return routeFloorOptions(routeData).map((option) => ({
        id: option.id,
        label: option.label,
      }));
    }

    if (!selectedPlace && activeAutoVisibleBuildingFloors.length > 0) {
      return activeAutoVisibleBuildingFloors.map((floor) => ({
        id: floor.id,
        label: floorChipLabel(floor),
      }));
    }

    return (placeDetail?.floors ?? [])
      .filter((floor) => floor.showInPathAdvisor)
      .map((floor) => ({
        id: floor.id,
        label: floorChipLabel(floor),
      }));
  }, [activeAutoVisibleBuildingFloors, placeDetail?.floors, routeData, routeMode, selectedPlace]);

  const currentFloorOption =
    floorOptions.find((floor) => floor.id === selectedFloorId) ?? floorOptions[0] ?? null;

  function handleFloorSelect(floorId: string) {
    setFloorMenuOpen(false);

    if (!routeMode && !selectedPlace && autoVisibleBuildingId && bootstrap) {
      const buildingPlace =
        bootstrap.buildings.find((building) => building.id === autoVisibleBuildingId) ?? null;

      if (buildingPlace) {
        preferredFloorSelectionRef.current = floorId;
        setSelectedPlace(buildingPlace);
        return;
      }
    }

    setSelectedFloorId(floorId);
  }

  function selectPlace(place: SearchPlace) {
    setSelectedPlace(place);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setRouteMode(false);
    setRouteData(null);
    setRouteError(null);
    setFocusedSegmentId(null);
  }

  function selectBuildingFromMap(buildingId: string, name: string) {
    selectPlace({
      id: buildingId,
      kind: "building",
      name,
      subtitle: "Building",
      category: "Building",
      description: "",
      routeable: false,
      buildingId,
    });
  }

  function selectVenueFromMap(venue: {
    id: string;
    kind: "location" | "point_of_interest";
    name: string;
    subtitle: string;
  }) {
    selectPlace({
      id: venue.id,
      kind: venue.kind,
      name: venue.name,
      subtitle: venue.subtitle,
      category: venue.subtitle,
      description: "",
      routeable: true,
    });
  }

  function activateDirections() {
    if (!selectedPlace?.routeable) {
      return;
    }

    setRouteMode(true);
    setRouteData(null);
    setRouteError(null);
    setRouteDraft((current) => ({
      start: current.start,
      end: selectedPlace,
    }));
    setRouteInputs((current) => ({
      ...current,
      end: selectedPlace.name,
    }));
    setActiveRouteField("start");
  }

  function resetDirections() {
    setRouteMode(false);
    setRouteDraft({ start: null, end: null });
    setRouteInputs({ start: "", end: "" });
    setRouteSearchResults([]);
    setRouteData(null);
    setRouteError(null);
    setFocusedSegmentId(null);
    if (placeDetail) {
      setSelectedFloorId(placeDetail.floorId ?? placeDetail.defaultFloorId ?? null);
    }
  }

  function selectRouteResult(field: "start" | "end", place: SearchPlace) {
    setRouteDraft((current) => ({
      ...current,
      [field]: place,
    }));
    setRouteInputs((current) => ({
      ...current,
      [field]: place.name,
    }));
    setRouteSearchResults([]);
    setActiveRouteField(null);

    if (field === "end") {
      setSelectedPlace(place);
    }
  }

  const routeSteps = effectiveRouteData?.segments ?? [];
  const resolvedFetchedCategory =
    fetchedPlaceCategory && fetchedPlaceCategory.placeId === placeDetail?.id
      ? fetchedPlaceCategory.category
      : undefined;
  const drawerCategory = selectedPlace?.category || resolvedFetchedCategory;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <CampusMap
        bootstrap={bootstrap}
        floorData={floorData}
        focusedBuildingId={focusedBuildingId}
        focusedSegmentId={focusedSegmentId}
        isFloorSelectorVisible={floorOptions.length > 0 && Boolean(currentFloorOption)}
        onAutoVisibleBuildingChange={setAutoVisibleBuildingId}
        onSelectBuilding={selectBuildingFromMap}
        onSelectVenue={selectVenueFromMap}
        placeDetail={placeDetail}
        routeData={effectiveRouteData}
        selectedFloorId={selectedFloorId}
        selectedPlace={selectedPlace}
        venueFocusRequest={venueFocusRequest}
      />

      <div className="pointer-events-none absolute inset-0 z-500">
        <header className="px-4 pt-4 sm:px-6 sm:pt-6">
          <section className="pointer-events-auto w-full max-w-lg rounded-[1.75rem] border-2 border-slate-950 bg-white px-1.5 py-1.5 text-slate-900 shadow-[0_16px_32px_rgba(15,23,42,0.18)] sm:mr-auto">
            {!routeMode ? (
              <>
                <div className="flex h-12 items-center gap-3 px-3">
                  <MdiIcon name="magnify" className="h-5 w-5 shrink-0 opacity-65" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search buildings or facilities"
                    className="w-full border-0 bg-transparent text-base font-medium outline-none placeholder:text-slate-400"
                  />
                </div>
                {(visibleSearchResults.length > 0 || searchError) && (
                  <div className="max-h-[46vh] overflow-auto border-t border-slate-300 px-1 pt-1">
                    {searchError ? (
                      <p className="px-1 py-2 text-sm text-rose-600">{searchError}</p>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {visibleSearchResults.map((place) => (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => selectPlace(place)}
                            className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-3 text-left transition ${
                              selectedPlace?.id === place.id
                                ? "bg-sky-50"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{place.name}</p>
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                {place.subtitle}
                              </p>
                            </div>
                            <MdiIcon
                              name={place.routeable ? "arrow-top-right" : "home-outline"}
                              className="mt-0.5 h-5 w-5 shrink-0 opacity-50"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-stretch px-1 py-1">
                  <button
                    type="button"
                    onClick={resetDirections}
                    aria-label="Close directions"
                    title="Close directions"
                    className="mr-2 flex w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                  >
                    <MdiIcon name="arrow-left" />
                  </button>

                  <div className="relative min-w-0 flex-1 py-0.5">
                    <span className="absolute bottom-1/2 left-1.25 top-1/2 w-px bg-slate-200" />
                    {(["start", "end"] as const).map((field, index) => {
                      const routePlace = routeDraft[field];
                      const placeholder = field === "start" ? "Starting point" : "Destination";

                      return (
                        <div
                          key={field}
                          className={`relative flex h-9 min-w-0 items-center gap-0 pl-6 pr-1 ${
                            index === 0 ? "border-b border-slate-300" : ""
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute left-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                              field === "start" ? "bg-sky-400" : "bg-emerald-400"
                            }`}
                          />
                          <input
                            ref={(input) => {
                              routeInputRefs.current[field] = input;
                            }}
                            value={routeInputs[field]}
                            style={
                              routePlace
                                ? { width: `${Math.max(routeInputs[field].length, 1)}ch` }
                                : undefined
                            }
                            onFocus={() => setActiveRouteField(field)}
                            onChange={(event) => {
                              setRouteData(null);
                              setRouteError(null);
                              setRouteDraft((current) => ({
                                ...current,
                                [field]: null,
                              }));
                              setRouteInputs((current) => ({
                                ...current,
                                [field]: event.target.value,
                              }));
                            }}
                            placeholder={placeholder}
                            aria-label={placeholder}
                            className={`min-w-0 max-w-[64%] border-0 bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400 ${
                              routePlace ? "flex-none" : "flex-1"
                            }`}
                          />
                          {routePlace?.subtitle ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setActiveRouteField(field);
                                routeInputRefs.current[field]?.focus();
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") {
                                  return;
                                }

                                event.preventDefault();
                                setActiveRouteField(field);
                                routeInputRefs.current[field]?.focus();
                              }}
                              className="min-w-0 shrink cursor-text truncate text-[15px] text-slate-400 outline-none focus-visible:text-slate-600"
                            >
                              {" "}{routePlace.subtitle}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRouteData(null);
                      setRouteError(null);
                      setRouteDraft((current) => ({
                        start: current.end,
                        end: current.start,
                      }));
                      setRouteInputs((current) => ({
                        start: current.end,
                        end: current.start,
                      }));
                    }}
                    aria-label="Swap start and destination"
                    title="Swap start and destination"
                    className="ml-2 flex w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                  >
                    <MdiIcon name="swap-vertical" />
                  </button>
                </div>

                {(routeSearchResults.length > 0 || routeError) && activeRouteField && (
                  <div className="max-h-[40vh] overflow-auto border-t border-slate-300 px-1 pt-1">
                    {routeError ? (
                      <p className="px-1 py-2 text-sm text-rose-600">{routeError}</p>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {routeSearchResults.map((place) => (
                          <button
                            key={`${activeRouteField}-${place.id}`}
                            type="button"
                            onClick={() => selectRouteResult(activeRouteField, place)}
                            className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-slate-50"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{place.name}</p>
                              <p className="mt-1 text-xs text-slate-500">{place.subtitle}</p>
                            </div>
                            <MdiIcon name="arrow-top-right" className="mt-0.5 h-5 w-5 shrink-0 opacity-50" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </header>

        <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-550">
          {focusedBuildingName ? (
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 max-w-[calc(100vw-2rem)] -translate-x-1/2">
              <div className="truncate rounded-lg border-2 border-slate-950 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.14)]">
                {focusedBuildingName}
              </div>
            </div>
          ) : null}
          <div className="relative mx-auto w-full max-w-3xl rounded-t-[1.75rem] border-x-2 border-t-2 border-slate-950 bg-white px-4 pb-5 pt-3 text-slate-900 shadow-[0_-12px_28px_rgba(15,23,42,0.18)]">
            {floorOptions.length > 0 && currentFloorOption ? (
              <div className="pointer-events-auto absolute bottom-full left-4 mb-3 sm:left-6">
                <div className="flex flex-col-reverse items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setFloorMenuOpen((open) => !open)}
                    className="inline-flex min-w-15 items-center justify-between gap-2 rounded-lg border-2 border-slate-950 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.14)]"
                  >
                    <span>{currentFloorOption.label}</span>
                    <MdiIcon
                      name="chevron-down"
                      className={`h-4 w-4 opacity-65 transition-transform ${floorMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {floorMenuOpen ? (
                    <div className="pathadvisor-hide-scrollbar flex max-h-[42vh] flex-col gap-1 overflow-auto rounded-xl border-2 border-slate-950 bg-white p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.16)]">
                      {floorOptions.map((floor) => (
                        <button
                          key={floor.id}
                          type="button"
                          onClick={() => handleFloorSelect(floor.id)}
                          className={`rounded-md px-3 py-2 text-left text-sm font-semibold whitespace-nowrap ${
                            selectedFloorId === floor.id
                              ? "bg-slate-900 text-white"
                              : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {floor.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
            {loadingPlace ? (
              <div className="space-y-2">
                <div className="h-4 w-24 rounded-full bg-slate-200" />
                <div className="h-7 w-48 rounded-full bg-slate-200" />
                <div className="h-4 w-full rounded-full bg-slate-200" />
              </div>
            ) : routeMode ? (
              <>
                <h1 className="text-xl font-semibold text-slate-950">
                  {effectiveRouteData?.startLabel || routeDraft.start?.name || "Choose a starting point"}
                </h1>
                <div className="mt-1 flex items-center gap-1.5 text-xl font-semibold text-slate-950">
                  <MdiIcon name="arrow-right" className="h-5 w-5 shrink-0" />
                  <h2>{effectiveRouteData?.endLabel || routeDraft.end?.name || "Choose a destination"}</h2>
                </div>
                <p className="mt-2 text-sm font-medium text-[#bd7b2c]">
                  {effectiveRouteData
                    ? `${formatDuration(effectiveRouteData.time)} • ${formatDistance(effectiveRouteData.distance)}`
                    : loadingDirections
                      ? "Calculating route…"
                      : "Select two venues to calculate the route"}
                </p>

                <div className="mt-4 max-h-[34vh] space-y-2 overflow-auto pr-1">
                  {routeDraft.start && routeDraft.end && routeDraft.start.id === routeDraft.end.id ? (
                    <p className="text-sm text-rose-600">
                      Start and destination need to be different.
                    </p>
                  ) : routeError ? (
                    <p className="text-sm text-rose-600">{routeError}</p>
                  ) : loadingDirections ? (
                    <p className="text-sm text-slate-500">Calculating route…</p>
                  ) : !effectiveRouteData ? (
                    <p className="text-sm text-slate-500">
                      Select two routeable venues to display the full path, floor changes, and
                      step-by-step segments.
                    </p>
                  ) : (
                    routeSteps.map((segment: RouteSegment) => (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => {
                          setFocusedSegmentId(segment.id);
                          if (segment.floorId) {
                            setSelectedFloorId(segment.floorId);
                          }
                        }}
                        className={`w-full rounded-lg border px-3 py-3 text-left ${
                          focusedSegmentId === segment.id
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        {segment.info ? (
                          <p className="text-sm font-medium text-sky-700">{segment.info}</p>
                        ) : (
                          <>
                            <p className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                              <span>{segment.start || "Start"}</span>
                              {segment.end ? <MdiIcon name="arrow-right" className="h-4 w-4 shrink-0" /> : null}
                              {segment.end ? <span>{segment.end}</span> : null}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{segment.locationLabel}</p>
                            <p className="mt-2 text-xs text-slate-400">
                              {formatDistance(segment.distance)} • {formatDuration(segment.time)}
                            </p>
                          </>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : selectedPlace && placeDetail ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h1 className="min-w-0 text-xl font-semibold text-slate-950">
                    {venueDisplayName(placeDetail.name, drawerCategory)}
                  </h1>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={activateDirections}
                      disabled={!selectedPlace.routeable}
                      aria-label="Directions"
                      title="Directions"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <MdiIcon name="directions" className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setVenueFocusRequest((request) => request + 1)}
                      disabled={placeDetail.isBuilding || !placeDetail.coordinates}
                      aria-label="Focus venue"
                      title="Focus venue"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <MdiIcon name="crosshairs-gps" className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1">
                  <p className="mt-1 text-sm font-medium text-[#bd7b2c]">
                    {placeDetail.description || drawerCategory || "Venue"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{placeLocationLabel(placeDetail)}</p>
                </div>
              </>
            ) : bootstrap ? (
              <p className="text-sm text-slate-500">Search for a building, room, or venue.</p>
            ) : (
              <p className="text-sm text-slate-500">
                {bootstrapError || "Loading campus navigator…"}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
