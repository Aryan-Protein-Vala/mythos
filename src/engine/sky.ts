import * as THREE from "three";
import type { SkySpec } from "../world/types";

export interface SkySystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  sunDirection: THREE.Vector3;
  update(sky: SkySpec, time: number): void;
  setSunDirection(dir: THREE.Vector3): void;
  dispose(): void;
}

export function sunDirectionFromSky(sky: SkySpec): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - sky.sunElevation);
  const theta = THREE.MathUtils.degToRad(sky.sunAzimuth);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunRadius;
  uniform float uCorona;
  uniform float uEclipse;
  uniform float uStars;
  uniform float uTime;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDirection);
    float height = pow(clamp(d.y, 0.0, 1.0), 0.62);
    vec3 col = mix(uHorizon, uTop, height);

    float band = exp(-abs(d.y) * 6.0);
    col += uHorizon * band * 0.20;

    // Below the horizon the sky settles into a darker version of the haze.
    col = mix(col, uTop * 0.62, smoothstep(0.0, -0.22, d.y));

    float ang = acos(clamp(dot(d, normalize(uSunDir)), -1.0, 1.0));
    float r = uSunRadius;

    // Tight, restrained corona: a bright ring and a short halo, not a wash.
    float corona = exp(-max(0.0, ang - r) * (46.0 - uCorona * 18.0)) * (0.04 + uCorona * 0.5);
    float ring = exp(-pow((ang - r * 1.015) / (r * 0.055 + 0.0022), 2.0)) * uCorona;
    col += uSunColor * (corona * 0.35 + ring * 1.9);

    // A wide, warm bloom around the disc for sun/moon looks. Eclipses keep
    // their tight ring, so this fades out as the corona takes over.
    float halo = exp(-max(0.0, ang - r) * 3.4) * 0.26 * (1.0 - uEclipse);
    col += uSunColor * halo;

    float disc = 1.0 - smoothstep(r * 0.96, r, ang);
    vec3 discColor = mix(uSunColor * 1.7, vec3(0.010, 0.010, 0.013), uEclipse);
    discColor += uSunColor * pow(clamp(1.0 - ang / r, 0.0, 1.0), 5.0) * (1.0 - uEclipse) * 0.9;
    col = mix(col, discColor, disc);

    if (uStars > 0.001) {
      vec3 sp = d * 260.0;
      float s = hash31(floor(sp));
      float star = step(0.9958, s) * smoothstep(0.55, 0.0, length(fract(sp) - 0.5));
      float twinkle = 0.7 + 0.3 * sin(uTime * 1.6 + s * 47.0);
      float mask = smoothstep(-0.03, 0.16, d.y);
      col += vec3(0.82, 0.88, 1.0) * star * uStars * 2.4 * twinkle * mask;
    }

    col = mix(col, uHorizon, smoothstep(0.15, -0.03, d.y) * 0.28);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky(sky: SkySpec): SkySystem {
  const sunDirection = sunDirectionFromSky(sky);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(sky.top) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uSunColor: { value: new THREE.Color(sky.sunColor) },
      uSunDir: { value: sunDirection.clone() },
      uSunRadius: { value: THREE.MathUtils.degToRad(sky.discSize * 0.5) },
      uCorona: { value: sky.corona },
      uEclipse: { value: sky.corona > 0.45 ? 1 : 0 },
      uStars: { value: sky.stars },
      uTime: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "sky";

  const update = (next: SkySpec, time: number) => {
    const u = material.uniforms;
    (u.uTop.value as THREE.Color).set(next.top);
    (u.uHorizon.value as THREE.Color).set(next.horizon);
    (u.uSunColor.value as THREE.Color).set(next.sunColor);
    (u.uSunRadius.value as number) = THREE.MathUtils.degToRad(next.discSize * 0.5);
    u.uCorona.value = next.corona;
    u.uEclipse.value = next.corona > 0.45 ? 1 : 0;
    u.uStars.value = next.stars;
    u.uTime.value = time;
    const dir = sunDirectionFromSky(next);
    (u.uSunDir.value as THREE.Vector3).copy(dir);
    sunDirection.copy(dir);
  };

  return {
    mesh,
    material,
    sunDirection,
    update,
    setSunDirection(dir: THREE.Vector3) {
      sunDirection.copy(dir);
      (material.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}