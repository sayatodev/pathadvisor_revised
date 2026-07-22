export type MapRouteTarget =
  | { kind: "browse" }
  | { kind: "view"; searchLabel: string; buildingId: string; floorId?: string; placeId?: string }
  | {
    kind: "directions";
    fromName?: string;
    toName?: string;
    fromId?: string;
    toId?: string;
    step?: number;
    floorId?: string;
  };

type DirectionsOptions = {
  step?: number;
  floorId?: string;
};

function pathSegment(value: string) {
  return encodeURIComponent(value).replace(/%20/g, "+");
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
  const segments = ["view", pathSegment(target.searchLabel), pathSegment(target.buildingId)];

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
    return `/directions/${pathSegment(target.fromName ?? target.fromId)}/${pathSegment(target.toName ?? target.toId)}/${pathSegment(target.fromId)}/${pathSegment(target.toId)}${queryString({
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
    return decodeURIComponent(value.replace(/\+/g, "%20"));
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
    if (segments.length === 5) {
      return directionsTargetFromSearch(
        {
          kind: "directions",
          fromName: segments[1]!,
          toName: segments[2]!,
          fromId: segments[3]!,
          toId: segments[4]!,
        },
        searchParams,
      );
    }

    if (segments.length === 1) {
      return directionsTargetFromSearch({ kind: "directions" }, searchParams);
    }
  }

  if (segments[0] === "view" && segments.length >= 3 && segments.length <= 5) {
    return {
      kind: "view",
      searchLabel: segments[1]!,
      buildingId: segments[2]!,
      floorId: segments[3] ?? undefined,
      placeId: segments[4] ?? undefined,
    };
  }

  return pathname === "/" ? { kind: "browse" } : fallbackTarget;
}
