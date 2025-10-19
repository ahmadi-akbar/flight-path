import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "stats.js";
import { Flight } from "./Flight.ts";
import { Curves } from "./Curves.ts";
import { PanesShader } from "./PanesShader.ts";
import { FlightUtils } from "./FlightUtils.ts";
import { Stars } from "./Stars.ts";
import { Earth } from "./Earth.ts";
import { Controls } from "./Controls.ts";
import { EarthControlsManager } from "./managers/EarthControlsManager.ts";
import { FlightControlsManager } from "./managers/FlightControlsManager.ts";
import { FlightPathManager } from "./managers/FlightPathManager.ts";
import { PlaneControlsManager } from "./managers/PlaneControlsManager.ts";
import { flights as dataFlights, type Flight as FlightData } from "./Data.ts";
import { planes as planeDefinitions } from "./Planes.ts";
import {
  getSunVector3,
  getCurrentUtcTimeHours,
  animateCameraToPosition,
  hoursToTimeString,
} from "./Utils.ts";
import { UIManager } from "./managers/UIManager.ts";
import type {
  PlaneEntry,
  FlightConfig,
  SvgAtlasInfo,
  PerfStats,
  GuiParams,
} from "./types.js";

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  50000,
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
document.querySelector("#app")!.appendChild(renderer.domElement);

// Setup Stats.js for performance monitoring
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);
stats.dom.style.display = "none";
stats.dom.style.position = "absolute";
stats.dom.style.left = "0px";
stats.dom.style.top = "0px";

const uiManager = new UIManager(stats);

// Global variables
let flights: Flight[] = [];
let mergedCurves: Curves | null = null;
let mergedPanes: PanesShader | null = null;
let stars: Stars | null = null;
let earth: Earth | null = null;
let initialCameraPositioned: boolean = false;
const clock = new THREE.Clock();
const DATA_FLIGHT_COUNT: number = Array.isArray(dataFlights)
  ? dataFlights.length
  : 0;
const MAX_FLIGHTS: number = DATA_FLIGHT_COUNT > 0 ? DATA_FLIGHT_COUNT : 30000;
const EARTH_RADIUS: number = 3000;
const MIN_CURVE_ALTITUDE: number = 20;
const TAKEOFF_LANDING_OFFSET: number = 18;
const MIN_CRUISE_ALTITUDE: number = 30;
const MAX_CRUISE_ALTITUDE: number = 220;
let preGeneratedConfigs: FlightConfig[] = [];
let minLoadingTimeoutId: number | null = null;

window.earthTextureLoaded = false;
window.minTimeElapsed = false;
window.guiControlsInstance = null;

const DEFAULT_PLANE_COLOR: number = 0xff6666;
const FALLBACK_PLANE_COUNT: number = 8;

function parseHexColor(
  colorValue: any,
  fallback: number = DEFAULT_PLANE_COLOR,
): number {
  if (typeof colorValue === "number" && Number.isFinite(colorValue)) {
    return colorValue;
  }
  if (typeof colorValue === "string") {
    const normalized = colorValue.trim().replace(/^#/, "");
    if (normalized.length > 0) {
      const parsed = parseInt(normalized, 16);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function clampPercentValue(value: any, fallbackPercent: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallbackPercent;
  }
  return THREE.MathUtils.clamp(numeric, 0, 100);
}

function resolveDayIntensityFromPercent(
  percentValue: any,
  fallbackPercent: number = DEFAULT_DAY_BRIGHTNESS_PERCENT,
): number {
  const percent = clampPercentValue(percentValue, fallbackPercent) / 100;
  return THREE.MathUtils.lerp(0.1, 3.0, percent);
}

function resolveNightMixFromPercent(
  percentValue: any,
  fallbackPercent: number = DEFAULT_NIGHT_BRIGHTNESS_PERCENT,
): number {
  return clampPercentValue(percentValue, fallbackPercent) / 100;
}

const planeEntries: PlaneEntry[] =
  Array.isArray(planeDefinitions) && planeDefinitions.length > 0
    ? planeDefinitions.map((plane: any, index: number) => ({
        ...plane,
        atlasIndex: index,
      }))
    : Array.from({ length: FALLBACK_PLANE_COUNT }, (_, index) => ({
        name: `plane${index + 1}`,
        svg: `plane${index + 1}.svg`,
        color: `#${DEFAULT_PLANE_COLOR.toString(16).padStart(6, "0")}`,
        atlasIndex: index,
      }));

const PLANE_SVG_COUNT: number = planeEntries.length;
const INITIAL_PLANE_COLOR: number = parseHexColor(
  planeEntries[0]?.color,
  DEFAULT_PLANE_COLOR,
);

const textureLoader = new THREE.TextureLoader();
const PLANE_ATLAS_COLUMNS: number = 4;
const PLANE_ATLAS_ROWS: number = 2;
const PLANE_TEXTURE_SIZE: number = 512;
let svgTexture: THREE.Texture | null = null;
let svgAtlasInfo: SvgAtlasInfo | null = null;
let svgTexturePromise: Promise<{
  texture: THREE.Texture;
  info: SvgAtlasInfo;
}> | null = null;
let controlsManager: Controls | null = null;
let guiControls: any = null;
let earthControlsManager: EarthControlsManager | null = null;
const TARGET_AMBIENT_COLOR = new THREE.Color(0xffffff);
const DEFAULT_DAY_BRIGHTNESS_PERCENT = 70;
const DEFAULT_NIGHT_BRIGHTNESS_PERCENT = 40;

// GUI controls
const params: GuiParams = {
  numFlights: Math.min(5000, MAX_FLIGHTS),
  elevationOffset: 15,
  segmentCount: 100,
  planeSize: 100,
  planeColor: INITIAL_PLANE_COLOR,
  animationSpeed: 0.1,
  tiltMode: "Tangent",
  paneStyle: "SVG",
  dashSize: 40,
  gapSize: 40,
  hidePath: false,
  hidePlane: false,
  randomSpeed: false,
  returnFlight: true,
};

const flightPathManager = new FlightPathManager({
  params,
  getMergedCurves: () => mergedCurves,
  getFlightCount: () => flights.length,
  syncDashSize: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setDashSize === "function" &&
      controlsManager.guiControls?.dashSize !== value
    ) {
      controlsManager.setDashSize(value);
    }
  },
  syncGapSize: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setGapSize === "function" &&
      controlsManager.guiControls?.gapSize !== value
    ) {
      controlsManager.setGapSize(value);
    }
  },
  syncHidePath: (value: boolean) => {
    if (
      controlsManager &&
      typeof controlsManager.setHidePath === "function" &&
      controlsManager.guiControls?.hidePath !== value
    ) {
      controlsManager.setHidePath(value);
    }
  },
});

