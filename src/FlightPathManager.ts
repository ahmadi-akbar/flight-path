import { Curves } from "./Curves.ts";

interface FlightPathParams {
  dashSize: number;
  gapSize: number;
}

interface FlightPathManagerOptions {
  params: FlightPathParams;
  getMergedCurves: () => Curves | null;
  syncDashSize?: (value: number) => void;
}

export class FlightPathManager {
  private params: FlightPathParams;
  private getMergedCurves: () => Curves | null;
  private syncDashSize?: (value: number) => void;

  constructor(options: FlightPathManagerOptions) {
    this.params = options.params;
    this.getMergedCurves = options.getMergedCurves;
    this.syncDashSize = options.syncDashSize;
  }

  public applyDashPattern(): void {
    const mergedCurves = this.getMergedCurves();
    if (!mergedCurves) return;

    mergedCurves.setDashPattern(this.params.dashSize, this.params.gapSize);
    if (typeof mergedCurves.applyUpdates === "function") {
      mergedCurves.applyUpdates();
    }
  }

  public setDashSize(value: number): void {
    const numeric = Number(value);
    const dashSize = Number.isFinite(numeric) ? numeric : this.params.dashSize;

    if (this.params.dashSize === dashSize) {
      return;
    }

    this.params.dashSize = dashSize;
    this.applyDashPattern();

    if (typeof this.syncDashSize === "function") {
      this.syncDashSize(dashSize);
    }
  }
}
