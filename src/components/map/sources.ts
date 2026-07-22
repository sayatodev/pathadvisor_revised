import type { FloorData } from "@/lib/pathadvisor";
import { FACILITY_ICONS } from "./constants";
import {
  darkenColorHex,
  distanceMeters,
  featureCenter,
  isClickableFloorFeature,
  isCourtyardFeature,
  isPathwayLikeFeature,
  normalizeColorHex,
} from "./geometry";

export function floorCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.map((feature) => {
        const isCourtyard = isCourtyardFeature(feature.properties);
        const fillColor = normalizeColorHex(
          isCourtyard ? "#a8e6b6" : feature.properties.colorHex,
          isPathwayLikeFeature(feature.properties) ? "#ffffff" : "#d1d5db",
        );
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);

        return {
          type: "Feature" as const,
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            ...feature.properties,
            fillColor,
            selectedFillColor: darkenColorHex(fillColor, 0.22),
            selectedOutlineColor: darkenColorHex(fillColor, 0.42),
            isCourtyard,
            isSelected,
            isClickable: isClickableFloorFeature(feature.properties),
            isPathway: isPathwayLikeFeature(feature.properties),
          },
        };
      })),
  };
}

export function facilityCollection(floors: FloorData[]) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const icon = FACILITY_ICONS[feature.properties.typeName];
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          feature.properties.remoteId ??
          `${floor.id}:${feature.id}`;

        if (feature.properties.typeName === "Lift Shaft" || !icon || seen.has(dedupeKey)) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: {
              icon: `facility-${feature.properties.typeName}`,
              name: feature.properties.name || feature.properties.typeName,
            },
          },
        ];
      }),
    ),
  };
}

function compressLiftNumbers(labels: string[]) {
  const numbers = Array.from(
    new Set(
      labels
        .map((label) => {
          const match = label.match(/(\d+)/);
          return match ? Number.parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null),
    ),
  ).sort((left, right) => left - right);

  if (numbers.length === 0) {
    return "Lift";
  }

  const ranges: string[] = [];
  let rangeStart = numbers[0];
  let previous = numbers[0];

  for (const current of numbers.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
  return `Lift ${ranges.join(",")}`;
}

export function liftCollection(floors: FloorData[]) {
  const groups: Array<{ center: [number, number]; names: string[] }> = [];

  for (const floor of floors) {
    for (const feature of floor.features) {
      if (feature.properties.typeName !== "Lift Shaft") {
        continue;
      }

      const [lng, lat] = featureCenter(feature.geometry);
      const center: [number, number] = [lat, lng];
      const group = groups.find((entry) => distanceMeters(entry.center, center) < 7);

      if (group) {
        group.names.push(feature.properties.name || "Lift");
      } else {
        groups.push({ center, names: [feature.properties.name || "Lift"] });
      }
    }
  }

  return {
    type: "FeatureCollection" as const,
    features: groups.map((group, index) => ({
      type: "Feature" as const,
      id: `lift-group-${index}`,
      geometry: {
        type: "Point" as const,
        coordinates: [group.center[1], group.center[0]],
      },
      properties: {
        icon: "facility-Lift Shaft",
        label: compressLiftNumbers(group.names),
      },
    })),
  };
}

export function labelCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);
        const name = feature.properties.name.trim();
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          feature.properties.remoteId ??
          `${floor.id}:${feature.id}`;

        if (
          !name ||
          isSelected ||
          FACILITY_ICONS[feature.properties.typeName] ||
          feature.properties.typeName === "Lift Shaft" ||
          seen.has(dedupeKey)
        ) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: { name },
          },
        ];
      }),
    ),
  };
}

export function focusedLabelCollection(
  floors: FloorData[],
  selectedLocationId?: string,
  selectedPointOfInterestId?: string,
) {
  const seen = new Set<string>();

  return {
    type: "FeatureCollection" as const,
    features: floors.flatMap((floor) =>
      floor.features.flatMap((feature) => {
        const isSelected =
          (Boolean(selectedLocationId) && feature.properties.locationId === selectedLocationId) ||
          (Boolean(selectedPointOfInterestId) &&
            feature.properties.pointOfInterestId === selectedPointOfInterestId);
        const name = feature.properties.name.trim();
        const dedupeKey =
          feature.properties.locationId ??
          feature.properties.pointOfInterestId ??
          `${floor.id}:${feature.id}`;

        if (!isSelected || !name || seen.has(dedupeKey)) {
          return [];
        }

        seen.add(dedupeKey);
        const [lng, lat] = featureCenter(feature.geometry);
        return [
          {
            type: "Feature" as const,
            id: dedupeKey,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
            properties: { name },
          },
        ];
      }),
    ),
  };
}
