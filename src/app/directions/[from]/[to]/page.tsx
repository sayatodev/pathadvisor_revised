import { MapExperiencePage } from "@/components/map-experience-page";

export default async function DirectionsRoutePage({
  params,
}: {
  params: Promise<{ from: string; to: string }>;
}) {
  const { from, to } = await params;

  return <MapExperiencePage target={{ kind: "directions", fromId: from, toId: to }} />;
}
