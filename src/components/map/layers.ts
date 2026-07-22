import type { Map as MapLibreInstance } from "maplibre-gl";
import { LAYER_IDS, SOURCE_IDS } from "./constants";
import { emptyCollection } from "./geometry";

export function initializeMapSourcesAndLayers(map: MapLibreInstance) {
      for (const sourceId of Object.values(SOURCE_IDS)) {
        map.addSource(sourceId, { type: "geojson", data: emptyCollection() });
      }

      map.addLayer({
        id: LAYER_IDS.campusFill,
        type: "fill",
        source: SOURCE_IDS.campus,
        paint: {
          "fill-color": ["case", ["get", "isSelected"], "#4b5563", "#374151"],
          "fill-opacity": ["case", ["get", "isSelected"], 0.98, 0.92],
        },
      });
      map.addLayer({
        id: LAYER_IDS.campusOutline,
        type: "line",
        source: SOURCE_IDS.campus,
        paint: {
          "line-color": ["case", ["get", "isSelected"], "#334155", "#475569"],
          "line-width": ["case", ["get", "isSelected"], 1.45, 0.9],
        },
      });

      for (const [sourceId, fillLayer, outlineLayer, opacity] of [
        [SOURCE_IDS.autoFloors, LAYER_IDS.autoFloorFill, LAYER_IDS.autoFloorOutline, 0.6],
        [SOURCE_IDS.selectedFloor, LAYER_IDS.selectedFloorFill, LAYER_IDS.selectedFloorOutline, 1],
      ] as const) {
        map.addLayer({
          id: fillLayer,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": [
              "case",
              ["get", "isSelected"],
              ["get", "selectedFillColor"],
              ["get", "isCourtyard"],
              "#a8e6b6",
              ["get", "fillColor"],
            ],
            "fill-opacity": opacity,
          },
        });
        map.addLayer({
          id: outlineLayer,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": [
              "case",
              ["get", "isSelected"],
              ["get", "selectedOutlineColor"],
              ["get", "isClickable"],
              "#64748b",
              "#cbd5e1",
            ],
            "line-width": ["case", ["get", "isSelected"], 1.1, ["get", "isClickable"], 0.7, 0.38],
          },
        });
      }

      map.addLayer({
        id: LAYER_IDS.routeContextOutline,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "context"],
        paint: {
          "line-color": "#1e3a5f",
          "line-width": 4,
          "line-opacity": 0.65,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeContextLine,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "context"],
        paint: {
          "line-color": "#60a5fa",
          "line-width": 2,
          "line-opacity": 0.62,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeConnectorDots,
        type: "circle",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "connector"],
        paint: {
          "circle-color": "#2d9aed",
          "circle-radius": 3.5,
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.75,
        },
      });
      map.addLayer({
        id: LAYER_IDS.routeOutline,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "active"],
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.96 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: LAYER_IDS.routeLine,
        type: "line",
        source: SOURCE_IDS.routes,
        filter: ["==", ["get", "display"], "active"],
        paint: { "line-color": "#2d9aed", "line-width": 3, "line-opacity": 0.92 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: LAYER_IDS.venueLabels,
        type: "symbol",
        source: SOURCE_IDS.labels,
        minzoom: 16.8,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 16.8, 10, 20, 13],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#334155",
          "text-halo-color": "rgba(255,255,255,0.9)",
          "text-halo-width": 1.2,
        },
      });

}
