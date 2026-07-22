"use client";

import { useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  getPlaceDetail,
  type BuildingFloorSummary,
  type CampusBootstrap,
  type PlaceDetail,
  type RouteData,
  type SearchPlace,
} from "@/lib/pathadvisor";
import type { MapRouteTarget } from "@/lib/map-url";
import type { RouteDraft } from "./display";

type Setter<Value> = Dispatch<SetStateAction<Value>>;

type RouteTargetHydrationOptions = {
  target: MapRouteTarget;
  bootstrap: CampusBootstrap | null;
  selectedPlace: SearchPlace | null;
  routeMode: boolean;
  routeDraft: RouteDraft;
  routeData: RouteData | null;
  preferredFloorSelectionRef: MutableRefObject<string | null>;
  setSelectedPlace: Setter<SearchPlace | null>;
  setPlaceDetail: Setter<PlaceDetail | null>;
  setSelectedFloorId: Setter<string | null>;
  setSearchQuery: Setter<string>;
  setSearchCandidatesVisible: Setter<boolean>;
  setSearchError: Setter<string | null>;
  setRouteMode: Setter<boolean>;
  setRouteDraft: Setter<RouteDraft>;
  setRouteInputs: Setter<{ start: string; end: string }>;
  setActiveRouteField: Setter<"start" | "end" | null>;
  setRouteSearchResults: Setter<SearchPlace[]>;
  setRouteError: Setter<string | null>;
  setRouteData: Setter<RouteData | null>;
  setFocusedSegmentId: Setter<string | null>;
  onInvalidTarget: () => void;
};

function searchPlaceFromDetail(detail: PlaceDetail): SearchPlace {
  const subtitle = detail.isBuilding
    ? "Building"
    : [detail.buildingName, detail.floorName].filter(Boolean).join(" • ") || "Venue";

  return {
    id: detail.id,
    kind: detail.kind,
    name: detail.name,
    subtitle,
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

export function resolvedFloorId(
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

export function useMapRouteTargetHydration({
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
}: RouteTargetHydrationOptions) {
  const appliedTargetKeyRef = useRef<string | null>(null);
  const routeTargetRequestRef = useRef(0);
  const targetKey = useMemo(
    () =>
      target.kind === "directions"
        ? JSON.stringify({ kind: target.kind, fromId: target.fromId, toId: target.toId })
        : JSON.stringify(target),
    [target],
  );

  useEffect(() => {
    if ((target.kind !== "directions" && !bootstrap) || appliedTargetKeyRef.current === targetKey) {
      return;
    }

    appliedTargetKeyRef.current = targetKey;
    const request = ++routeTargetRequestRef.current;
    const currentBootstrap = bootstrap;
    let cancelled = false;

    function isCurrentRequest() {
      return !cancelled && routeTargetRequestRef.current === request;
    }

    function invalidateTarget() {
      if (isCurrentRequest()) {
        onInvalidTarget();
      }
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
        setSearchQuery("");
        setSearchCandidatesVisible(false);
        return;
      }

      if (target.kind === "view") {
        setSearchQuery(target.searchLabel);
        setSearchCandidatesVisible(false);
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
          if (!currentBootstrap) {
            return;
          }
          const building = currentBootstrap.buildings.find((entry) => entry.id === target.buildingId);
          if (!building) {
            invalidateTarget();
            return;
          }

          if (target.floorId) {
            try {
              const detail = await getPlaceDetail(target.buildingId);
              if (!isCurrentRequest()) {
                return;
              }

              if (!detail.isBuilding || !detail.floors.some((floor) => floor.id === target.floorId && floor.showInPathAdvisor)) {
                invalidateTarget();
                return;
              }

              setPlaceDetail(detail);
              setSelectedFloorId(target.floorId);
            } catch {
              invalidateTarget();
              return;
            }
          }

          if (isCurrentRequest()) {
            preferredFloorSelectionRef.current = target.floorId ?? null;
            if (!target.floorId) {
              setPlaceDetail(null);
            }
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
            invalidateTarget();
            return;
          }

          if (target.floorId && !detail.floors.some((floor) => floor.id === target.floorId && floor.showInPathAdvisor)) {
            invalidateTarget();
            return;
          }

          setSelectedPlace(searchPlaceFromDetail(detail));
          setPlaceDetail(detail);
          setSelectedFloorId(resolvedFloorId(detail.floors, target.floorId, detail.floorId ?? detail.defaultFloorId));
        } catch {
          if (isCurrentRequest()) {
            invalidateTarget();
          }
        }
        return;
      }

      if (routeMode && routeDraft.start?.id === target.fromId && routeDraft.end?.id === target.toId) {
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
          invalidateTarget();
          return;
        }

        if (fromDetail?.id && fromDetail.id === toDetail?.id) {
          invalidateTarget();
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
      } catch {
        if (isCurrentRequest()) {
          invalidateTarget();
        }
      }
    }

    void applyTarget();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrap,
    preferredFloorSelectionRef,
    routeDraft.end?.id,
    routeDraft.start?.id,
    routeMode,
    selectedPlace?.id,
    selectedPlace?.kind,
    setActiveRouteField,
    setFocusedSegmentId,
    setPlaceDetail,
    setRouteData,
    setRouteDraft,
    setRouteError,
    setRouteInputs,
    setRouteMode,
    setRouteSearchResults,
    setSearchError,
    setSearchQuery,
    setSearchCandidatesVisible,
    setSelectedFloorId,
    setSelectedPlace,
    target,
    targetKey,
    onInvalidTarget,
  ]);

  useEffect(() => {
    if (target.kind !== "directions" || !target.fromId || !target.toId || !routeData) {
      return;
    }

    const routeStepIndex = Math.min(Math.max((target.step ?? 1) - 1, 0), routeData.segments.length - 1);
    if (
      (target.step !== undefined && target.step > routeData.segments.length) ||
      (target.floorId && !routeData.segments.some((entry) => entry.floorId === target.floorId))
    ) {
      onInvalidTarget();
      return;
    }
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
  }, [onInvalidTarget, routeData, setFocusedSegmentId, setSelectedFloorId, target]);
}
