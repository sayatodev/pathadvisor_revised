import { useMemo } from "react";
import type { BuildingFloorSummary, PlaceDetail, RouteData, SearchPlace } from "@/lib/pathadvisor";
import { floorChipLabel, routeFloorOptions, type FloorOption } from "./display";

type MapFloorOptionsInput = {
  routeMode: boolean;
  routeData: RouteData | null;
  activeAutoVisibleBuildingFloors: BuildingFloorSummary[];
  selectedPlace: SearchPlace | null;
  placeDetail: PlaceDetail | null;
  selectedFloorId: string | null;
};

export function useMapFloorOptions({
  routeMode,
  routeData,
  activeAutoVisibleBuildingFloors,
  selectedPlace,
  placeDetail,
  selectedFloorId,
}: MapFloorOptionsInput) {
  const floorOptions = useMemo<FloorOption[]>(() => {
    if (routeMode && routeData) {
      return routeFloorOptions(routeData).map((option) => ({ id: option.id, label: option.label }));
    }

    if (!selectedPlace && activeAutoVisibleBuildingFloors.length > 0) {
      return activeAutoVisibleBuildingFloors.map((floor) => ({
        id: floor.id,
        label: floorChipLabel(floor),
        elevation: floor.elevation,
      }));
    }

    return (placeDetail?.floors ?? [])
      .filter((floor) => floor.showInPathAdvisor)
      .map((floor) => ({ id: floor.id, label: floorChipLabel(floor), elevation: floor.elevation }));
  }, [activeAutoVisibleBuildingFloors, placeDetail?.floors, routeData, routeMode, selectedPlace]);

  const currentFloorOption =
    floorOptions.find((floor) => floor.id === selectedFloorId) ?? floorOptions[0] ?? null;
  const floorNavigationOptions = useMemo(() => {
    if (!floorOptions.some((floor) => floor.elevation !== undefined && floor.elevation !== null)) {
      return floorOptions;
    }

    return [...floorOptions].sort(
      (left, right) => (left.elevation ?? Number.NEGATIVE_INFINITY) - (right.elevation ?? Number.NEGATIVE_INFINITY),
    );
  }, [floorOptions]);
  const currentFloorNavigationIndex = floorNavigationOptions.findIndex(
    (floor) => floor.id === currentFloorOption?.id,
  );

  return {
    floorOptions,
    currentFloorOption,
    lowerFloorOption:
      currentFloorNavigationIndex > 0 ? floorNavigationOptions[currentFloorNavigationIndex - 1] : null,
    higherFloorOption:
      currentFloorNavigationIndex >= 0 && currentFloorNavigationIndex < floorNavigationOptions.length - 1
        ? floorNavigationOptions[currentFloorNavigationIndex + 1]
        : null,
  };
}