const flightControlsManager = new FlightControlsManager({
  params,
  maxFlights: MAX_FLIGHTS,
  getFlights: () => flights,
  getPreGeneratedConfigs: () => preGeneratedConfigs,
  getMergedCurves: () => mergedCurves,
  getMergedPanes: () => mergedPanes,
  ensurePlaneDefaults,
  assignRandomPlane,
  resolvePaneColor,
  resolveAnimationSpeed: (config: Partial<FlightConfig> = {}) =>
    planeControlsManager.resolveAnimationSpeed(
      config as Record<string, any>,
    ),
  createFlightFromConfig,
  updatePathVisibility: () => flightPathManager.applyVisibility(),
  updatePlaneVisibility: () =>
    planeControlsManager.setHidePlane(params.hidePlane),
  syncFlightCount: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setFlightCount === "function" &&
      controlsManager.guiControls?.numFlights !== value
    ) {
      controlsManager.setFlightCount(value);
    }
  },
  syncReturnFlight: (value: boolean) => {
    if (
      controlsManager &&
      typeof controlsManager.setReturnFlight === "function" &&
      controlsManager.guiControls?.returnFlight !== value
    ) {
      controlsManager.setReturnFlight(value);
    }
  },
});

const planeControlsManager = new PlaneControlsManager({
  params,
  getFlights: () => flights,
  getPreGeneratedConfigs: () => preGeneratedConfigs,
  getMergedPanes: () => mergedPanes,
  loadSvgTexture,
  initializeFlights,
  fallbackPlaneColor: DEFAULT_PLANE_COLOR,
  parsePlaneColor: (value, fallback) => parseHexColor(value, fallback),
  syncPlaneSize: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setPlaneSize === "function" &&
      controlsManager.guiControls?.planeSize !== value
    ) {
      controlsManager.setPlaneSize(value);
    }
  },
  syncPlaneColor: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setPlaneColor === "function"
    ) {
      const formatted = `#${value.toString(16).padStart(6, "0")}`;
      if (controlsManager.guiControls?.planeColor !== formatted) {
        controlsManager.setPlaneColor(value);
      }
    }
  },
  syncPaneStyle: (value: string) => {
    if (
      controlsManager &&
      typeof controlsManager.setPaneStyle === "function" &&
      controlsManager.guiControls?.paneStyle !== value
    ) {
      controlsManager.setPaneStyle(value);
    }
  },
  syncAnimationSpeed: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setAnimationSpeed === "function" &&
      controlsManager.guiControls?.animationSpeed !== value
    ) {
      controlsManager.setAnimationSpeed(value);
    }
  },
  syncElevationOffset: (value: number) => {
    if (
      controlsManager &&
      typeof controlsManager.setPlaneElevation === "function" &&
      controlsManager.guiControls?.elevationOffset !== value
    ) {
      controlsManager.setPlaneElevation(value);
    }
  },
  syncHidePlane: (value: boolean) => {
    if (
      controlsManager &&
      typeof controlsManager.setHidePlane === "function" &&
      controlsManager.guiControls?.hidePlane !== value
    ) {
      controlsManager.setHidePlane(value);
    }
  },
});

function clonePlaneEntry(entry: PlaneEntry | null): PlaneEntry | null {
  if (!entry) return null;
  const { name, svg, color, atlasIndex } = entry;
  return { name, svg, color, atlasIndex };
}

