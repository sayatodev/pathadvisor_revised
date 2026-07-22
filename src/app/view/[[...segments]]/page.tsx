import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { MapExperiencePage } from "@/components/map-experience-page";
import { viewShareMetadata } from "@/lib/pathadvisor/share-metadata";

function isSafeUrlValue(value: string) {
  return value.length > 0 && value.length <= 200 && !/[\u0000-\u001F\u007F]/.test(value);
}

export default async function ViewPage({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments = [] } = await params;

  if ((segments.length !== 2 && segments.length !== 3 && segments.length !== 4) || !segments.every(isSafeUrlValue)) {
    redirect("/");
  }

  const [searchLabel, buildingId, floorId, placeId] = segments;
  return <MapExperiencePage target={{ kind: "view", searchLabel, buildingId, floorId, placeId }} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}): Promise<Metadata> {
  const { segments = [] } = await params;
  if ((segments.length !== 2 && segments.length !== 3 && segments.length !== 4) || !segments.every(isSafeUrlValue)) {
    return {};
  }

  const [, buildingId, floorId, placeId] = segments;
  return (await viewShareMetadata({ buildingId, floorId, placeId })) ?? {};
}
