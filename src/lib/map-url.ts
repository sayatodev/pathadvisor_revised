export type MapRouteTarget =
  | { kind: "browse" }
  | { kind: "view"; buildingId: string; floorId?: string; placeId?: string }
  | { kind: "directions"; fromId?: string; toId?: string; step?: number; floorId?: string };

type DirectionsOptions = {
  step?: number;
  floorId?: string;
};

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function queryString(values: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function viewPath(target: Extract<MapRouteTarget, { kind: "view" }>) {
  const segments = ["view", pathSegment(target.buildingId)];

  if (target.floorId) {
    segments.push(pathSegment(target.floorId));
  }

  if (target.placeId) {
    segments.push(pathSegment(target.placeId));
  }

  return `/${segments.join("/")}`;
}

export function directionsPath(
  target: Extract<MapRouteTarget, { kind: "directions" }>,
) {
  const options: DirectionsOptions = { step: target.step, floorId: target.floorId };

  if (target.fromId && target.toId) {
    return `/directions/${pathSegment(target.fromId)}/${pathSegment(target.toId)}${queryString({
      step: options.step,
      floor: options.floorId,
    })}`;
  }

  return `/directions${queryString({ from: target.fromId, to: target.toId })}`;
}

export function mapRoutePath(target: MapRouteTarget) {
  if (target.kind === "view") {
    return viewPath(target);
  }

  if (target.kind === "directions") {
    return directionsPath(target);
  }

  return "/";
}

function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const number = Number.parseInt(value, 10);
  return number > 0 ? number : undefined;
}

export function directionsTargetFromSearch(
  baseTarget: Extract<MapRouteTarget, { kind: "directions" }>,
  searchParams: Pick<URLSearchParams, "get">,
): Extract<MapRouteTarget, { kind: "directions" }> {
  if (baseTarget.fromId && baseTarget.toId) {
    return {
      ...baseTarget,
      step: positiveInteger(searchParams.get("step")),
      floorId: searchParams.get("floor") || undefined,
    };
  }

  return {
    kind: "directions",
    fromId: searchParams.get("from") || undefined,
    toId: searchParams.get("to") || undefined,
  };
}

function decodedSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function mapTargetFromLocation(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">,
  fallbackTarget: MapRouteTarget,
): MapRouteTarget {
  const segments = pathname.split("/").filter(Boolean).map(decodedSegment);
  if (segments.some((segment) => !segment)) {
    return fallbackTarget;
  }

  if (segments[0] === "directions") {
    if (segments.length === 3) {
      return directionsTargetFromSearch(
        { kind: "directions", fromId: segments[1]!, toId: segments[2]! },
        searchParams,
      );
    }

    if (segments.length === 1) {
      return directionsTargetFromSearch({ kind: "directions" }, searchParams);
    }
  }

  if (segments[0] === "view" && segments.length >= 2 && segments.length <= 4) {
    return {
      kind: "view",
      buildingId: segments[1]!,
      floorId: segments[2] ?? undefined,
      placeId: segments[3] ?? undefined,
    };
  }

  return pathname === "/" ? { kind: "browse" } : fallbackTarget;
}