function getPlaneEntryByAtlasIndex(index: number): PlaneEntry | null {
  if (typeof index !== "number") return null;
  if (index < 0 || index >= planeEntries.length) return null;
  return planeEntries[index];
}

function getPlaneEntryBySvg(svgName: string): PlaneEntry | null {
  if (typeof svgName !== "string" || !svgName) return null;
  return planeEntries.find((entry) => entry.svg === svgName) || null;
}

function getPlaneEntryByName(name: string): PlaneEntry | null {
  if (typeof name !== "string" || !name) return null;
  return planeEntries.find((entry) => entry.name === name) || null;
}

function getRandomPlaneEntry(): PlaneEntry | null {
  if (!planeEntries.length) return null;
  const randomIndex = Math.floor(Math.random() * planeEntries.length);
  return planeEntries[randomIndex];
}

function ensurePlaneDefaults(config: Partial<FlightConfig> = {}): FlightConfig {
  const providedPlaneInfo = config.planeInfo;
  let planeEntry: PlaneEntry | null = null;

  if (providedPlaneInfo && typeof providedPlaneInfo === "object") {
    if (typeof providedPlaneInfo.atlasIndex === "number") {
      planeEntry = getPlaneEntryByAtlasIndex(providedPlaneInfo.atlasIndex);
    }
    if (!planeEntry && providedPlaneInfo.svg) {
      planeEntry = getPlaneEntryBySvg(providedPlaneInfo.svg);
    }
    if (!planeEntry && providedPlaneInfo.name) {
      planeEntry = getPlaneEntryByName(providedPlaneInfo.name);
    }
  }

  if (!planeEntry && typeof config.paneTextureIndex === "number") {
    planeEntry = getPlaneEntryByAtlasIndex(config.paneTextureIndex);
  }

  if (!planeEntry) {
    planeEntry = getRandomPlaneEntry();
  }

  if (!planeEntry) {
    const fallbackColor =
      typeof config.paneColor === "number"
        ? config.paneColor
        : DEFAULT_PLANE_COLOR;
    const fallbackTextureIndex =
      typeof config.paneTextureIndex === "number" ? config.paneTextureIndex : 0;

    return {
      controlPoints: config.controlPoints || [],
      segmentCount: config.segmentCount || params.segmentCount,
      paneSize: config.paneSize || params.planeSize,
      elevationOffset: config.elevationOffset || params.elevationOffset,
      animationSpeed: config.animationSpeed || params.animationSpeed,
      tiltMode: config.tiltMode || params.tiltMode,
      returnFlight: config.returnFlight || params.returnFlight,
      paneColor: fallbackColor,
      paneTextureIndex: fallbackTextureIndex,
      planeInfo: providedPlaneInfo ?? null,
      flightData: config.flightData || null,
    };
  }

  return {
    controlPoints: config.controlPoints || [],
    segmentCount: config.segmentCount || params.segmentCount,
    paneSize: config.paneSize || params.planeSize,
    elevationOffset: config.elevationOffset || params.elevationOffset,
    animationSpeed: config.animationSpeed || params.animationSpeed,
    tiltMode: config.tiltMode || params.tiltMode,
    returnFlight: config.returnFlight || params.returnFlight,
    paneColor: parseHexColor(planeEntry.color, DEFAULT_PLANE_COLOR),
    paneTextureIndex: planeEntry.atlasIndex,
    planeInfo: clonePlaneEntry(planeEntry),
    flightData: config.flightData || null,
  };
}

function assignRandomPlane(config: Partial<FlightConfig> = {}): FlightConfig {
  return ensurePlaneDefaults({
    ...config,
    planeInfo: null,
    paneTextureIndex: undefined,
    paneColor: undefined,
  });
}

function createDataFlightConfig(entry: FlightData): FlightConfig | null {
  if (!entry) {
    return null;
  }

  const { departure, arrival } = entry;
  const controlPoints = FlightUtils.generateParabolicControlPoints(
    departure,
    arrival,
    {
      radius: EARTH_RADIUS,
      takeoffOffset: TAKEOFF_LANDING_OFFSET,
      minCurveAltitude: MIN_CURVE_ALTITUDE,
      minCruiseAltitude: MIN_CRUISE_ALTITUDE,
      maxCruiseAltitude: MAX_CRUISE_ALTITUDE,
    },
  );
  if (!controlPoints.length) {
    return null;
  }

  return assignRandomPlane({
    controlPoints,
    segmentCount: params.segmentCount,
    curveColor: FlightUtils.createGradientColorConfig(departure),
    paneCount: 1,
    paneSize: params.planeSize,
    elevationOffset: params.elevationOffset,
    animationSpeed: params.animationSpeed,
    tiltMode: params.tiltMode,
    returnFlight: params.returnFlight,
    flightData: {
      departure,
      arrival,
    },
  });
}

