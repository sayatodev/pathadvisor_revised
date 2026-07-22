import { MapExperiencePage } from "@/components/map-experience-page";

export default async function PlaceViewPage({
  params,
}: {
  params: Promise<{ building: string; floor: string; placeId: string }>;
}) {
  const { building, floor, placeId } = await params;

  return (
    <MapExperiencePage
      target={{ kind: "view", buildingId: building, floorId: floor, placeId }}
    />
  );
}
