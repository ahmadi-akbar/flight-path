import * as THREE from "three";
import { Flight } from "./Flight.ts";
import { Curves } from "./Curves.ts";
import { FlightUtils } from "./FlightUtils.ts";
import type { Flight as FlightData } from "./Data.ts";

interface FlightConfig {
  controlPoints: THREE.Vector3[];
  segmentCount: number;
  curveColor?: any;
  paneCount?: number;
  paneSize: number;
  elevationOffset?: number;
  animationSpeed?: number;
  tiltMode?: string;
  returnFlight: boolean;
  flightData?: FlightData | null;
  paneColor?: number;
  paneTextureIndex?: number;
  planeInfo?: any;
  _randomSpeed?: number;
}

interface FlightParams {
  numFlights: number;
  segmentCount: number;
  planeSize: number;
  planeColor: number;
  animationSpeed: number;
  elevationOffset: number;
  returnFlight: boolean;
  randomSpeed: boolean;
}

interface ControlsManagerOptions {
  params: FlightParams;
  maxFlights: number;
  getFlights: () => Flight[];
  getPreGeneratedConfigs: () => FlightConfig[];
  getMergedCurves: () => Curves | null;
  ensurePlaneDefaults: (config?: Partial<FlightConfig>) => FlightConfig;
  assignRandomPlane: (config?: Partial<FlightConfig>) => FlightConfig;
  resolvePaneColor: (config?: Partial<FlightConfig>) => number;
  resolveAnimationSpeed: (config?: Partial<FlightConfig>) => number;
  createFlightFromConfig: (config: FlightConfig, index: number) => Flight;
  updatePathVisibility: () => void;
  updatePlaneVisibility: () => void;
  syncFlightCount?: (value: number) => void;
}

export class ControlsManager {
  private params: FlightParams;
  private maxFlights: number;
  private getFlights: () => Flight[];
  private getPreGeneratedConfigs: () => FlightConfig[];
  private getMergedCurves: () => Curves | null;
  private ensurePlaneDefaults: (
    config?: Partial<FlightConfig>,
  ) => FlightConfig;
  private assignRandomPlane: (
    config?: Partial<FlightConfig>,
  ) => FlightConfig;
  private resolvePaneColor: (config?: Partial<FlightConfig>) => number;
  private resolveAnimationSpeed: (config?: Partial<FlightConfig>) => number;
  private createFlightFromConfig: (config: FlightConfig, index: number) => Flight;
  private updatePathVisibility: () => void;
  private updatePlaneVisibility: () => void;
  private syncFlightCount?: (value: number) => void;

  constructor(options: ControlsManagerOptions) {
    this.params = options.params;
    this.maxFlights = options.maxFlights;
    this.getFlights = options.getFlights;
    this.getPreGeneratedConfigs = options.getPreGeneratedConfigs;
    this.getMergedCurves = options.getMergedCurves;
    this.ensurePlaneDefaults = options.ensurePlaneDefaults;
    this.assignRandomPlane = options.assignRandomPlane;
    this.resolvePaneColor = options.resolvePaneColor;
    this.resolveAnimationSpeed = options.resolveAnimationSpeed;
    this.createFlightFromConfig = options.createFlightFromConfig;
    this.updatePathVisibility = options.updatePathVisibility;
    this.updatePlaneVisibility = options.updatePlaneVisibility;
    this.syncFlightCount = options.syncFlightCount;
  }

  public updateFlightCount(target: number): void {
    const flights = this.getFlights();
    const preGeneratedConfigs = this.getPreGeneratedConfigs();
    const mergedCurves = this.getMergedCurves();

    const currentCount = flights.length;
    const availableConfigs =
      preGeneratedConfigs.length > 0
        ? preGeneratedConfigs.length
        : this.maxFlights;
    const desiredCount = Math.min(Math.max(target, 0), availableConfigs);

    this.params.numFlights = desiredCount;

    if (desiredCount > currentCount) {
      for (let i = currentCount; i < desiredCount; i++) {
        let baseConfig: FlightConfig;

        if (preGeneratedConfigs.length) {
          const configIndex = i % preGeneratedConfigs.length;
          baseConfig = this.ensurePlaneDefaults(
            preGeneratedConfigs[configIndex],
          );
          baseConfig.returnFlight = this.params.returnFlight;
          preGeneratedConfigs[configIndex] = baseConfig;
        } else {
          baseConfig = this.assignRandomPlane(
            FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 }),
          );
          baseConfig.returnFlight = this.params.returnFlight;
        }

        const flightConfig: FlightConfig = {
          ...baseConfig,
          controlPoints: FlightUtils.cloneControlPoints(
            baseConfig.controlPoints,
          ),
          segmentCount: this.params.segmentCount,
          paneSize: this.params.planeSize,
          paneColor: this.resolvePaneColor(baseConfig),
          animationSpeed: this.resolveAnimationSpeed(baseConfig),
          elevationOffset:
            baseConfig.elevationOffset !== undefined
              ? baseConfig.elevationOffset
              : this.params.elevationOffset,
          paneTextureIndex: baseConfig.paneTextureIndex,
          returnFlight: this.params.returnFlight,
        };

        const flight = this.createFlightFromConfig(flightConfig, i);
        flights.push(flight);
      }

      if (mergedCurves && typeof mergedCurves.applyUpdates === "function") {
        mergedCurves.applyUpdates();
      }
    } else if (desiredCount < currentCount) {
      const flightsToRemove = flights.splice(desiredCount);
      flightsToRemove.forEach((flight) => flight.remove());
    }

    this.updatePathVisibility();
    this.updatePlaneVisibility();

    if (typeof this.syncFlightCount === "function") {
      this.syncFlightCount(this.params.numFlights);
    }
  }
}