// Pre-generate flight configurations for stability
function preGenerateFlightConfigs(): void {
  preGeneratedConfigs = [];

  if (Array.isArray(dataFlights) && dataFlights.length > 0) {
    dataFlights.forEach((flightEntry) => {
      const config = createDataFlightConfig(flightEntry);
      if (!config) {
        return;
      }

      const configWithPlane = ensurePlaneDefaults(config);
      const normalizedPoints = FlightUtils.normalizeControlPoints(
        configWithPlane.controlPoints,
        EARTH_RADIUS,
        MIN_CURVE_ALTITUDE,
      );

      preGeneratedConfigs.push({
        ...configWithPlane,
        controlPoints: normalizedPoints,
        elevationOffset:
          configWithPlane.elevationOffset !== undefined
            ? configWithPlane.elevationOffset
            : params.elevationOffset,
        paneTextureIndex: configWithPlane.paneTextureIndex,
        paneColor: configWithPlane.paneColor,
        planeInfo: configWithPlane.planeInfo,
        _randomSpeed:
          typeof configWithPlane.animationSpeed === "number"
            ? configWithPlane.animationSpeed
            : undefined,
        returnFlight: params.returnFlight,
      });
    });

    return;
  }

  for (let i = 0; i < MAX_FLIGHTS; i++) {
    let config = FlightUtils.generateRandomFlightConfig({
      segmentCount: params.segmentCount,
      tiltMode: params.tiltMode,
      numControlPoints: 2,
    });
    config = assignRandomPlane({
      ...config,
      elevationOffset: params.elevationOffset,
      flightData: null,
    });
    const normalizedPoints = FlightUtils.normalizeControlPoints(
      config.controlPoints,
      EARTH_RADIUS,
      MIN_CURVE_ALTITUDE,
    );
    preGeneratedConfigs.push({
      ...config,
      controlPoints: normalizedPoints,
      elevationOffset: config.elevationOffset,
      paneTextureIndex: config.paneTextureIndex,
      paneColor: config.paneColor,
      planeInfo: config.planeInfo,
      _randomSpeed:
        typeof config.animationSpeed === "number"
          ? config.animationSpeed
          : undefined,
      returnFlight: params.returnFlight,
      flightData: null,
    });
  }
}

function checkReadyToStart(): void {
  if (window.earthTextureLoaded && window.minTimeElapsed) {
    setInitialCameraPosition();
  }
}
function resolvePaneColor(config: Partial<FlightConfig> = {}): number {
  if (typeof config.paneColor === "number") {
    return config.paneColor;
  }

  const color = parseHexColor(params.planeColor, DEFAULT_PLANE_COLOR);
  config.paneColor = color;
  return color;
}

function applyPaneColorMode(): void {
  flights.forEach((flight, index) => {
    const config = preGeneratedConfigs[index] || {};
    const color = resolvePaneColor(config);
    flight.setPaneColor(color);
  });
}

function updateLighting(): void {
  if (!guiControls) return;

  if (!guiControls.dayNightEffect) {
    ambientLight.color.copy(TARGET_AMBIENT_COLOR);
    ambientLight.intensity = 1.6;
    return;
  }

  const dayPercent = earthControlsManager
    ? earthControlsManager.getDayBrightnessPercent()
    : guiControls.dayBrightness ?? DEFAULT_DAY_BRIGHTNESS_PERCENT;
  const nightPercent = earthControlsManager
    ? earthControlsManager.getNightBrightnessPercent()
    : guiControls.nightBrightness ?? DEFAULT_NIGHT_BRIGHTNESS_PERCENT;

  const dayIntensity = resolveDayIntensityFromPercent(dayPercent);
  const nightMix = resolveNightMixFromPercent(nightPercent);

  directionalLight.intensity = dayIntensity;

  const baseIntensity = earthControlsManager
    ? earthControlsManager.getBaseAmbientIntensity()
    : ambientLight.intensity;
  const baseColor = earthControlsManager
    ? earthControlsManager.getBaseAmbientColor().clone()
    : ambientLight.color.clone();
  const targetAmbient = THREE.MathUtils.lerp(
    baseIntensity,
    dayIntensity * 0.95,
    nightMix,
  );
  const colorBlend = THREE.MathUtils.clamp(nightMix * 0.85, 0, 1);

  const blendedColor = baseColor.lerp(TARGET_AMBIENT_COLOR, colorBlend);
  ambientLight.color.copy(blendedColor);
  ambientLight.intensity = targetAmbient;
}

