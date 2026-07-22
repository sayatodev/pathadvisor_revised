"use client";

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
  type SearchPlace,
} from "@/lib/pathadvisor";
import type { MapRouteTarget } from "@/lib/map-url";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { buildingChipLabel, floorChipLabel, routeFloorOptions, type FloorOption, type RouteDraft } from "./display";

function searchPlaceFromDetail(detail: PlaceDetail): SearchPlace {
  return {
    id: detail.id,
    kind: detail.kind,
    name: detail.name,
    subtitle: detail.isBuilding ? "Building" : detail.floorName ?? "Venue",
    category: detail.description || undefined,
    description: detail.description,
    buildingId: detail.buildingId,
    buildingName: detail.buildingName,
    floorId: detail.floorId,
    floorName: detail.floorName,
    routeable: detail.routeable,
    remoteId: detail.remoteId,
  };
}

function resolvedFloorId(
  floors: BuildingFloorSummary[],
  requestedFloorId: string | undefined,
  fallbackFloorId: string | undefined,
) {
  if (requestedFloorId && floors.some((floor) => floor.id === requestedFloorId && floor.showInPathAdvisor)) {
    return requestedFloorId;
  }

  if (fallbackFloorId && floors.some((floor) => floor.id === fallbackFloorId && floor.showInPathAdvisor)) {
    return fallbackFloorId;
  }

  return (
    floors.find((floor) => floor.isDefault && floor.showInPathAdvisor)?.id ??
    floors.find((floor) => floor.showInPathAdvisor)?.id ??
    floors[0]?.id ??
    null
  );
}

