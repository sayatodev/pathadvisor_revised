import type { Map as MapLibreInstance } from "maplibre-gl";
import type { RouteData } from "@/lib/pathadvisor";
import { FACILITY_ICONS, LAYER_IDS, ROUTE_CONNECTOR_DOT_SPACING_METERS, ROUTE_CONNECTOR_MIN_DISTANCE_METERS, SOURCE_IDS } from "./constants";
import { distanceMeters } from "./geometry";

function routeConnectorDots(segments: RouteData["segments"]) {
  return segments.slice(1).flatMap((segment, index) => {
    const previousSegment = segments[index];
    const previousEnd = previousSegment.coordinates[previousSegment.coordinates.length - 1];
    const nextStart = segment.coordinates[0];

    if (!previousEnd || !nextStart) {
      return [];
    }

    const gapDistance = distanceMeters(previousEnd, nextStart);
    if (gapDistance < ROUTE_CONNECTOR_MIN_DISTANCE_METERS) {
      return [];
    }

    const dotCount = Math.max(1, Math.floor(gapDistance / ROUTE_CONNECTOR_DOT_SPACING_METERS));
    return Array.from({ length: dotCount }, (_, dotIndex) => {
      const progress = (dotIndex + 1) / (dotCount + 1);
      const latitude = previousEnd[0] + (nextStart[0] - previousEnd[0]) * progress;
      const longitude = previousEnd[1] + (nextStart[1] - previousEnd[1]) * progress;

      return {
        type: "Feature" as const,
        id: `route-connector-${previousSegment.id}-${segment.id}-${dotIndex}`,
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude],
        },
        properties: { display: "connector" },
      };
    });
  });
}

function routeFloorLabel(segment: RouteData["segments"][number]) {
  return segment.locationLabel.match(/floor\s+([^,]+)/i)?.[1].trim() ?? "?";
}

type RouteTransitionChip = {
  id: string;
  coordinates: [number, number];
  iconSrc?: string;
  liftLabel?: string;
  fromFloor: string;
  toFloor: string;
};

