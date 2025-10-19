import * as THREE from "three";
import type { Earth } from "./Earth.ts";

interface EarthControlsOptions {
  ambientLight: THREE.AmbientLight;
  directionalLight: THREE.DirectionalLight;
  getGuiControls: () => any;
  updateLighting: () => void;
  getEarth: () => Earth | null;
}

export class EarthControlsManager {
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private getGuiControls: () => any;
  private updateLighting: () => void;
  private getEarth: () => Earth | null;
  private baseAmbientColor: THREE.Color | null;
  private baseAmbientIntensity: number;
  private baseDirectionalIntensity: number;

  constructor(options: EarthControlsOptions) {
    this.ambientLight = options.ambientLight;
    this.directionalLight = options.directionalLight;
    this.getGuiControls = options.getGuiControls;
    this.updateLighting = options.updateLighting;
    this.getEarth = options.getEarth;

    this.baseAmbientColor = this.ambientLight.color.clone();
    this.baseAmbientIntensity = this.ambientLight.intensity;
    this.baseDirectionalIntensity = this.directionalLight.intensity;
  }

  public toggleDayNightEffect(enabled: boolean): void {
    if (enabled) {
      this.directionalLight.visible = true;
      this.ambientLight.color.copy(this.baseAmbientColor);
      this.ambientLight.intensity = this.baseAmbientIntensity;
      this.directionalLight.intensity = this.baseDirectionalIntensity;
    } else {
      this.directionalLight.visible = false;
      this.directionalLight.intensity = 0;
    }

    const guiControls = this.getGuiControls();
    if (guiControls) {
      guiControls.dayNightEffect = enabled;
    }

    this.updateLighting();
  }

  public toggleAtmosphereEffect(enabled: boolean): void {
    const earth = this.getEarth();
    const atmosphereMesh = earth?.atmosphere?.mesh;
    if (atmosphereMesh) {
      atmosphereMesh.visible = enabled;
    }

    const guiControls = this.getGuiControls();
    if (guiControls) {
      guiControls.atmosphereEffect = enabled;
    }
  }

  public getBaseAmbientColor(): THREE.Color {
    return this.baseAmbientColor;
  }

  public getBaseAmbientIntensity(): number {
    return this.baseAmbientIntensity;
  }
}