export function useMapExperienceState(target: MapRouteTarget) {
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
  const [floorStepFeedback, setFloorStepFeedback] = useState<"up" | "down" | null>(null);
  const [autoVisibleBuildingId, setAutoVisibleBuildingId] = useState<string | null>(null);
  const [autoVisibleBuildingFloors, setAutoVisibleBuildingFloors] = useState<
    BuildingFloorSummary[]
  >([]);
  const preferredFloorSelectionRef = useRef<string | null>(null);
  const floorStepFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeInputRefs = useRef<Partial<Record<"start" | "end", HTMLInputElement | null>>>({});
  const appliedTargetKeyRef = useRef<string | null>(null);
  const routeTargetRequestRef = useRef(0);

  const targetKey = useMemo(
    () =>
      target.kind === "directions"
        ? JSON.stringify({ kind: target.kind, fromId: target.fromId, toId: target.toId })
        : JSON.stringify(target),
    [target],
  );

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
    if (!bootstrap || appliedTargetKeyRef.current === targetKey) {
      return;
    }

    appliedTargetKeyRef.current = targetKey;
    const request = ++routeTargetRequestRef.current;
    const currentBootstrap = bootstrap;
    let cancelled = false;

    function isCurrentRequest() {
      return !cancelled && routeTargetRequestRef.current === request;
    }

    function clearRouteState() {
      setRouteMode(false);
      setRouteDraft({ start: null, end: null });
      setRouteInputs({ start: "", end: "" });
      setRouteSearchResults([]);
      setRouteData(null);
      setRouteError(null);
      setFocusedSegmentId(null);
    }

    async function applyTarget() {
      setSearchError(null);

      if (target.kind === "browse") {
        clearRouteState();
        setSelectedPlace(null);
        setPlaceDetail(null);
        setSelectedFloorId(null);
        return;
      }

      if (target.kind === "view") {
        if (!target.placeId && selectedPlace?.kind === "building" && selectedPlace.id === target.buildingId) {
          preferredFloorSelectionRef.current = target.floorId ?? null;
          if (target.floorId) {
            setSelectedFloorId(target.floorId);
          }
          return;
        }

        if (target.placeId && selectedPlace?.id === target.placeId) {
          preferredFloorSelectionRef.current = target.floorId ?? null;
          if (target.floorId) {
            setSelectedFloorId(target.floorId);
          }
          return;
        }

        clearRouteState();

        if (!target.placeId) {
          const building = currentBootstrap.buildings.find((entry) => entry.id === target.buildingId);
          if (!building) {
            if (isCurrentRequest()) {
              setSearchError("This building is no longer available.");
              setSelectedPlace(null);
              setPlaceDetail(null);
            }
            return;
          }

          if (isCurrentRequest()) {
            preferredFloorSelectionRef.current = target.floorId ?? null;
            setPlaceDetail(null);
            setSelectedPlace(building);
          }
          return;
        }

        try {
          const detail = await getPlaceDetail(target.placeId);
          if (!isCurrentRequest()) {
            return;
          }

          if (detail.buildingId !== target.buildingId) {
            setSearchError("This venue does not belong to the requested building.");
            setSelectedPlace(null);
            setPlaceDetail(null);
            return;
          }

          setSelectedPlace(searchPlaceFromDetail(detail));
          setPlaceDetail(detail);
          setSelectedFloorId(resolvedFloorId(detail.floors, target.floorId, detail.floorId ?? detail.defaultFloorId));
        } catch (error: unknown) {
          if (isCurrentRequest()) {
            setSearchError(error instanceof Error ? error.message : "Failed to load venue.");
            setSelectedPlace(null);
            setPlaceDetail(null);
          }
        }
        return;
      }

      if (
        routeMode &&
        routeDraft.start?.id === target.fromId &&
        routeDraft.end?.id === target.toId
      ) {
        return;
      }

      clearRouteState();
      setRouteMode(true);

      try {
        const [fromDetail, toDetail] = await Promise.all([
          target.fromId ? getPlaceDetail(target.fromId) : Promise.resolve(null),
          target.toId ? getPlaceDetail(target.toId) : Promise.resolve(null),
        ]);
        if (!isCurrentRequest()) {
          return;
        }

        if ((fromDetail && !fromDetail.routeable) || (toDetail && !toDetail.routeable)) {
          setRouteError("Directions are only available for routeable venues.");
          return;
        }

        if (fromDetail?.id && fromDetail.id === toDetail?.id) {
          setRouteError("Start and destination need to be different.");
          return;
        }

        const from = fromDetail ? searchPlaceFromDetail(fromDetail) : null;
        const to = toDetail ? searchPlaceFromDetail(toDetail) : null;
        setRouteDraft({ start: from, end: to });
        setRouteInputs({ start: from?.name ?? "", end: to?.name ?? "" });
        setActiveRouteField(from ? (to ? null : "end") : "start");
        setSelectedPlace(to);
        setPlaceDetail(toDetail);
        setSelectedFloorId(toDetail ? resolvedFloorId(toDetail.floors, target.floorId, toDetail.floorId ?? toDetail.defaultFloorId) : null);
      } catch (error: unknown) {
        if (isCurrentRequest()) {
          setRouteError(error instanceof Error ? error.message : "Failed to load directions.");
        }
      }
    }

    void applyTarget();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrap,
    routeDraft.end?.id,
    routeDraft.start?.id,
    routeMode,
    selectedPlace?.id,
    selectedPlace?.kind,
    target,
    targetKey,
  ]);

  useEffect(() => {
    if (!selectedPlace || placeDetail?.id === selectedPlace.id) {
      return;
    }

    const loadPlace = async () => {
      setLoadingPlace(true);
      setSearchError(null);

      try {
        const detail = await getPlaceDetail(selectedPlace.id);
        setPlaceDetail(detail);
        setSelectedFloorId(
          resolvedFloorId(
            detail.floors,
            preferredFloorSelectionRef.current ?? undefined,
            detail.floorId ?? detail.defaultFloorId,
          ),
        );
        preferredFloorSelectionRef.current = null;
      } catch (error: unknown) {
        setSearchError(error instanceof Error ? error.message : "Failed to load place detail.");
      } finally {
        setLoadingPlace(false);
      }
    };

    void loadPlace();
  }, [placeDetail?.id, selectedPlace]);

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

  useEffect(
    () => () => {
      if (floorStepFeedbackTimeoutRef.current) {
        clearTimeout(floorStepFeedbackTimeoutRef.current);
      }
    },
    [],
  );

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

  useEffect(() => {
    if (target.kind !== "directions" || !target.fromId || !target.toId || !routeData) {
      return;
    }

    const routeStepIndex = Math.min(Math.max((target.step ?? 1) - 1, 0), routeData.segments.length - 1);
    const segment = routeData.segments[routeStepIndex];
    if (!segment) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setFocusedSegmentId(segment.id);
      const selectedRouteFloor = target.floorId && routeData.segments.some((entry) => entry.floorId === target.floorId)
        ? target.floorId
        : segment.floorId ?? routeData.startFloorId ?? null;
      setSelectedFloorId(selectedRouteFloor);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [routeData, target]);

  const visibleSearchResults = useMemo(() => {
    if (routeMode) {
      return routeSearchResults;
    }

    return searchQuery.trim() ? searchResults : [];
  }, [routeMode, routeSearchResults, searchQuery, searchResults]);

  const effectiveRouteData =
    routeMode && routeStart && routeEnd ? routeData : null;

  const floorOptions = useMemo<FloorOption[]>(() => {
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
        elevation: floor.elevation,
      }));
    }

    return (placeDetail?.floors ?? [])
      .filter((floor) => floor.showInPathAdvisor)
      .map((floor) => ({
        id: floor.id,
        label: floorChipLabel(floor),
        elevation: floor.elevation,
      }));
  }, [activeAutoVisibleBuildingFloors, placeDetail?.floors, routeData, routeMode, selectedPlace]);

  const currentFloorOption =
    floorOptions.find((floor) => floor.id === selectedFloorId) ?? floorOptions[0] ?? null;
  const floorNavigationOptions = useMemo(() => {
    if (!floorOptions.some((floor) => floor.elevation !== undefined && floor.elevation !== null)) {
      return floorOptions;
    }

    return [...floorOptions].sort(
      (left, right) => (left.elevation ?? Number.NEGATIVE_INFINITY) - (right.elevation ?? Number.NEGATIVE_INFINITY),
    );
  }, [floorOptions]);
  const currentFloorNavigationIndex = floorNavigationOptions.findIndex(
    (floor) => floor.id === currentFloorOption?.id,
  );
  const lowerFloorOption =
    currentFloorNavigationIndex > 0 ? floorNavigationOptions[currentFloorNavigationIndex - 1] : null;
  const higherFloorOption =
    currentFloorNavigationIndex >= 0 && currentFloorNavigationIndex < floorNavigationOptions.length - 1
      ? floorNavigationOptions[currentFloorNavigationIndex + 1]
      : null;

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

  function handleFloorStep(direction: "up" | "down", floorId: string) {
    setFloorStepFeedback(direction);
    if (floorStepFeedbackTimeoutRef.current) {
      clearTimeout(floorStepFeedbackTimeoutRef.current);
    }

    floorStepFeedbackTimeoutRef.current = setTimeout(() => {
      floorStepFeedbackTimeoutRef.current = null;
      setFloorStepFeedback(null);
    }, 130);
    handleFloorSelect(floorId);
  }

  function selectPlace(place: SearchPlace) {
    setSelectedPlace(place);
    setPlaceDetail(null);
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
      setPlaceDetail(null);
    }
  }
  return {
    bootstrap, bootstrapError, selectedPlace, placeDetail, fetchedPlaceCategory, selectedFloorId, floorData, routeMode, routeDraft, routeInputs, activeRouteField, routeSearchResults, routeError, loadingDirections,
    focusedSegmentId, venueFocusRequest, floorMenuOpen, floorStepFeedback, routeInputRefs, focusedBuildingId, focusedBuildingName, visibleSearchResults, searchError, searchQuery, effectiveRouteData, floorOptions, currentFloorOption, lowerFloorOption, higherFloorOption, loadingPlace,
    selectPlace, selectBuildingFromMap, selectVenueFromMap, resetDirections, selectRouteResult, handleFloorSelect, handleFloorStep, activateDirections, setActiveRouteField, setRouteData, setRouteError, setRouteDraft, setRouteInputs, setSearchQuery, setFloorMenuOpen, setFocusedSegmentId, setVenueFocusRequest, setAutoVisibleBuildingId, setSelectedFloorId,
  };
}