function setupGlobalControls(): void {
  controlsManager = new Controls();

  controlsManager.setup(
    {
      onDayNightEffectChange: (value: boolean) => {
        earthControlsManager?.toggleDayNightEffect(value);
      },
      onAtmosphereEffectChange: (value: boolean) => {
        earthControlsManager?.toggleAtmosphereEffect(value);
      },
      onResetSunPosition: () => {
        directionalLight.position.set(0, 1000, 1000);
        updateSunPosition();
      },
      onDayBrightnessChange: (value: number) => {
        earthControlsManager?.setDayBrightness(value);
      },
      onNightBrightnessChange: (value: number) => {
        earthControlsManager?.setNightBrightness(value);
      },
      onRealTimeSunChange: (value: boolean) => {
        if (value) {
          earthControlsManager?.enableRealTimeSun();
        } else {
          earthControlsManager?.disableRealTimeSun();
        }
        const { timeDisplay, timeSlider, realTimeSun } =
          controlsManager!.controllers || {};
        if (timeDisplay) timeDisplay.updateDisplay();
        if (timeSlider) timeSlider.updateDisplay();
        if (realTimeSun) realTimeSun.updateDisplay();
      },
      onTimeSliderChange: (value: number) => {
        earthControlsManager?.setSimulatedTime(value);
        const { timeDisplay, realTimeSun } = controlsManager!.controllers || {};
        if (timeDisplay) timeDisplay.updateDisplay();
        if (realTimeSun) realTimeSun.updateDisplay();
      },
      onTimeDisplayChange: (value: string) => {
        if (earthControlsManager?.setTimeDisplay(value)) {
          const { timeSlider, realTimeSun } =
            controlsManager!.controllers || {};
          if (timeSlider) timeSlider.updateDisplay();
          if (realTimeSun) realTimeSun.updateDisplay();
        }
      },
      onPlaneSizeChange: (value: number) => {
        updatePlaneSize(value);
      },
      onPlaneColorChange: (value: number) => {
        updatePlaneColor(value);
      },
      onAnimationSpeedChange: (value: number) => {
        params.randomSpeed = false;
        planeControlsManager.setAnimationSpeed(value);
      },
      onPlaneElevationChange: (value: number) => {
        planeControlsManager.setElevationOffset(value);
      },
      onPaneStyleChange: (value: string) => {
        planeControlsManager.setPaneStyle(value);
      },
      onHidePlaneChange: (value: boolean) => {
        planeControlsManager.setHidePlane(value);
      },
      onDashSizeChange: (value: number) => {
        updateDashSize(value);
      },
      onGapSizeChange: (value: number) => {
        updateGapSize(value);
      },
      onHidePathChange: (value: boolean) => {
        updateHidePath(value);
      },
      onFlightCountChange: (value: number) => {
        updateFlightCount(value);
      },
      onReturnFlightChange: (value: boolean) => {
        updateReturnFlight(value);
      },
    },
    {
      planeSize: params.planeSize,
      planeSizeRange: { min: 50, max: 500 },
      planeColor: params.planeColor,
      animationSpeed: params.animationSpeed,
      speedRange: { min: 0.01, max: 0.5, step: 0.01 },
      elevationOffset: params.elevationOffset,
      elevationRange: { min: 0, max: 200, step: 5 },
      paneStyle: params.paneStyle,
      paneStyleOptions: ["Pane", "SVG"],
      hidePlane: params.hidePlane,
      dashSize: params.dashSize,
      dashRange: { min: 0, max: 2000, step: 1 },
      gapSize: params.gapSize,
      gapRange: { min: 0, max: 2000, step: 1 },
      hidePath: params.hidePath,
      numFlights: params.numFlights,
      flightCountRange: { min: 1, max: MAX_FLIGHTS, step: 1 },
      returnFlight: params.returnFlight,
    },
  );

  guiControls = controlsManager.getControls();
  earthControlsManager?.initializeFromGui(guiControls);
  window.guiControlsInstance = controlsManager;

  document.querySelectorAll(".dg.ac").forEach((container) => {
    (container as HTMLElement).style.display = "none";
  });

  if (earthControlsManager) {
    earthControlsManager.setDayBrightness(guiControls.dayBrightness);
    earthControlsManager.setNightBrightness(guiControls.nightBrightness);
    if (guiControls.realTimeSun) {
      earthControlsManager.enableRealTimeSun();
    }
  }

  earthControlsManager?.toggleAtmosphereEffect(guiControls.atmosphereEffect);
  earthControlsManager?.toggleDayNightEffect(guiControls.dayNightEffect);
}

function updateSunPosition(): void {
  if (!directionalLight) return;

  const radius = earth ? earth.getRadius() : 3000;

  const simulatedTime = earthControlsManager
    ? earthControlsManager.getSimulatedTime()
    : guiControls?.simulatedTime ?? getCurrentUtcTimeHours();

  if (guiControls) {
    guiControls.simulatedTime = simulatedTime;
    guiControls.timeDisplay = earthControlsManager
      ? earthControlsManager.getTimeDisplay()
      : hoursToTimeString(simulatedTime);
    guiControls.realTimeSun = earthControlsManager
      ? earthControlsManager.isRealTimeSunEnabled()
      : guiControls.realTimeSun;
  }

  const dayNightActive = guiControls ? guiControls.dayNightEffect : true;
  if (dayNightActive) {
    const sunVector = getSunVector3(radius, simulatedTime);
    directionalLight.position.copy(sunVector);
  }

  updateLighting();
  directionalLight.lookAt(0, 0, 0);
  uiManager.updateCoordinateDisplay(camera, earth);
}

function setInitialCameraPosition(): void {
  if (!earth || initialCameraPositioned) return;

  const radius = earth.getRadius();
  const sunPos = getSunVector3(radius, getCurrentUtcTimeHours());
  const sunDirection = sunPos.clone().normalize();

  const angle = THREE.MathUtils.degToRad(70);
  const rotatedDirection = new THREE.Vector3(
    sunDirection.x * Math.cos(angle) + sunDirection.z * Math.sin(angle),
    sunDirection.y,
    -sunDirection.x * Math.sin(angle) + sunDirection.z * Math.cos(angle),
  );

  const targetDistance = radius * 2.1;
  const targetPosition = rotatedDirection.multiplyScalar(targetDistance);
  const startPosition = targetPosition.clone().multiplyScalar(1.25);

  camera.position.copy(startPosition);
  camera.lookAt(0, 0, 0);
  animateCameraToPosition(camera, startPosition, targetPosition, 3000, 500);

  initialCameraPositioned = true;

  uiManager.removeLoadingScreen();
}

