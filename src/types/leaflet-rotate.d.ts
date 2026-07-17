import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    bearing?: number;
    rotate?: boolean;
    rotateControl?: boolean;
    shiftKeyRotate?: boolean;
    touchRotate?: boolean;
  }
}
