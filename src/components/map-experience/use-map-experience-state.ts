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
import { buildingChipLabel, type RouteDraft } from "./display";
import { useMapFloorOptions } from "./use-map-floor-options";
import { resolvedFloorId, useMapRouteTargetHydration } from "./use-map-route-target-hydration";

export function useMapExperienceState(target: MapRouteTarget, onInvalidTarget: () => void) {
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
  const [searchCandidatesVisible, setSearchCandidatesVisible] = useState(false);
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

  useMapRouteTargetHydration({
    target,
    bootstrap,
    selectedPlace,
    routeMode,
    routeDraft,
    routeData,
    preferredFloorSelectionRef,
    setSelectedPlace,
    setPlaceDetail,
    setSelectedFloorId,
    setSearchQuery,
    setSearchCandidatesVisible,
    setSearchError,
    setRouteMode,
    setRouteDraft,
    setRouteInputs,
    setActiveRouteField,
    setRouteSearchResults,
    setRouteError,
    setRouteData,
    setFocusedSegmentId,
    onInvalidTarget,
  });

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

    let cancelled = false;
    void getFloorData(selectedFloorId).then(
      (data) => !cancelled && setFloorData(data),
      () => !cancelled && setFloorData(null),
    );

    return () => {
      cancelled = true;
    };
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
    if (routeMode || !searchCandidatesVisible) {
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
  }, [debouncedSearchQuery, routeMode, searchCandidatesVisible]);

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

    return searchCandidatesVisible && searchQuery.trim() ? searchResults : [];
  }, [routeMode, routeSearchResults, searchCandidatesVisible, searchQuery, searchResults]);

  const effectiveRouteData =
    routeMode && routeStart && routeEnd ? routeData : null;

  const { floorOptions, currentFloorOption, lowerFloorOption, higherFloorOption } = useMapFloorOptions({
    routeMode,
    routeData,
    activeAutoVisibleBuildingFloors,
    selectedPlace,
    placeDetail,
    selectedFloorId,
  });

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
    setSearchQuery(place.name);
    setSearchResults([]);
    setSearchCandidatesVisible(false);
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
    selectPlace, selectBuildingFromMap, selectVenueFromMap, resetDirections, selectRouteResult, handleFloorSelect, handleFloorStep, activateDirections, setActiveRouteField, setRouteData, setRouteError, setRouteDraft, setRouteInputs, setSearchQuery, setSearchCandidatesVisible, setFloorMenuOpen, setFocusedSegmentId, setVenueFocusRequest, setAutoVisibleBuildingId, setSelectedFloorId,
  };
}
