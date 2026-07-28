import type { Map as MapLibreInstance } from "maplibre-gl";
import type { FloorData, RouteData } from "@/lib/pathadvisor";
import { FACILITY_ICONS, LAYER_IDS, ROUTE_CONNECTOR_DOT_SPACING_METERS, ROUTE_CONNECTOR_MIN_DISTANCE_METERS, SOURCE_IDS } from "./constants";
import { distanceMeters } from "./geometry";
import { nearbyLiftNumbers } from "./lifts";

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

type RouteTransitionKind = "lift" | "escalator" | "staircase";

type RouteTransitionChip = {
  id: string;
  coordinates: [number, number];
  kind: RouteTransitionKind;
  iconSrc?: string;
  liftNumbers?: string;
  fromFloor: string;
  toFloor: string;
  relatedSegmentIds: string[];
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
      kind: "lift" as const,
      iconSrc: FACILITY_ICONS["Lift Shaft"],
      liftNumbers: liftNumber?.toUpperCase(),
    };
  }

  if (transitionDetails.includes("escalator") || hasEscalatorCode) {
    return { kind: "escalator" as const, iconSrc: FACILITY_ICONS.Escalator };
  }

  if (transitionDetails.includes("stair") || hasStairCode) {
    return { kind: "staircase" as const, iconSrc: FACILITY_ICONS.Staircase };
  }

  return null;
}

function routeTransitions(segments: RouteData["segments"], floors: FloorData[] = []): RouteTransitionChip[] {
  const floorSegments = segments.flatMap((segment, index) =>
    segment.floorId && segment.coordinates.length > 0 ? [{ segment, index }] : [],
  );

  return floorSegments.slice(1).flatMap(({ segment: nextSegment, index: nextIndex }, index) => {
    const { segment: previousSegment, index: previousIndex } = floorSegments[index];
    if (previousSegment.floorId === nextSegment.floorId) {
      return [];
    }

    const previousEnd = previousSegment.coordinates[previousSegment.coordinates.length - 1];
    const nextStart = nextSegment.coordinates[0];
    if (!previousEnd || !nextStart) {
      return [];
    }

    const transitionInstruction = segments
      .slice(previousIndex + 1, nextIndex)
      .map((segment) => segment.info)
      .filter((info): info is string => Boolean(info))
      .join(" ");
    const transition = routeTransitionType(previousSegment, nextSegment, transitionInstruction);
    if (!transition) {
      return [];
    }

    const latitude = (previousEnd[0] + nextStart[0]) / 2;
    const longitude = (previousEnd[1] + nextStart[1]) / 2;

    return [
      {
        id: `route-transition-${previousSegment.id}-${nextSegment.id}`,
        coordinates: [latitude, longitude] as [number, number],
        kind: transition.kind,
        iconSrc: transition.iconSrc,
        liftNumbers:
          transition.kind === "lift"
            ? nearbyLiftNumbers(floors, [latitude, longitude]) ?? transition.liftNumbers
            : undefined,
        fromFloor: routeFloorLabel(previousSegment),
        toFloor: routeFloorLabel(nextSegment),
        relatedSegmentIds: segments.slice(previousIndex + 1, nextIndex).map((segment) => segment.id),
      },
    ];
  });
}

function routeFloorLevel(floor: string) {
  const normalized = floor.trim().toUpperCase();
  if (normalized === "G") {
    return 0;
  }

  const basement = normalized.match(/^B(\d+)$/);
  if (basement) {
    return -Number.parseInt(basement[1], 10);
  }

  const lowerGround = normalized.match(/^LG(\d*)$/);
  if (lowerGround) {
    return -(Number.parseInt(lowerGround[1] || "1", 10));
  }

  const upperGround = normalized.match(/^UG(\d*)$/);
  if (upperGround) {
    return Number.parseInt(upperGround[1] || "1", 10);
  }

  const numeric = normalized.match(/^(?:L)?(\d+)$/);
  return numeric ? Number.parseInt(numeric[1], 10) : null;
}

function routeTransitionFloorSpan(transition: RouteTransitionChip) {
  const fromFloor = routeFloorLevel(transition.fromFloor);
  const toFloor = routeFloorLevel(transition.toFloor);
  return fromFloor === null || toFloor === null ? 1 : Math.max(Math.abs(toFloor - fromFloor), 1);
}

export function routeTransitionChips(segments: RouteData["segments"], floors?: FloorData[]): RouteTransitionChip[] {
  return routeTransitions(segments, floors);
}

export function routeTransitionSummary(segments: RouteData["segments"]) {
  return routeTransitions(segments).reduce(
    (summary, transition) => {
      if (transition.kind === "lift") {
        summary.lifts += 1;
      } else if (transition.kind === "staircase") {
        summary.staircaseFloors += routeTransitionFloorSpan(transition);
      } else {
        summary.escalatorFloors += routeTransitionFloorSpan(transition);
      }
      return summary;
    },
    { lifts: 0, staircaseFloors: 0, escalatorFloors: 0 },
  );
}

export function createRouteTransitionChipElement(transition: RouteTransitionChip, isActive: boolean) {
  const marker = document.createElement("div");
  marker.className = "pathadvisor-route-transition-marker";

  const element = document.createElement("div");
  element.className = `pathadvisor-route-transition-chip${isActive ? " pathadvisor-route-transition-chip--active" : ""}`;
  element.title = `Floor ${transition.fromFloor} to Floor ${transition.toFloor}`;
  Object.assign(element.style, {
    alignItems: "center",
    backgroundColor: isActive ? "#2d9aed" : "#3d5181",
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

    const divider = document.createElement("div");
    divider.className = "pathadvisor-route-transition-chip__divider";
    Object.assign(divider.style, {
      backgroundColor: "rgba(203, 213, 225, 0.72)",
      flex: "0 0 1px",
      height: "16px",
      width: "1px",
    });
    element.append(divider);
  }

  if (transition.liftNumbers) {
    const liftNumbers = document.createElement("span");
    liftNumbers.className = "pathadvisor-route-transition-chip__lift-numbers";
    liftNumbers.textContent = transition.liftNumbers;
    Object.assign(liftNumbers.style, {
      backgroundColor: "#64748b",
      borderRadius: "4px",
      padding: "3px 5px",
    });
    element.append(liftNumbers);
  }

  const floorAndArrow = document.createElement("span");
  Object.assign(floorAndArrow.style, {
    alignItems: "center",
    display: "flex",
    gap: "0",
  });

  const floorChange = document.createElement("span");
  floorChange.textContent = transition.fromFloor;
  floorAndArrow.append(floorChange);

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
  floorAndArrow.append(arrow);
  element.append(floorAndArrow);

  const toFloor = document.createElement("span");
  toFloor.textContent = transition.toFloor;
  element.append(toFloor);

  marker.append(element);
  return marker;
}

export function routeCollection(routeData: RouteData | null, focusedSegmentId: string | null) {
  const segmentFeatures =
    routeData?.segments.flatMap((segment) => {
      if (segment.coordinates.length < 2) {
        return [];
      }

      const display = segment.id === focusedSegmentId ? "active" : "context";

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
