export type CampusAreaKind = "Atrium" | "Concourse" | "Corridor" | "Courtyard" | "Lobby";

export type CampusAreaCode = {
  kind: CampusAreaKind;
  floor: string;
  suffix: string;
};

const FLOOR_CODE_PREFIX = "(UG\\d*|LG\\d*|R\\d*|G\\d*|B\\d+|L\\d+|\\d+)";
const CAMPUS_AREA_CODE_PATTERN = new RegExp(
  `^${FLOOR_CODE_PREFIX}(CONCOURSE|COURTYARD|COR|AT)(\\d*)([A-Z]?)$`,
);
const LOBBY_FLOOR_CODE_PREFIX = "(UG\\d*|LG\\d*|R|G|B\\d+|L\\d+|\\d+)";
const LOBBY_CODE_PATTERN = new RegExp(`^${LOBBY_FLOOR_CODE_PREFIX}([A-Z0-9]*)LOB$`);
const CAMPUS_AREA_NAMES: Record<string, CampusAreaKind> = {
  AT: "Atrium",
  CONCOURSE: "Concourse",
  COR: "Corridor",
  COURTYARD: "Courtyard",
};

export function parseCampusAreaCode(value: string): CampusAreaCode | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const areaMatch = normalized.match(CAMPUS_AREA_CODE_PATTERN);

  if (areaMatch) {
    const [, floor, code, number, letter] = areaMatch;
    return {
      kind: CAMPUS_AREA_NAMES[code],
      floor,
      suffix: `${number}${letter}`,
    };
  }

  const lobbyMatch = normalized.match(LOBBY_CODE_PATTERN);
  if (lobbyMatch) {
    return { kind: "Lobby", floor: lobbyMatch[1], suffix: lobbyMatch[2] };
  }

  return null;
}

export function formatCampusAreaName(name: string) {
  const area = parseCampusAreaCode(name);
  if (!area) {
    return null;
  }

  if (area.kind === "Lobby") {
    return `Lobby (${area.floor}${area.suffix})`;
  }

  const suffix = area.suffix ? ` #${area.suffix}` : "";
  return `${area.kind} (Floor ${area.floor}${suffix})`;
}
