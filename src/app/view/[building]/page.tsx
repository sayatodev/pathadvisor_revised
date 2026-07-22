import { MapExperiencePage } from "@/components/map-experience-page";

export default async function BuildingViewPage({
  params,
}: {
  params: Promise<{ building: string }>;
}) {
  const { building } = await params;

  return <MapExperiencePage target={{ kind: "view", buildingId: building }} />;
}
