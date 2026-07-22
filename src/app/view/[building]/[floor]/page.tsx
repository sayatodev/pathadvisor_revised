import { MapExperiencePage } from "@/components/map-experience-page";

export default async function BuildingFloorViewPage({
  params,
}: {
  params: Promise<{ building: string; floor: string }>;
}) {
  const { building, floor } = await params;

  return <MapExperiencePage target={{ kind: "view", buildingId: building, floorId: floor }} />;
}