function routeTransitionType(
  previousSegment: RouteData["segments"][number],
  nextSegment: RouteData["segments"][number],
  instruction?: string,
) {
  const transitionDetails = [
    previousSegment.end,
    previousSegment.info,
    instruction,
    nextSegment.start,
    nextSegment.info,
  ]
    .join(" ")
    .toLowerCase();
  const compactTransitionDetails = transitionDetails.replace(/[^a-z0-9]/g, "");
  const verticalCode = compactTransitionDetails.match(
    /(?:ug\d*|lg\d*|g\d*|b\d{1,2}|l\d{1,2}|\d{1,2})(esc|sc|stair|lift|li)/i,
  )?.[1]?.toLowerCase();
  const hasLiftCode = verticalCode === "lift" || verticalCode === "li";
  const hasEscalatorCode = verticalCode === "esc";
  const hasStairCode = verticalCode === "sc" || verticalCode === "stair";

  if (
    transitionDetails.includes("lift") ||
    transitionDetails.includes("elevator") ||
    hasLiftCode
  ) {
    const liftNumber = transitionDetails.match(
      /(?:lift|elevator)\s*(?:no\.?|#)?\s*([a-z]*\d+[a-z]*)/i,
    )?.[1];
    return {
      iconSrc: FACILITY_ICONS["Lift Shaft"],
      liftLabel: liftNumber ? `Lift ${liftNumber.toUpperCase()}` : "Lift",
    };
  }

  if (transitionDetails.includes("escalator") || hasEscalatorCode) {
    return { iconSrc: FACILITY_ICONS.Escalator };
  }

  if (transitionDetails.includes("stair") || hasStairCode) {
    return { iconSrc: FACILITY_ICONS.Staircase };
  }

  return null;
}

export function routeTransitionChips(segments: RouteData["segments"]): RouteTransitionChip[] {
  return segments.flatMap((instructionSegment, index) => {
    if (!instructionSegment.info) {
      return [];
    }

    const previousSegment = [...segments.slice(0, index)]
      .reverse()
      .find((segment) => Boolean(segment.floorId && segment.coordinates.length > 0));
    const nextSegment = segments
      .slice(index + 1)
      .find((segment) => Boolean(segment.floorId && segment.coordinates.length > 0));

    if (
      !previousSegment ||
      !nextSegment ||
      previousSegment.floorId === nextSegment.floorId
    ) {
      return [];
    }

    const previousEnd = previousSegment.coordinates[previousSegment.coordinates.length - 1];
    const nextStart = nextSegment.coordinates[0];
    if (!previousEnd || !nextStart) {
      return [];
    }

    const transition = routeTransitionType(
      previousSegment,
      nextSegment,
      instructionSegment.info,
    );
    if (!transition) {
      return [];
    }

    const latitude = (previousEnd[0] + nextStart[0]) / 2;
    const longitude = (previousEnd[1] + nextStart[1]) / 2;

    return [
      {
        id: `route-transition-${previousSegment.id}-${nextSegment.id}`,
        coordinates: [latitude, longitude] as [number, number],
        iconSrc: transition.iconSrc,
        liftLabel: transition.liftLabel,
        fromFloor: routeFloorLabel(previousSegment),
        toFloor: routeFloorLabel(nextSegment),
      },
    ];
  });
}

export function createRouteTransitionChipElement(transition: RouteTransitionChip) {
  const marker = document.createElement("div");
  marker.className = "pathadvisor-route-transition-marker";

  const element = document.createElement("div");
  element.className = "pathadvisor-route-transition-chip";
  element.title = `Floor ${transition.fromFloor} to Floor ${transition.toFloor}`;
  Object.assign(element.style, {
    alignItems: "center",
    backgroundColor: "#3d5181",
    border: "1px solid rgba(255, 255, 255, 0.32)",
    borderRadius: "6px",
    boxShadow: "0 4px 10px rgba(15, 23, 42, 0.28)",
    color: "#ffffff",
    display: "flex",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "12px",
    fontWeight: "700",
    gap: "6px",
    lineHeight: "1",
    padding: "6px 8px",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  });

  if (transition.iconSrc) {
    const icon = document.createElement("img");
    icon.className = "pathadvisor-route-transition-chip__icon";
    icon.src = transition.iconSrc;
    icon.alt = "";
    Object.assign(icon.style, {
      display: "block",
      flex: "0 0 16px",
      height: "16px",
      maxHeight: "16px",
      maxWidth: "16px",
      objectFit: "contain",
      width: "16px",
    });
    element.append(icon);

    const divider = document.createElement("span");
    divider.className = "pathadvisor-route-transition-chip__divider";
    divider.textContent = "|";
    element.append(divider);
  }

  if (transition.liftLabel) {
    const liftLabel = document.createElement("span");
    liftLabel.className = "pathadvisor-route-transition-chip__lift";
    liftLabel.textContent = `${transition.liftLabel} ·`;
    element.append(liftLabel);
  }

  const floorChange = document.createElement("span");
  floorChange.textContent = transition.fromFloor;
  element.append(floorChange);

  const arrow = document.createElement("img");
  arrow.className = "pathadvisor-route-transition-chip__arrow";
  arrow.src = "/mdi/chevron-down.svg";
  arrow.alt = "to";
  Object.assign(arrow.style, {
    filter: "brightness(0) invert(1)",
    height: "13px",
    transform: "rotate(-90deg)",
    width: "13px",
  });
  element.append(arrow);

  const toFloor = document.createElement("span");
  toFloor.textContent = transition.toFloor;
  element.append(toFloor);

  marker.append(element);
  return marker;
}

export function routeCollection(routeData: RouteData | null, selectedFloorId: string | null) {
  const segmentFeatures =
    routeData?.segments.flatMap((segment) => {
      if (segment.coordinates.length < 2) {
        return [];
      }

      const isOutdoor = segment.locationLabel.toLowerCase().includes("outdoor");

      // Only the selected indoor floor is the active route; all other context is dimmed.
      const display =
        !isOutdoor && segment.floorId === selectedFloorId ? "active" : "context";

      return [
        {
          type: "Feature" as const,
          id: segment.id,
          geometry: {
            type: "LineString" as const,
            coordinates: segment.coordinates.map(([lat, lng]) => [lng, lat]),
          },
          properties: { id: segment.id, display },
        },
      ];
    }) ?? [];

  return {
    type: "FeatureCollection" as const,
    features: [
      ...segmentFeatures,
      ...(routeData ? routeConnectorDots(routeData.segments) : []),
    ],
  };
}

export async function loadFacilityImages(map: MapLibreInstance) {
  await Promise.all(
    Object.entries(FACILITY_ICONS).map(async ([typeName, imageUrl]) => {
      const imageId = `facility-${typeName}`;
      if (map.hasImage(imageId)) {
        return;
      }

      try {
        const image = await map.loadImage(imageUrl);
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, image.data, { pixelRatio: 2 });
        }
      } catch {
        // A missing facility icon should not prevent the map from rendering.
      }
    }),
  );

  if (!map.getLayer(LAYER_IDS.liftIcons)) {
    map.addLayer({
      id: LAYER_IDS.liftIcons,
      type: "symbol",
      source: SOURCE_IDS.lifts,
      minzoom: 17.5,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.385,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 11,
        "text-anchor": "left",
        "text-offset": [1.1, 0],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#a5c3f2",
        "text-halo-color": "rgba(15,23,42,0.9)",
        "text-halo-width": 1,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.facilityIcons)) {
    map.addLayer({
      id: LAYER_IDS.facilityIcons,
      type: "symbol",
      source: SOURCE_IDS.facilities,
      minzoom: 18.2,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.385,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.focusedVenueLabel)) {
    map.addLayer({
      id: LAYER_IDS.focusedVenueLabel,
      type: "symbol",
      source: SOURCE_IDS.focusedLabel,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 0, 12, 20, 15],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#f2a5bd",
        "text-halo-color": "#000000",
        "text-halo-width": 1.1,
      },
    });
  }
}
