import { Flight } from "./Flight.ts";
interface PlaneControlsManagerOptions {
  params: Record<string, any>;
  getFlights: () => Flight[];
  getPreGeneratedConfigs: () => Array<Record<string, any>>;
  syncPlaneSize?: (value: number) => void;
  syncPlaneColor?: (value: number) => void;
  parsePlaneColor?: (value: any, fallback: number) => number;
  fallbackPlaneColor: number;
}

export class PlaneControlsManager {
  private params: Record<string, any>;
  private getFlights: () => Flight[];
  private getPreGeneratedConfigs: () => Array<Record<string, any>>;
  private syncPlaneSize?: (value: number) => void;
  private syncPlaneColor?: (value: number) => void;
  private parsePlaneColor?: (value: any, fallback: number) => number;
  private fallbackPlaneColor: number;

  constructor(options: PlaneControlsManagerOptions) {
    this.params = options.params;
    this.getFlights = options.getFlights;
    this.getPreGeneratedConfigs = options.getPreGeneratedConfigs;
    this.syncPlaneSize = options.syncPlaneSize;
    this.syncPlaneColor = options.syncPlaneColor;
    this.parsePlaneColor = options.parsePlaneColor;
    this.fallbackPlaneColor = options.fallbackPlaneColor;
  }

  public setPlaneSize(value: number): void {
    const numeric = Number(value);
    const planeSize = Number.isFinite(numeric) ? numeric : this.params.planeSize;

    if (this.params.planeSize === planeSize) {
      return;
    }

    this.params.planeSize = planeSize;

    const flights = this.getFlights();
    flights.forEach((flight) => flight.setPaneSize(planeSize));

    const configs = this.getPreGeneratedConfigs();
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (config) {
        configs[i] = { ...config, paneSize: planeSize };
      }
    }

    if (typeof this.syncPlaneSize === "function") {
      this.syncPlaneSize(planeSize);
    }
  }

  public setPlaneColor(value: any): void {
    const normalized = this.normalizeColor(value);
    if (this.params.planeColor === normalized) {
      return;
    }

    this.params.planeColor = normalized;

    const flights = this.getFlights();
    flights.forEach((flight) => flight.setPaneColor(normalized));

    const configs = this.getPreGeneratedConfigs();
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (config) {
        configs[i] = { ...config, paneColor: normalized };
      }
    }

    if (typeof this.syncPlaneColor === "function") {
      this.syncPlaneColor(normalized);
    }
  }

  private normalizeColor(value: any): number {
    let input = value;
    if (value && typeof value === "object") {
      const clamp = (component: any) => {
        const numeric = Number(component);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(255, Math.round(numeric)));
      };
      const r = clamp(value.r ?? value.red);
      const g = clamp(value.g ?? value.green);
      const b = clamp(value.b ?? value.blue);
      input = (r << 16) | (g << 8) | b;
    }

    if (typeof this.parsePlaneColor === "function") {
      return this.parsePlaneColor(input, this.fallbackPlaneColor);
    }

    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    if (typeof input === "string") {
      const normalized = input.trim().replace(/^#/, "");
      const parsed = parseInt(normalized, 16);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return this.fallbackPlaneColor;
  }
}
