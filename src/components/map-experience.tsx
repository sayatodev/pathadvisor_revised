"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getPlaceDetail, type SearchPlace } from "@/lib/pathadvisor";
import { directionsPath, directionsTargetFromSearch, mapTargetFromLocation, type MapRouteTarget, viewPath } from "@/lib/map-url";
import { MdiIcon, MdiMaskIcon, formatDistance, formatDuration, placeLocationLabel, venueDisplayName } from "./map-experience/display";
import { routeTransitionSummary } from "./map/routes";
import { useMapExperienceState } from "./map-experience/use-map-experience-state";

const CampusMap = dynamic(
  () => import("@/components/maplibre-map").then((module) => module.MapLibreMap),
  { ssr: false, loading: () => <div className="absolute inset-0 animate-pulse bg-[linear-gradient(180deg,#d9e7f4_0%,#ecf4fb_100%)]" /> },
);

export function MapExperience({ target }: { target: MapRouteTarget }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [initialPathname] = useState(pathname);
  const locationTarget = useMemo(() => mapTargetFromLocation(pathname, searchParams, target), [pathname, searchParams, target]);
  const routeTarget = useMemo(() => {
    if (pathname !== initialPathname) {
      return locationTarget;
    }

    return target.kind === "directions" ? directionsTargetFromSearch(target, searchParams) : target;
  }, [initialPathname, locationTarget, pathname, searchParams, target]);
  const handleInvalidTarget = useCallback(() => {
    window.location.replace("/");
  }, []);
  const {
    bootstrap, bootstrapError, selectedPlace, placeDetail, fetchedPlaceCategory, selectedFloorId, floorData,
    routeMode, routeDraft, routeInputs, activeRouteField, routeSearchResults, routeError, loadingDirections,
    focusedSegmentId, venueFocusRequest, floorMenuOpen, floorStepFeedback, routeInputRefs,
    focusedBuildingId, focusedBuildingName, visibleSearchResults, searchError, searchQuery,
    effectiveRouteData, floorOptions, currentFloorOption, lowerFloorOption, higherFloorOption,
    loadingPlace, selectPlace, selectBuildingFromMap, selectVenueFromMap,
    resetDirections, selectRouteResult, handleFloorSelect, handleFloorStep, activateDirections,
    setActiveRouteField, setRouteData, setRouteError, setRouteDraft, setRouteInputs, setSearchQuery,
    setSearchCandidatesVisible, setFloorMenuOpen, setFocusedSegmentId, setVenueFocusRequest, setAutoVisibleBuildingId, setSelectedFloorId,
  } = useMapExperienceState(routeTarget, handleInvalidTarget);

  const routeSteps = effectiveRouteData?.segments ?? [];
  const focusedRouteStepIndex = routeSteps.findIndex((segment) => segment.id === focusedSegmentId);
  const activeRouteStepIndex = focusedRouteStepIndex >= 0 ? focusedRouteStepIndex : 0;
  const activeRouteStep = routeSteps[activeRouteStepIndex] ?? null;
  const transitionSummary = effectiveRouteData ? routeTransitionSummary(effectiveRouteData.segments) : null;
  const resolvedFetchedCategory =
    fetchedPlaceCategory && fetchedPlaceCategory.placeId === placeDetail?.id
      ? fetchedPlaceCategory.category
      : undefined;
  const drawerCategory = selectedPlace?.category || resolvedFetchedCategory;

  function navigate(href: string) {
    window.history.pushState(null, "", href);
  }

  async function navigateToPlaceId(placeId: string) {
    try {
      const detail = await getPlaceDetail(placeId);
      const buildingId = detail.buildingId ?? (detail.isBuilding ? detail.id : undefined);
      if (!buildingId) {
        return;
      }

      if (detail.isBuilding) {
        navigate(viewPath({ kind: "view", searchLabel: detail.name, buildingId }));
        return;
      }

      const floorId =
        detail.floorId ??
        detail.defaultFloorId ??
        detail.floors.find((floor) => floor.isDefault && floor.showInPathAdvisor)?.id ??
        detail.floors.find((floor) => floor.showInPathAdvisor)?.id;
      if (floorId) {
        navigate(viewPath({ kind: "view", searchLabel: detail.name, buildingId, floorId, placeId: detail.id }));
      }
    } catch {
      // Keep the current view when a click cannot be resolved by the upstream service.
    }
  }

  function handlePlaceSelection(place: SearchPlace) {
    selectPlace(place);
    if (place.kind === "building") {
      navigate(viewPath({ kind: "view", searchLabel: place.name, buildingId: place.id }));
      return;
    }

    void navigateToPlaceId(place.id);
  }

  function handleFloorNavigation(floorId: string, direction?: "up" | "down") {
    if (direction) {
      handleFloorStep(direction, floorId);
    } else {
      handleFloorSelect(floorId);
    }

    if (routeMode) {
      const selectedSegmentIndex = routeSteps.findIndex((segment) => segment.id === focusedSegmentId);
      const segmentIndex = routeSteps[selectedSegmentIndex]?.floorId === floorId
        ? selectedSegmentIndex
        : routeSteps.findIndex((segment) => segment.floorId === floorId);
      if (segmentIndex >= 0) {
        focusRouteStep(segmentIndex);
        return;
      }
    }

    if (routeTarget.kind === "directions" && routeTarget.fromId && routeTarget.toId) {
      window.history.pushState(null, "", directionsPath({ ...routeTarget, floorId }));
      return;
    }

    const buildingId = routeTarget.kind === "view" ? routeTarget.buildingId : focusedBuildingId;
    if (buildingId) {
      navigate(viewPath({
        kind: "view",
        searchLabel: routeTarget.kind === "view"
          ? routeTarget.searchLabel
          : searchQuery || selectedPlace?.name || bootstrap?.buildings.find((building) => building.id === buildingId)?.name || "Campus",
        buildingId,
        floorId,
        placeId: routeTarget.kind === "view" ? routeTarget.placeId : undefined,
      }));
    }
  }

  function handleDirectionsActivation() {
    if (selectedPlace?.routeable) {
      activateDirections();
      navigate(directionsPath({ kind: "directions", toName: selectedPlace.name, toId: selectedPlace.id }));
    }
  }

  function handleRouteResult(field: "start" | "end", place: SearchPlace) {
    selectRouteResult(field, place);
    navigate(directionsPath({
      kind: "directions",
      fromName: field === "start" ? place.name : routeDraft.start?.name,
      toName: field === "end" ? place.name : routeDraft.end?.name,
      fromId: field === "start" ? place.id : routeDraft.start?.id,
      toId: field === "end" ? place.id : routeDraft.end?.id,
    }));
  }

  function handleRouteSwap() {
    setRouteData(null);
    setRouteError(null);
    setRouteDraft((current) => ({ start: current.end, end: current.start }));
    setRouteInputs((current) => ({ start: current.end, end: current.start }));
    navigate(directionsPath({
      kind: "directions",
      fromName: routeDraft.end?.name,
      toName: routeDraft.start?.name,
      fromId: routeDraft.end?.id,
      toId: routeDraft.start?.id,
    }));
  }

  function handleCloseDirections() {
    resetDirections();
    if (routeDraft.end) {
      void navigateToPlaceId(routeDraft.end.id);
      return;
    }

    navigate("/");
  }

  function focusRouteStep(index: number) {
    const segment = routeSteps[index];
    if (!segment) {
      return;
    }

    const selectedRouteFloorId =
      segment.floorId ?? routeSteps.slice(0, index).reverse().find((entry) => entry.floorId)?.floorId;
    setFocusedSegmentId(segment.id);
    if (selectedRouteFloorId) {
      setSelectedFloorId(selectedRouteFloorId);
    }

    if (routeTarget.kind === "directions" && routeTarget.fromId && routeTarget.toId) {
      window.history.pushState(
        null,
        "",
        directionsPath({ ...routeTarget, step: index + 1, floorId: selectedRouteFloorId }),
      );
    }
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <CampusMap
        bootstrap={bootstrap}
        floorData={floorData}
        focusedBuildingId={focusedBuildingId}
        focusedSegmentId={focusedSegmentId}
        isFloorSelectorVisible={floorOptions.length > 0 && Boolean(currentFloorOption)}
        onAutoVisibleBuildingChange={setAutoVisibleBuildingId}
        onSelectBuilding={(buildingId, name) => {
          selectBuildingFromMap(buildingId, name);
          navigate(viewPath({ kind: "view", searchLabel: name, buildingId }));
        }}
        onSelectVenue={(venue) => {
          selectVenueFromMap(venue);
          void navigateToPlaceId(venue.id);
        }}
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
                    onFocus={() => setSearchCandidatesVisible(true)}
                    onChange={(event) => {
                      setSearchCandidatesVisible(true);
                      setSearchQuery(event.target.value);
                    }}
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
                            onClick={() => handlePlaceSelection(place)}
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
                    onClick={handleCloseDirections}
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
                    onClick={handleRouteSwap}
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
                            onClick={() => handleRouteResult(activeRouteField, place)}
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
              <>
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
                          onClick={() => handleFloorNavigation(floor.id)}
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
              <div className="pointer-events-auto absolute bottom-full right-4 mb-3 sm:right-6">
                <div className="overflow-hidden rounded-lg border-2 border-slate-950 bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.14)]">
                  <button
                    type="button"
                    aria-label="Go up one floor"
                    title="Go up one floor"
                    disabled={!higherFloorOption}
                    onClick={() => higherFloorOption && handleFloorNavigation(higherFloorOption.id, "up")}
                    className={`inline-flex h-10 w-10 items-center justify-center transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 ${
                      floorStepFeedback === "up" ? "bg-slate-200" : "bg-white"
                    }`}
                  >
                    <MdiIcon name="chevron-down" className="h-5 w-5 rotate-180" />
                  </button>
                  <div className="mx-2 h-px bg-slate-300" />
                  <button
                    type="button"
                    aria-label="Go down one floor"
                    title="Go down one floor"
                    disabled={!lowerFloorOption}
                    onClick={() => lowerFloorOption && handleFloorNavigation(lowerFloorOption.id, "down")}
                    className={`inline-flex h-10 w-10 items-center justify-center transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 ${
                      floorStepFeedback === "down" ? "bg-slate-200" : "bg-white"
                    }`}
                  >
                    <MdiIcon name="chevron-down" className="h-5 w-5" />
                  </button>
                </div>
              </div>
              </>
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
                <div className="min-w-0 text-base font-semibold text-slate-950">
                  <h1 className="truncate">
                    {effectiveRouteData?.startLabel || routeDraft.start?.name || "Choose a starting point"}
                  </h1>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <MdiIcon name="arrow-right" className="h-4 w-4 shrink-0" />
                    <h2 className="truncate">{effectiveRouteData?.endLabel || routeDraft.end?.name || "Choose a destination"}</h2>
                  </div>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-[#bd7b2c]">
                  {effectiveRouteData
                    ? <>
                        <span>{formatDuration(effectiveRouteData.time)} • {formatDistance(effectiveRouteData.distance)}</span>
                        {transitionSummary?.lifts ? <>
                          <span aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1" aria-label={`${transitionSummary.lifts} lift movements`}>
                            <MdiMaskIcon name="elevator-passenger" className="h-3.5 w-3.5" />
                            <span>{transitionSummary.lifts}</span>
                          </span>
                        </> : null}
                        {transitionSummary?.staircaseFloors ? <>
                          <span aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1" aria-label={`${transitionSummary.staircaseFloors} staircase floors`}>
                            <MdiMaskIcon name="stairs" className="h-3.5 w-3.5" />
                            <span>{transitionSummary.staircaseFloors} floors</span>
                          </span>
                        </> : null}
                        {transitionSummary?.escalatorFloors ? <>
                          <span aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1" aria-label={`${transitionSummary.escalatorFloors} escalator floors`}>
                            <MdiMaskIcon name="escalator" className="h-3.5 w-3.5" />
                            <span>{transitionSummary.escalatorFloors} floors</span>
                          </span>
                        </> : null}
                      </>
                    : loadingDirections
                      ? "Calculating route…"
                      : "Select two venues to calculate the route"}
                </p>

                <div className="mt-3">
                  {routeDraft.start && routeDraft.end && routeDraft.start.id === routeDraft.end.id ? (
                    <p className="text-xs text-rose-600">
                      Start and destination need to be different.
                    </p>
                  ) : routeError ? (
                    <p className="text-xs text-rose-600">{routeError}</p>
                  ) : loadingDirections ? (
                    <p className="text-xs text-slate-500">Calculating route…</p>
                  ) : !effectiveRouteData ? (
                    <p className="text-xs text-slate-500">
                      Select two routeable venues to display the full path, floor changes, and
                      step-by-step segments.
                    </p>
                  ) : activeRouteStep ? (
                    <div>
                      <div className="flex items-stretch gap-2" role="group" aria-label="Route segments">
                        <button
                          type="button"
                          onClick={() => focusRouteStep(activeRouteStepIndex - 1)}
                          disabled={activeRouteStepIndex === 0}
                          aria-label="Previous route segment"
                          title="Previous route segment"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-35"
                        >
                          <MdiIcon name="arrow-left" className="h-4 w-4" />
                        </button>

                        <div className="min-w-0 flex-1 px-1 py-1">
                          {activeRouteStep.info ? (
                            <p className="line-clamp-2 text-sm leading-5 font-semibold text-sky-800">
                              {activeRouteStep.info}
                            </p>
                          ) : (
                            <p className="flex min-w-0 items-center gap-1 text-sm font-semibold text-sky-800">
                              <span className="truncate">{activeRouteStep.start || "Start"}</span>
                              {activeRouteStep.end ? <MdiIcon name="arrow-right" className="h-4 w-4 shrink-0" /> : null}
                              {activeRouteStep.end ? <span className="truncate">{activeRouteStep.end}</span> : null}
                            </p>
                          )}
                          <div className="mt-1 flex min-h-4 items-center gap-2 text-[11px] font-medium text-slate-500">
                            {activeRouteStep.locationLabel ? <span className="min-w-0 flex-1 truncate">{activeRouteStep.locationLabel}</span> : null}
                            <span className="ml-auto shrink-0">
                              {formatDistance(activeRouteStep.distance)} • {formatDuration(activeRouteStep.time)}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => focusRouteStep(activeRouteStepIndex + 1)}
                          disabled={activeRouteStepIndex === routeSteps.length - 1}
                          aria-label="Next route segment"
                          title="Next route segment"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-35"
                        >
                          <MdiIcon name="arrow-right" className="h-4 w-4" />
                        </button>
                      </div>
                      <p aria-live="polite" className="mt-1 text-center text-[11px] font-medium text-slate-500">
                        {activeRouteStepIndex + 1}/{routeSteps.length}
                      </p>
                    </div>
                  ) : null}
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
                      onClick={handleDirectionsActivation}
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
              <p className={`text-sm ${searchError ? "text-rose-600" : "text-slate-500"}`}>
                {searchError || "Search for a building, room, or venue."}
              </p>
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