function loadSvgTexture(): Promise<{
  texture: THREE.Texture;
  info: SvgAtlasInfo;
}> {
  if (svgTexture && svgAtlasInfo) {
    return Promise.resolve({ texture: svgTexture, info: svgAtlasInfo });
  }

  if (svgTexturePromise) {
    return svgTexturePromise;
  }

  svgTexturePromise = (async () => {
    try {
      const parser = new DOMParser();
      const rasterSize = PLANE_TEXTURE_SIZE;
      const aspect = 30 / 28;
      const heightSize = Math.round(rasterSize * aspect);

      const rasterizedImages: HTMLImageElement[] = [];

      for (const plane of planeEntries) {
        const svgPath =
          typeof plane.svg === "string" && plane.svg.length > 0
            ? plane.svg
            : `plane${(plane.atlasIndex ?? 0) + 1}.svg`;
        const url = `${import.meta.env.BASE_URL || "/"}${svgPath}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch SVG (${svgPath}): ${response.status} ${response.statusText}`,
          );
        }
        const svgText = await response.text();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const svgElement = doc.documentElement;
        svgElement.setAttribute("width", `${rasterSize}`);
        svgElement.setAttribute("height", `${heightSize}`);
        if (!svgElement.getAttribute("viewBox")) {
          svgElement.setAttribute("viewBox", "0 0 28 30");
        }

        const serialized = new XMLSerializer().serializeToString(svgElement);
        const blob = new Blob([serialized], { type: "image/svg+xml" });
        const objectUrl = URL.createObjectURL(blob);
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
          };
          img.onerror = (error) => {
            URL.revokeObjectURL(objectUrl);
            reject(error);
          };
          img.src = objectUrl;
        });
        rasterizedImages.push(image);
      }

      const atlasCanvas = document.createElement("canvas");
      atlasCanvas.width = PLANE_ATLAS_COLUMNS * rasterSize;
      atlasCanvas.height = PLANE_ATLAS_ROWS * heightSize;
      const ctx = atlasCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

      rasterizedImages.forEach((img, idx) => {
        const col = idx % PLANE_ATLAS_COLUMNS;
        const row = Math.floor(idx / PLANE_ATLAS_COLUMNS);
        const x = col * rasterSize;
        const y = row * heightSize;
        ctx.drawImage(img, x, y, rasterSize, heightSize);
      });

      const atlasUrl = atlasCanvas.toDataURL("image/png");

      svgAtlasInfo = {
        columns: PLANE_ATLAS_COLUMNS,
        rows: PLANE_ATLAS_ROWS,
        count: PLANE_SVG_COUNT,
        scale: { x: 1 / PLANE_ATLAS_COLUMNS, y: 1 / PLANE_ATLAS_ROWS },
      };

      return await new Promise<{ texture: THREE.Texture; info: SvgAtlasInfo }>(
        (resolve, reject) => {
          textureLoader.load(
            atlasUrl,
            (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.generateMipmaps = true;
              texture.minFilter = THREE.LinearMipmapLinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.anisotropy =
                renderer.capabilities?.getMaxAnisotropy?.() || 1;
              texture.needsUpdate = true;
              svgTexture = texture;
              resolve({ texture: svgTexture, info: svgAtlasInfo! });
            },
            undefined,
            (error) => {
              console.error("Failed to load SVG atlas texture:", error);
              reject(error);
            },
          );
        },
      );
    } catch (error) {
      console.error("Failed to prepare SVG texture atlas:", error);
      svgTexturePromise = null;
      throw error;
    }
  })();

  return svgTexturePromise;
}

function applyPaneTexture(): void {
  if (!mergedPanes || typeof mergedPanes.setTexture !== "function") return;

  if (params.paneStyle === "SVG") {
    if (svgTexture && svgAtlasInfo) {
      mergedPanes.setTexture(svgTexture, svgAtlasInfo);
      flights.forEach((flight) => flight.applyPaneTextureIndex?.());
    } else {
      mergedPanes.setTexture(null);
      loadSvgTexture()
        .then(({ texture, info }) => {
          if (params.paneStyle === "SVG" && mergedPanes) {
            mergedPanes.setTexture(texture, info);
            flights.forEach((flight) => flight.applyPaneTextureIndex?.());
          }
        })
        .catch(() => {});
    }
  } else {
    mergedPanes.setTexture(null);
  }
}

