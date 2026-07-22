"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreInstance, type MapGeoJSONFeature } from "maplibre-gl";
import type { FloorData } from "@/lib/pathadvisor";
import { getDefaultFloorIdForBuilding, getFloorData } from "@/lib/pathadvisor";
import { AUTO_FLOOR_MIN_ZOOM, BASE_STYLE, BUILDING_FLOOR_FOCUS_ZOOM, HKUST_CENTER, LAYER_IDS, MAP_TAP_MIN_FOCUS_ZOOM, MAX_AUTO_BUILDINGS, ROUTE_TRANSITION_COMPACT_ZOOM, SOURCE_IDS, VENUE_FOCUS_ZOOM } from "./map/constants";
import { boundsCenter, boundsForGeometry, boundsIntersect, distanceMeters, setSourceData, type MapBoundsTuple } from "./map/geometry";
import { initializeMapSourcesAndLayers } from "./map/layers";
import { createRouteTransitionChipElement, loadFacilityImages, routeCollection, routeTransitionChips } from "./map/routes";
import { facilityCollection, floorCollection, focusedLabelCollection, labelCollection, liftCollection } from "./map/sources";
import type { MapLibreMapProps } from "./map/types";

export function MapLibreMap(props: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const routeTransitionMarkerRef = useRef<maplibregl.Marker[]>([]);
  const focusedBuildingIdRef = useRef<string | null>(props.focusedBuildingId);
  const preserveZoomForMapSelectionRef = useRef<{
    id: string;
    bounds: [[number, number], [number, number]] | null;
  } | null>(null);
  const { onAutoVisibleBuildingChange } = props;
  const callbacksRef = useRef({
    onSelectBuilding: props.onSelectBuilding,
    onSelectVenue: props.onSelectVenue,
  });
  const [mapReady, setMapReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(16);
  const [viewportBounds, setViewportBounds] = useState<MapBoundsTuple | null>(null);
  const [autoFloorDataByBuilding, setAutoFloorDataByBuilding] = useState<Record<string, FloorData>>({});

  useEffect(() => {
    callbacksRef.current = {
      onSelectBuilding: props.onSelectBuilding,
      onSelectVenue: props.onSelectVenue,
    };
  }, [props.onSelectBuilding, props.onSelectVenue]);

  useEffect(() => {
    focusedBuildingIdRef.current = props.focusedBuildingId;
  }, [props.focusedBuildingId]);

  const resolvedPlaceDetail =
    props.placeDetail?.id === props.selectedPlace?.id ? props.placeDetail : null;
  const selectedLocationId =
    resolvedPlaceDetail?.kind === "location"
      ? resolvedPlaceDetail.id
      : props.selectedPlace?.kind === "location"
        ? props.selectedPlace.id
        : undefined;
  const selectedPointOfInterestId =
    resolvedPlaceDetail?.kind === "point_of_interest"
      ? resolvedPlaceDetail.id
      : props.selectedPlace?.kind === "point_of_interest"
        ? props.selectedPlace.id
        : undefined;
  const activeBuildingId =
    props.selectedPlace?.kind === "building"
      ? props.selectedPlace.id
        : props.selectedPlace?.buildingId ?? props.placeDetail?.buildingId ?? null;
  const transitionChips = useMemo(
    () => (props.routeData ? routeTransitionChips(props.routeData.segments) : []),
    [props.routeData],
  );

  const buildingBounds = useMemo(
    () =>
      props.bootstrap?.footprints.features.map((feature) => {
        const [[west, south], [east, north]] = boundsForGeometry(feature.geometry);
        return {
          buildingId: feature.properties.buildingId,
          mapBounds: [
            [south, west],
            [north, east],
          ] as MapBoundsTuple,
        };
      }) ?? [],
    [props.bootstrap],
  );

  const visibleAutoBuildings = useMemo(() => {
    if (!viewportBounds || zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      return [];
    }

    const viewportCenter = boundsCenter(viewportBounds);
    return buildingBounds
      .filter((building) => boundsIntersect(viewportBounds, building.mapBounds))
      .sort(
        (left, right) =>
          distanceMeters(viewportCenter, boundsCenter(left.mapBounds)) -
          distanceMeters(viewportCenter, boundsCenter(right.mapBounds)),
      )
      .slice(0, MAX_AUTO_BUILDINGS);
  }, [buildingBounds, viewportBounds, zoomLevel]);

  const autoFloorLayers = useMemo(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      return [];
    }

    const visibleBuildingIds = new Set(visibleAutoBuildings.map((building) => building.buildingId));
    return Object.entries(autoFloorDataByBuilding)
      .filter(([buildingId]) => visibleBuildingIds.has(buildingId) && buildingId !== activeBuildingId)
      .map(([, floor]) => floor)
      .filter((floor) => floor.id !== props.floorData?.id);
  }, [activeBuildingId, autoFloorDataByBuilding, props.floorData?.id, visibleAutoBuildings, zoomLevel]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: HKUST_CENTER,
      zoom: 16,
      maxZoom: 22,
      touchZoomRotate: true,
      touchPitch: false,
      dragRotate: true,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });

    const reportViewport = () => {
      const bounds = map.getBounds();
      setZoomLevel(map.getZoom());
      setViewportBounds([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ]);
    };

    map.on("load", () => {
      initializeMapSourcesAndLayers(map);
      const selectCampus = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const buildingId = feature?.properties?.buildingId;
        const name = feature?.properties?.name;
        if (
          typeof buildingId === "string" &&
          typeof name === "string" &&
          buildingId !== focusedBuildingIdRef.current
        ) {
          callbacksRef.current.onSelectBuilding(buildingId, name);
        }
      };
      const selectVenue = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const properties = feature?.properties;
        const locationId = properties?.locationId;
        const pointOfInterestId = properties?.pointOfInterestId;
        const geometry = feature?.geometry;
        const bounds =
          geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
            ? boundsForGeometry(geometry)
            : null;

        if (typeof locationId === "string") {
          preserveZoomForMapSelectionRef.current = { id: locationId, bounds };
          callbacksRef.current.onSelectVenue({
            id: locationId,
            kind: "location",
            name: typeof properties?.name === "string" ? properties.name : "Venue",
            subtitle: typeof properties?.typeName === "string" ? properties.typeName : "Location",
          });
        } else if (typeof pointOfInterestId === "string") {
          preserveZoomForMapSelectionRef.current = { id: pointOfInterestId, bounds };
          callbacksRef.current.onSelectVenue({
            id: pointOfInterestId,
            kind: "point_of_interest",
            name: typeof properties?.name === "string" ? properties.name : "Point of interest",
            subtitle:
              typeof properties?.typeName === "string" ? properties.typeName : "Point of interest",
          });
        }
      };
      const showPointer = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const clearPointer = () => {
        map.getCanvas().style.cursor = "";
      };

      map.on("click", LAYER_IDS.campusFill, selectCampus);
      map.on("click", LAYER_IDS.autoFloorFill, selectVenue);
      map.on("click", LAYER_IDS.selectedFloorFill, selectVenue);
      map.on("mouseenter", LAYER_IDS.campusFill, showPointer);
      map.on("mouseleave", LAYER_IDS.campusFill, clearPointer);
      map.on("mouseenter", LAYER_IDS.autoFloorFill, showPointer);
      map.on("mouseleave", LAYER_IDS.autoFloorFill, clearPointer);
      map.on("mouseenter", LAYER_IDS.selectedFloorFill, showPointer);
      map.on("mouseleave", LAYER_IDS.selectedFloorFill, clearPointer);
      void loadFacilityImages(map);
      reportViewport();
      setMapReady(true);
    });

    map.on("moveend", reportViewport);
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    mapRef.current = map;

    return () => {
      routeTransitionMarkerRef.current.forEach((marker) => marker.remove());
      routeTransitionMarkerRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    routeTransitionMarkerRef.current.forEach((marker) => marker.remove());
    const markers = transitionChips.map((transition) =>
      new maplibregl.Marker({
        element: createRouteTransitionChipElement(transition),
        anchor: "center",
      })
        .setLngLat([transition.coordinates[1], transition.coordinates[0]])
        .addTo(map),
    );
    routeTransitionMarkerRef.current = markers;

    const updateChipScale = () => {
      const isCompact = map.getZoom() < ROUTE_TRANSITION_COMPACT_ZOOM;
      for (const marker of markers) {
        marker
          .getElement()
          .firstElementChild
          ?.classList.toggle("pathadvisor-route-transition-chip--compact", isCompact);
      }
    };

    updateChipScale();
    map.on("zoom", updateChipScale);

    return () => {
      map.off("zoom", updateChipScale);
      markers.forEach((marker) => marker.remove());
      if (routeTransitionMarkerRef.current === markers) {
        routeTransitionMarkerRef.current = [];
      }
    };
  }, [mapReady, transitionChips]);

  useEffect(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM) {
      onAutoVisibleBuildingChange(null);
      return;
    }

    onAutoVisibleBuildingChange(
      visibleAutoBuildings.length === 1 ? visibleAutoBuildings[0].buildingId : null,
    );
  }, [onAutoVisibleBuildingChange, visibleAutoBuildings, zoomLevel]);

  useEffect(() => {
    if (zoomLevel < AUTO_FLOOR_MIN_ZOOM || visibleAutoBuildings.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      visibleAutoBuildings.map(async (building) => {
        try {
          const defaultFloorId = await getDefaultFloorIdForBuilding(building.buildingId);
          return defaultFloorId ? ([building.buildingId, await getFloorData(defaultFloorId)] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setAutoFloorDataByBuilding(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, FloorData] => entry !== null)),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visibleAutoBuildings, zoomLevel]);

  const campusData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        props.bootstrap?.footprints.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            isSelected: feature.properties.buildingId === props.selectedPlace?.id,
          },
        })) ?? [],
    }),
    [props.bootstrap, props.selectedPlace?.id],
  );
  const selectedFloorData = useMemo(
    () =>
      floorCollection(
        props.floorData ? [props.floorData] : [],
        selectedLocationId,
        selectedPointOfInterestId,
      ),
    [props.floorData, selectedLocationId, selectedPointOfInterestId],
  );
  const autoFloorData = useMemo(
    () => floorCollection(autoFloorLayers, selectedLocationId, selectedPointOfInterestId),
    [autoFloorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const floorLayers = useMemo(
    () => [props.floorData, ...autoFloorLayers].filter((floor): floor is FloorData => Boolean(floor)),
    [autoFloorLayers, props.floorData],
  );
  const facilitiesData = useMemo(() => facilityCollection(floorLayers), [floorLayers]);
  const liftsData = useMemo(() => liftCollection(floorLayers), [floorLayers]);
  const labelsData = useMemo(
    () => labelCollection(floorLayers, selectedLocationId, selectedPointOfInterestId),
    [floorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const focusedLabelData = useMemo(
    () => focusedLabelCollection(floorLayers, selectedLocationId, selectedPointOfInterestId),
    [floorLayers, selectedLocationId, selectedPointOfInterestId],
  );
  const routesData = useMemo(
    () => routeCollection(props.routeData, props.focusedSegmentId),
    [props.focusedSegmentId, props.routeData],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSourceData(map, SOURCE_IDS.campus, campusData);
    setSourceData(map, SOURCE_IDS.selectedFloor, selectedFloorData);
    setSourceData(map, SOURCE_IDS.autoFloors, autoFloorData);
    setSourceData(map, SOURCE_IDS.lifts, liftsData);
    setSourceData(map, SOURCE_IDS.facilities, facilitiesData);
    setSourceData(map, SOURCE_IDS.labels, labelsData);
    setSourceData(map, SOURCE_IDS.focusedLabel, focusedLabelData);
    setSourceData(map, SOURCE_IDS.routes, routesData);
  }, [
    autoFloorData,
    campusData,
    facilitiesData,
    focusedLabelData,
    labelsData,
    liftsData,
    mapReady,
    routesData,
    selectedFloorData,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady && map.getLayer(LAYER_IDS.autoFloorFill)) {
      map.setPaintProperty(
        LAYER_IDS.autoFloorFill,
        "fill-opacity",
        props.isFloorSelectorVisible ? 0.6 : 1,
      );
    }
  }, [mapReady, props.isFloorSelectorVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (props.routeData) {
      const segment =
        props.routeData.segments.find((entry) => entry.id === props.focusedSegmentId) ??
        props.routeData.segments.find((entry) => entry.coordinates.length > 1);
      if (segment && segment.coordinates.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const [lat, lng] of segment.coordinates) {
          bounds.extend([lng, lat]);
        }
        map.fitBounds(bounds, { padding: 72, maxZoom: 19.8, duration: 500 });
      }
      return;
    }

    if (resolvedPlaceDetail?.coordinates) {
      const mapSelection = preserveZoomForMapSelectionRef.current;
      if (mapSelection && mapSelection.id === props.selectedPlace?.id) {
        const selectionBounds = mapSelection.bounds;
        preserveZoomForMapSelectionRef.current = null;

        const currentZoom = map.getZoom();
        const fitZoom = selectionBounds
          ? map.cameraForBounds(selectionBounds, { padding: 72 })?.zoom
          : undefined;
        const targetZoom =
          currentZoom < MAP_TAP_MIN_FOCUS_ZOOM
            ? MAP_TAP_MIN_FOCUS_ZOOM
            : fitZoom !== undefined && currentZoom > fitZoom
              ? fitZoom
              : null;

        if (targetZoom !== null) {
          map.flyTo({
            center: [resolvedPlaceDetail.coordinates[1], resolvedPlaceDetail.coordinates[0]],
            zoom: targetZoom,
            duration: 700,
          });
        }

        return;
      }

      map.flyTo({
        center: [resolvedPlaceDetail.coordinates[1], resolvedPlaceDetail.coordinates[0]],
        zoom: Math.max(map.getZoom(), VENUE_FOCUS_ZOOM),
        duration: 700,
      });
      return;
    }

    if (props.selectedPlace?.kind === "building" && props.bootstrap) {
      const footprint = props.bootstrap.footprints.features.find(
        (feature) => feature.properties.buildingId === props.selectedPlace?.id,
      );
      if (footprint) {
        map.fitBounds(boundsForGeometry(footprint.geometry), {
          padding: 84,
          maxZoom: BUILDING_FLOOR_FOCUS_ZOOM,
          duration: 500,
        });
      }
    }
  }, [mapReady, props.bootstrap, props.focusedSegmentId, props.routeData, props.selectedPlace, resolvedPlaceDetail, props.venueFocusRequest]);

  return <div ref={containerRef} className="absolute! inset-0!" />;
}
