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

const OSMMap = dynamic(
  () => import("@/components/osm-map").then((module) => module.OSMMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 animate-pulse bg-[linear-gradient(180deg,_#d9e7f4_0%,_#ecf4fb_100%)]" />
    ),
  },
);

type RouteDraft = {
  start: SearchPlace | null;
  end: SearchPlace | null;
};

type SelectionSource = "search" | "map";

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
  const [selectionSource, setSelectionSource] = useState<SelectionSource>("search");
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
      return placeDetail?.buildingId ?? null;
    }

    return activeAutoVisibleBuildingFloors.length > 0 ? autoVisibleBuildingId : null;
  }, [
    activeAutoVisibleBuildingFloors.length,
    autoVisibleBuildingId,
    placeDetail?.buildingId,
    routeMode,
    selectedPlace,
  ]);

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
        setSelectionSource("search");
        return;
      }
    }

    setSelectedFloorId(floorId);
  }

  function selectPlace(place: SearchPlace, source: SelectionSource = "search") {
    setSelectedPlace(place);
    setSelectionSource(source);
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
      description: "",
      routeable: false,
      buildingId,
    }, "map");
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
      description: "",
      routeable: true,
    }, "map");
  }

  function activateDirections() {
    if (!selectedPlace?.routeable) {
      return;
    }

    setRouteMode(true);
    setSelectionSource("search");
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
      setSelectionSource("search");
    }
  }

  const routeSteps = effectiveRouteData?.segments ?? [];

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <OSMMap
        bootstrap={bootstrap}
        floorData={floorData}
        focusedSegmentId={focusedSegmentId}
        interactionSource={selectionSource}
        isFloorSelectorVisible={floorOptions.length > 0 && Boolean(currentFloorOption)}
        onAutoVisibleBuildingChange={setAutoVisibleBuildingId}
        onSelectBuilding={selectBuildingFromMap}
        onSelectVenue={selectVenueFromMap}
        placeDetail={placeDetail}
        routeData={effectiveRouteData}
        selectedFloorId={selectedFloorId}
        selectedPlace={selectedPlace}
      />

      <div className="pointer-events-none absolute inset-0 z-[500]">
        <header className="px-4 pt-4 sm:px-6 sm:pt-6">
          <section className="pointer-events-auto w-full max-w-lg rounded-[1.3rem] border border-slate-200/80 bg-white/92 px-0 py-1 text-slate-900 shadow-[0_20px_52px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:mr-auto">
            {!routeMode ? (
              <>
                <div className="flex items-center gap-2 rounded-[0.95rem] bg-white px-3 py-2.5">
                  <span className="text-base text-slate-400">⌕</span>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search buildings or facilities"
                    className="w-full border-0 bg-transparent text-[14px] font-medium outline-none placeholder:text-slate-400"
                  />
                </div>
                {(visibleSearchResults.length > 0 || searchError) && (
                  <div className="mt-3 max-h-[46vh] overflow-auto pr-1">
                    {searchError ? (
                      <p className="px-1 py-2 text-sm text-rose-600">{searchError}</p>
                    ) : (
                      <div className="space-y-2">
                        {visibleSearchResults.map((place) => (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => selectPlace(place)}
                            className={`flex w-full items-start justify-between gap-3 rounded-[1.05rem] border px-3 py-3 text-left transition ${
                              selectedPlace?.id === place.id
                                ? "border-sky-300 bg-sky-50"
                                : "border-transparent bg-slate-50/90 hover:border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{place.name}</p>
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                {place.subtitle}
                              </p>
                            </div>
                            <span className="mt-0.5 text-slate-400">{place.routeable ? "↗" : "⌂"}</span>
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
                    className="mr-2 flex w-10 shrink-0 items-center justify-center rounded-2xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                  >
                    <Image src="/buttons/arrow-back.png" alt="" width={20} height={20} />
                  </button>

                  <div className="relative min-w-0 flex-1 py-0.5">
                    <span className="absolute bottom-1/2 left-[5px] top-1/2 w-px bg-slate-200" />
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
                            className={`min-w-0 max-w-[64%] border-0 bg-transparent text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400 ${
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
                    className="ml-2 flex w-10 shrink-0 items-center justify-center rounded-2xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                  >
                    <Image src="/buttons/swap-vertical.png" alt="" width={20} height={20} />
                  </button>
                </div>

                {(routeSearchResults.length > 0 || routeError) && activeRouteField && (
                  <div className="mt-3 max-h-[40vh] overflow-auto pr-1">
                    {routeError ? (
                      <p className="px-1 py-2 text-sm text-rose-600">{routeError}</p>
                    ) : (
                      <div className="space-y-2">
                        {routeSearchResults.map((place) => (
                          <button
                            key={`${activeRouteField}-${place.id}`}
                            type="button"
                            onClick={() => selectRouteResult(activeRouteField, place)}
                            className="flex w-full items-start justify-between gap-3 rounded-[1rem] border border-transparent bg-slate-50/90 px-3 py-3 text-left hover:border-slate-200 hover:bg-white"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{place.name}</p>
                              <p className="mt-1 text-xs text-slate-500">{place.subtitle}</p>
                            </div>
                            <span className="mt-0.5 text-slate-400">↗</span>
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

        <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-[550]">
          <div className="relative mx-auto w-full max-w-3xl rounded-t-[1.8rem] border border-slate-200 bg-white px-5 pb-6 pt-3 text-slate-900 shadow-[0_-16px_48px_rgba(15,23,42,0.16)]">
            {floorOptions.length > 0 && currentFloorOption ? (
              <div className="pointer-events-auto absolute bottom-full left-4 mb-3 sm:left-6">
                <div className="flex flex-col-reverse items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setFloorMenuOpen((open) => !open)}
                    className="inline-flex min-w-16 items-center justify-between gap-3 rounded-[1.15rem] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-[0_14px_40px_rgba(15,23,42,0.15)]"
                  >
                    <span>{currentFloorOption.label}</span>
                    <span className={`text-xs text-slate-500 transition-transform ${floorMenuOpen ? "rotate-180" : ""}`}>
                      ▾
                    </span>
                  </button>

                  {floorMenuOpen ? (
                    <div className="pathadvisor-hide-scrollbar flex max-h-[42vh] flex-col gap-2 overflow-auto rounded-[1.25rem] border border-slate-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
                      {floorOptions.map((floor) => (
                        <button
                          key={floor.id}
                          type="button"
                          onClick={() => handleFloorSelect(floor.id)}
                          className={`rounded-[0.95rem] px-3 py-2 text-left text-sm font-semibold whitespace-nowrap ${
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
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
            {loadingPlace ? (
              <div className="space-y-2">
                <div className="h-4 w-24 rounded-full bg-slate-200" />
                <div className="h-7 w-48 rounded-full bg-slate-200" />
                <div className="h-4 w-full rounded-full bg-slate-200" />
              </div>
            ) : routeMode ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700/80">
                  Directions
                </p>
                <h1 className="mt-2 text-lg font-semibold">
                  {effectiveRouteData?.endLabel || routeDraft.end?.name || "Choose a destination"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {effectiveRouteData?.startLabel
                    ? `From ${effectiveRouteData.startLabel}`
                    : routeDraft.start
                      ? `From ${routeDraft.start.name}`
                      : "Add a starting point to calculate the route"}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Time</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {effectiveRouteData
                        ? formatDuration(effectiveRouteData.time)
                        : loadingDirections
                          ? "…"
                          : "—"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Distance</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {effectiveRouteData
                        ? formatDistance(effectiveRouteData.distance)
                        : loadingDirections
                          ? "…"
                          : "—"}
                    </p>
                  </div>
                </div>

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
                        className={`w-full rounded-[1rem] border px-3 py-3 text-left ${
                          focusedSegmentId === segment.id
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        {segment.info ? (
                          <p className="text-sm font-medium text-sky-700">{segment.info}</p>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-slate-900">
                              {segment.start || "Start"}{segment.end ? ` → ${segment.end}` : ""}
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700/80">
                  {placeDetail.isBuilding ? "Building" : "Venue"}
                </p>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-semibold">{placeDetail.name}</h1>
                    <p className="mt-1 text-sm text-slate-500">
                      {placeDetail.address ||
                        [placeDetail.buildingName, placeDetail.floorName].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
                    {selectedPlace.subtitle}
                  </span>
                </div>

                {placeDetail.description ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600">{placeDetail.description}</p>
                ) : null}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={activateDirections}
                    disabled={!selectedPlace.routeable}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                      selectedPlace.routeable
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    Directions
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchQuery(placeDetail.name)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Search Similar
                  </button>
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
