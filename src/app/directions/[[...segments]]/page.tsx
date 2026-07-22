import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { MapExperiencePage } from "@/components/map-experience-page";
import { directionsShareMetadata } from "@/lib/pathadvisor/share-metadata";

function isSafeUrlValue(value: string) {
  return value.length > 0 && value.length <= 200 && !/[\u0000-\u001F\u007F]/.test(value);
}

export default async function DirectionsPage({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments = [] } = await params;

  if (segments.length === 0) {
    return <MapExperiencePage target={{ kind: "directions" }} />;
  }

  if (segments.length !== 4 || !segments.every(isSafeUrlValue)) {
    redirect("/");
  }

  const [fromName, toName, fromId, toId] = segments;
  return <MapExperiencePage target={{ kind: "directions", fromName, toName, fromId, toId }} />;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}): Promise<Metadata> {
  const { segments = [] } = await params;
  if (segments.length === 4 && segments.every(isSafeUrlValue)) {
    return (await directionsShareMetadata({ fromId: segments[2], toId: segments[3] })) ?? {};
  }

  if (segments.length > 0) {
    return {};
  }

  const query = await searchParams;
  const fromId = typeof query.from === "string" ? query.from : undefined;
  const toId = typeof query.to === "string" ? query.to : undefined;
  return (await directionsShareMetadata({ fromId, toId })) ?? {};
}
