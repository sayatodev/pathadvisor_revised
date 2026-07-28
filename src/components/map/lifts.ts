import type { FloorData } from "@/lib/pathadvisor";
import { distanceMeters, featureCenter } from "./geometry";

export function compressLiftNumbers(labels: string[]) {
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
    return undefined;
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
  return ranges.join(",");
}

export function nearbyLiftNumbers(floors: FloorData[], center: [number, number]) {
  const labels = floors.flatMap((floor) =>
    floor.features.flatMap((feature) => {
      if (feature.properties.typeName !== "Lift Shaft") {
        return [];
      }

      const [lng, lat] = featureCenter(feature.geometry);
      return distanceMeters(center, [lat, lng]) < 7 ? [feature.properties.name || "Lift"] : [];
    }),
  );

  return compressLiftNumbers(labels);
}
