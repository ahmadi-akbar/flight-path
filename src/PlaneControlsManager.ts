import { Flight } from "./Flight.ts";
interface PlaneControlsManagerOptions {
  params: Record<string, any>;
  getFlights: () => Flight[];
  getPreGeneratedConfigs: () => Array<Record<string, any>>;
  syncPlaneSize?: (value: number) => void;
}

export class PlaneControlsManager {
  private params: Record<string, any>;
  private getFlights: () => Flight[];
  private getPreGeneratedConfigs: () => Array<Record<string, any>>;
  private syncPlaneSize?: (value: number) => void;

  constructor(options: PlaneControlsManagerOptions) {
    this.params = options.params;
    this.getFlights = options.getFlights;
    this.getPreGeneratedConfigs = options.getPreGeneratedConfigs;
    this.syncPlaneSize = options.syncPlaneSize;
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
}