// Create a single flight from config
function createFlightFromConfig(
  config: FlightConfig,
  flightIndex: number,
): Flight {
  // Add merged renderers and indices to config
  const flightConfig = {
    ...config,
    mergedCurves: mergedCurves,
    curveIndex: flightIndex,
    mergedPanes: mergedPanes,
    paneIndex: flightIndex,
  };
  const flight = new Flight(scene, flightConfig);
  flight.create();
  if ("flightData" in flightConfig) {
    flight.setFlightData(flightConfig.flightData);
  }
  if (flightConfig.paneTextureIndex !== undefined) {
    flight.setPaneTextureIndex(flightConfig.paneTextureIndex);
  }

  // Set initial animation speed and tilt mode
  flight.setAnimationSpeed(
    flightConfig.animationSpeed !== undefined
      ? flightConfig.animationSpeed
      : params.animationSpeed,
    { immediate: true },
  );
  flight.setTiltMode(params.tiltMode);
  if (flightConfig.elevationOffset !== undefined) {
    flight.setPaneElevation(flightConfig.elevationOffset);
  } else {
    flight.setPaneElevation(params.elevationOffset);
  }
  flight.setReturnFlight(flightConfig.returnFlight);

  return flight;
}

// Initialize all flights (full reset)
function initializeFlights(): void {
  // Clear existing flights
  flights.forEach((flight) => flight.remove());
  flights = [];

  // Remove old merged renderers if they exist
  if (mergedCurves) {
    mergedCurves.remove();
  }
  if (mergedPanes) {
    mergedPanes.remove();
  }

  // Create new merged curves renderer
  mergedCurves = new Curves(scene, {
    maxCurves: MAX_FLIGHTS,
    segmentsPerCurve: params.segmentCount,
    dashSize: params.dashSize,
    gapSize: params.gapSize,
  });

  // Create new merged panes renderer (GPU Shader)
  mergedPanes = new PanesShader(scene, {
    maxPanes: MAX_FLIGHTS,
    baseSize: params.planeSize,
    returnMode: params.returnFlight,
    baseElevation: params.elevationOffset,
  });

  flightPathManager.applyDashPattern();
  applyPaneTexture();

  const availableConfigs = preGeneratedConfigs.length;
  const desiredCount =
    availableConfigs > 0
      ? Math.min(params.numFlights, availableConfigs)
      : params.numFlights;

  if (availableConfigs > 0 && params.numFlights !== desiredCount) {
    params.numFlights = desiredCount;
  }

  for (let i = 0; i < desiredCount; i++) {
    let baseConfig: FlightConfig;
    if (preGeneratedConfigs.length) {
      const configIndex = i % preGeneratedConfigs.length;
      baseConfig = ensurePlaneDefaults(preGeneratedConfigs[configIndex]);
      baseConfig.returnFlight = params.returnFlight;
      preGeneratedConfigs[configIndex] = baseConfig;
    } else {
      baseConfig = assignRandomPlane(
        FlightUtils.generateRandomFlightConfig({ numControlPoints: 2 }),
      );
      baseConfig.returnFlight = params.returnFlight;
    }

    const flightConfig: FlightConfig = {
      ...baseConfig,
      controlPoints: FlightUtils.cloneControlPoints(baseConfig.controlPoints),
      segmentCount: params.segmentCount,
      curveColor: baseConfig.curveColor,
      paneSize: params.planeSize,
      paneColor: resolvePaneColor(baseConfig),
      animationSpeed: planeControlsManager.resolveAnimationSpeed(
        baseConfig as Record<string, any>,
      ),
      elevationOffset:
        baseConfig.elevationOffset !== undefined
          ? baseConfig.elevationOffset
          : params.elevationOffset,
      paneTextureIndex: baseConfig.paneTextureIndex,
      returnFlight: params.returnFlight,
    };
    const flight = createFlightFromConfig(flightConfig, i);
    flights.push(flight);
  }

  // Update visible counts in merged renderers
  flightPathManager.applyVisibility();
  planeControlsManager.setHidePlane(params.hidePlane);

  flightControlsManager.setReturnFlight(params.returnFlight);
}

// Update flight count (preserves existing flights)
function updateFlightCount(count: number): void {
  flightControlsManager.updateFlightCount(count);
}

// Function to update segment count
function updateSegmentCount(count: number): void {
  // Note: Segment count is global in merged curves
  // Need to recreate all curves
  params.segmentCount = count;
  preGenerateFlightConfigs();
  initializeFlights();
}

// Function to update plane size
function updatePlaneSize(size: number): void {
  planeControlsManager.setPlaneSize(size);
}

// Function to update plane color
function updatePlaneColor(color: any): void {
  planeControlsManager.setPlaneColor(color);
}

function updateDashSize(size: number): void {
  flightPathManager.setDashSize(size);
}

function updateGapSize(size: number): void {
  flightPathManager.setGapSize(size);
}

function updateHidePath(value: boolean): void {
  flightPathManager.setHidePath(value);
}

function updateReturnFlight(value: boolean): void {
  flightControlsManager.setReturnFlight(value);
}

