import type { CampusBootstrap, FloorData, PlaceDetail, RouteData, SearchPlace } from "@/lib/pathadvisor";

export type MapLibreMapProps = {
  bootstrap: CampusBootstrap | null;
  floorData: FloorData | null;
  focusedBuildingId: string | null;
  isFloorSelectorVisible: boolean;
  onAutoVisibleBuildingChange: (buildingId: string | null) => void;
  routeData: RouteData | null;
  selectedFloorId: string | null;
  selectedPlace: SearchPlace | null;
  venueFocusRequest: number;
  placeDetail: PlaceDetail | null;
  focusedSegmentId: string | null;
  onSelectBuilding: (buildingId: string, name: string) => void;
  onSelectVenue: (venue: {
    id: string;
    kind: "location" | "point_of_interest";
    name: string;
    subtitle: string;
  }) => void;
};
