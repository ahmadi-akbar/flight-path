import { Flight } from "./Flight.ts";
interface PlaneControlsManagerOptions {
  params: Record<string, any>;
  getFlights: () => Flight[];
  getPreGeneratedConfigs: () => Array<Record<string, any>>;
  syncPlaneSize?: (value: number) => void;
  syncPlaneColor?: (value: number) => void;
  parsePlaneColor?: (value: any, fallback: number) => number;
  fallbackPlaneColor: number;
  syncAnimationSpeed?: (value: number) => void;
  syncElevationOffset?: (value: number) => void;
}

export class PlaneControlsManager {
  private params: Record<string, any>;
  private getFlights: () => Flight[];
  private getPreGeneratedConfigs: () => Array<Record<string, any>>;
  private syncPlaneSize?: (value: number) => void;
  private syncPlaneColor?: (value: number) => void;
  private parsePlaneColor?: (value: any, fallback: number) => number;
  private fallbackPlaneColor: number;
  private syncAnimationSpeed?: (value: number) => void;
  private syncElevationOffset?: (value: number) => void;

  constructor(options: PlaneControlsManagerOptions) {
    this.params = options.params;
    this.getFlights = options.getFlights;
    this.getPreGeneratedConfigs = options.getPreGeneratedConfigs;
    this.syncPlaneSize = options.syncPlaneSize;
    this.syncPlaneColor = options.syncPlaneColor;
    this.parsePlaneColor = options.parsePlaneColor;
    this.fallbackPlaneColor = options.fallbackPlaneColor;
    this.syncAnimationSpeed = options.syncAnimationSpeed;
    this.syncElevationOffset = options.syncElevationOffset;
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

  public setAnimationSpeed(value: number): void {
    const numeric = Number(value);
    const speed = Number.isFinite(numeric) ? numeric : this.params.animationSpeed;

    if (this.params.animationSpeed === speed) {
      return;
    }

    this.params.animationSpeed = speed;
    this.applyAnimationSpeedMode();

    if (typeof this.syncAnimationSpeed === "function") {
      this.syncAnimationSpeed(speed);
    }
  }

  public setElevationOffset(value: number): void {
    const numeric = Number(value);
    const offset = Number.isFinite(numeric) ? numeric : this.params.elevationOffset;

    if (this.params.elevationOffset === offset) {
      return;
    }

    this.params.elevationOffset = offset;

    const flights = this.getFlights();
    const configs = this.getPreGeneratedConfigs();

    flights.forEach((flight) => {
      flight.setPaneElevation(offset);
    });

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (config) {
        configs[i] = { ...config, elevationOffset: offset };
      }
    }

    if (typeof this.syncElevationOffset === "function") {
      this.syncElevationOffset(offset);
    }
  }

  public applyAnimationSpeedMode(): void {
    const flights = this.getFlights();
    const configs = this.getPreGeneratedConfigs();

    flights.forEach((flight, index) => {
      const config = configs[index] || {};
      const speed = this.resolveAnimationSpeed(config);
      flight.setAnimationSpeed(speed);
    });
  }

  public resolveAnimationSpeed(config: Record<string, any> = {}): number {
    if (this.params.randomSpeed) {
      if (typeof config._randomSpeed !== "number") {
        const base =
          typeof config.animationSpeed === "number"
            ? config.animationSpeed
            : this.generateRandomSpeed();
        config._randomSpeed = base;
      }
      return config._randomSpeed;
    }
    return this.params.animationSpeed;
  }

  private generateRandomSpeed(): number {
    const min = 0.03;
    const max = 0.25;
    return Math.random() * (max - min) + min;
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