function randomizeAllFlightCurves(): void {
  flights.forEach((flight, index) => {
    const randomConfig = FlightUtils.generateRandomFlightConfig({
      numControlPoints: 2,
    });
    const normalizedPoints = FlightUtils.normalizeControlPoints(
      randomConfig.controlPoints,
      EARTH_RADIUS,
      MIN_CURVE_ALTITUDE,
    );

    const existingConfig = preGeneratedConfigs[index] || {};
    let updatedConfig: FlightConfig = {
      ...existingConfig,
      ...randomConfig,
      controlPoints: normalizedPoints,
      segmentCount: params.segmentCount,
      curveColor: randomConfig.curveColor,
      elevationOffset:
        existingConfig.elevationOffset !== undefined
          ? existingConfig.elevationOffset
          : params.elevationOffset,
      flightData: existingConfig.flightData ?? null,
      planeInfo: null,
      paneTextureIndex: undefined,
      paneColor: undefined,
    };
    updatedConfig = assignRandomPlane(updatedConfig);
    updatedConfig._randomSpeed = params.randomSpeed
      ? randomConfig.animationSpeed
      : undefined;
    updatedConfig.returnFlight = params.returnFlight;
    preGeneratedConfigs[index] = updatedConfig;

    flight.setFlightData(updatedConfig.flightData);
    flight.setControlPoints(FlightUtils.cloneControlPoints(normalizedPoints));
    flight.setPaneElevation(updatedConfig.elevationOffset);
    flight.setPaneTextureIndex(updatedConfig.paneTextureIndex);
    flight.setCurveColor(updatedConfig.curveColor);
    const paneColor = resolvePaneColor(updatedConfig);
    flight.setPaneColor(paneColor);
    const speed = planeControlsManager.resolveAnimationSpeed(updatedConfig);
    flight.setAnimationSpeed(speed);
    flight.setReturnFlight(params.returnFlight);
  });

  if (mergedCurves) {
    mergedCurves.applyUpdates();
  }
}

// Pre-generate all flight configurations on startup
preGenerateFlightConfigs();

// Initialize the flights
initializeFlights();

// Add stars background
stars = new Stars(5000, 10000, 20000);
stars.addToScene(scene);

// Add Earth with atmosphere
earth = new Earth(3000, () => {
  window.earthTextureLoaded = true;
  checkReadyToStart();
});
earth.addToScene(scene);

// Add lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.35);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(1000, 1000, 1000);
directionalLight.target.position.set(0, 0, 0);
scene.add(directionalLight.target);
scene.add(directionalLight);

earthControlsManager = new EarthControlsManager({
  ambientLight,
  directionalLight,
  getGuiControls: () => guiControls,
  updateLighting,
  getEarth: () => earth,
  getCurrentUtcTimeHours,
  hoursToTimeString,
});

setupGlobalControls();
updateLighting();
updateSunPosition();
window.earthTextureLoaded = false;
window.minTimeElapsed = false;
uiManager.createLoadingScreen();
uiManager.createFooter();
uiManager.hideDuringLoading();
uiManager.updateCoordinateDisplay(camera, earth);
minLoadingTimeoutId = window.setTimeout(() => {
  window.minTimeElapsed = true;
  checkReadyToStart();
}, 2000);

// Position camera
camera.position.set(0, 2000, 8000);
camera.lookAt(0, 0, 0);

// Setup OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minDistance = 3200;
controls.maxDistance = 20000;
controls.maxPolarAngle = Math.PI;

// Performance profiling (toggle with 'p' key)
let enableProfiling: boolean = false;
const perfStats: PerfStats = {
  flightUpdates: 0,
  mergedUpdates: 0,
  controlsUpdate: 0,
  render: 0,
  total: 0,
};

// Toggle profiling with 'p' key
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") {
    enableProfiling = !enableProfiling;
  }
});

// Animation loop
function animate(): void {
  requestAnimationFrame(animate);

  stats.begin(); // Begin measuring

  const delta = clock.getDelta();
  let t0: number, t1: number;

  // Update all flights
  if (enableProfiling) t0 = performance.now();

  // GPU Shader mode: Only update the time uniform (no per-flight work!)
  if (mergedPanes) {
    mergedPanes.update(delta);
  }

  if (stars) {
    stars.update(delta);
  }

  updateSunPosition();
  uiManager.updateCoordinateDisplay(camera, earth);

  if (enableProfiling) {
    t1 = performance.now();
    perfStats.flightUpdates += t1 - t0!;
  }

  // Apply any pending updates to merged renderers
  if (enableProfiling) t0 = performance.now();
  if (mergedCurves) {
    mergedCurves.applyUpdates();
  }
  if (enableProfiling) {
    t1 = performance.now();
    perfStats.mergedUpdates += t1 - t0!;
  }

  // Update controls
  if (enableProfiling) t0 = performance.now();
  controls.update();
  if (enableProfiling) {
    t1 = performance.now();
    perfStats.controlsUpdate += t1 - t0!;
  }

  // Render
  if (enableProfiling) t0 = performance.now();
  renderer.render(scene, camera);
  if (enableProfiling) {
    t1 = performance.now();
    perfStats.render += t1 - t0!;
    perfStats.total++;

    // Log stats every 60 frames
    if (perfStats.total % 60 === 0) {
      // Logging removed intentionally to keep console clean.
    }
  }

  stats.end(); // End measuring
}

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start animation
animate();
