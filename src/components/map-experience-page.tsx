import { Suspense } from "react";
import type { MapRouteTarget } from "@/lib/map-url";
import { MapExperience } from "./map-experience";

export function MapExperiencePage({ target }: { target: MapRouteTarget }) {
  return (
    <Suspense fallback={<div className="h-dvh w-full animate-pulse bg-slate-100" />}>
      <MapExperience target={target} />
    </Suspense>
  );
}
