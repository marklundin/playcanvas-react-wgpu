import { useApp } from '@playcanvas/react/hooks';
import { useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import {
  ShaderUtils,
  SEMANTIC_POSITION,
  drawQuadWithShader,
  Shader,
  ScopeId,
} from 'playcanvas';
import { applyUniformControls } from './utils/uniforms';
import { usePrerender } from './utils/use-prerender';

let t = 0.0;

function Scene() {
  const app = useApp();
  const shaderRef = useRef<Shader>(null);
  const controls = useControls({
    exposure: {
      value: 3.5,
      min: 0,
      max: 10,
    },
    fov: {
      value: 100.0,
      min: 15.0,
      max: 160.0,
    },
    fisheye: {
      value: 1.5,
      min: 0.0,
      max: 2.0,
    },
    bendAmount: {
      value: -0.75,
      min: -3.0,
      max: 3.0,
    },
    speed: {
      value: 1.5,
      min: 0.0,
      max: 5.0,
    },
    vignette: {
      value: 1.1,
      min: 0.0,
      max: 1.5,
    },
    turbulence: {
      value: 0.6,
      min: 0.0,
      max: 2.0,
    },
    highlight: {
      value: 0.04,
      min: 0.0,
      max: 0.1,
    },
    baseColor: {
      r: 199,
      g: 157,
      b: 103,
    },
  });

  // Resolve the shader uniforms for each control
  const uniforms = useMemo<[string, ScopeId][]>(
    () =>
      Object.entries(controls).map(([name]) => [
        name,
        app.graphicsDevice.scope.resolve(name),
      ]),
    [app, ...Object.keys(controls)]
  );

  // ────────────────────────
  // Full Screen Quad Shader
  // ────────────────────────

  const vertexWGSL = `
    varying vUv: vec2f;
    attribute aPosition: vec4f;

    @vertex fn vertexMain(input: VertexInput) -> VertexOutput {
      var output: VertexOutput;
      output.position = input.aPosition;
      output.vUv = (input.aPosition.xy + 1.0) * 0.5;
      return output;
    }
  `;

  const fragmentWGSL = `
  
    uniform uResolution: vec2f;
    uniform uTime       : f32;

    uniform exposure    : f32;
    uniform bendAmount  : f32;
    uniform speed       : f32;
    uniform vignette    : f32;
    uniform turbulence  : f32;
    uniform highlight   : f32;
    uniform baseColor   : vec3f;
    uniform fov         : f32;  
    uniform fisheye     : f32;// 0 no, 1 yes   

    varying vUv: vec2f;

    /*----------------------------------------------------------
      Constants
    ----------------------------------------------------------*/
    const EPSILON   : f32 = 0.001;
    const MAX_STEPS : i32 = 100;
    const PI        : f32 = 3.14159265358979323846;

    /*----------------------------------------------------------
      Helper – “twisty torus” deformation
    ----------------------------------------------------------*/
    fn twistyTorus(p : vec3f) -> vec3f {
      let bend = vec3f(
        sin(0.1 * p.z - (uniform.uTime * 0.2)),
        sin(0.15 * p.z +  uniform.uTime),
        0.0
      ) * vec3f(6.0, 4.0, 0.0) * uniform.bendAmount;

      var outp = p - bend;

      return vec3f(
        atan2(outp.y, outp.x),
        outp.z / 10.0 + (uniform.uTime * 0.8),
        length(outp.xy) - 9.0
      );
    }

    /*----------------------------------------------------------
      Fragment stage
    ----------------------------------------------------------*/
    @fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {

      /* ---------- centred, aspect-correct NDC ---------- */
      var uv = vUv * 2.0 - vec2f(1.0);
      uv.x *= uniform.uResolution.x / uniform.uResolution.y;

      /* ---------- primary ray ---------- */
      let ro = vec3f(0.0, 0.0, 0.0);

      // perspective direction (classic pin-hole)
      let k  = tan(0.5 * radians(uniform.fov));
      let rdPersp = normalize(vec3f(uv * k, 1.0));

      // equidistant fisheye direction (180° when r = 1)
      let r  = length(uv);
      let φ  = atan2(uv.y, uv.x);
      let θ  = r * radians(uniform.fov) * 0.5;     // scale by FOV
      let rdFish  = normalize(vec3f(sin(θ) * cos(φ),
                                    sin(θ) * sin(φ),
                                    cos(θ)));

      // mix between the two
      let rd = normalize(mix(rdPersp, rdFish, uniform.fisheye));

      var t       : f32 = 3.0;
      var d       : f32 = 0.0;
      let factor  : f32 = 1.0 / f32(MAX_STEPS);

      var color : vec3f = vec3f(0.0);
      

      /* ---------- ray-march loop ---------- */
      for (var i : i32 = 0; i < MAX_STEPS; i = i + 1) {

        var p = ro + rd * t;
        p = twistyTorus(p);

        /* turbulence */
        for (var s : i32 = 1; s <= 7; s = s + 1) {
          let fs : f32 = f32(s);
          p += sin(p.zxy * fs
            - (uniform.uTime)
            + f32(i) * 0.3) / fs * uniform.turbulence;
        }

        /* signed-distance estimate */
        d  = 0.2 * length(vec4f(0.2 * cos(6.0 * p) - 0.2, p.z));
        t += d;

        /* color phase shift */
        let hueShift = 0.15 * sin(uniform.uTime);
        let phase = uniform.baseColor
          * vec3f(2.0 + 6.2831 * hueShift,
                  0.5 + hueShift,
                  0.2);

        /* accumulate */
        var o = (cos(p.x + phase) + 1.0) /
          max(d, uniform.highlight) / t;

        o *= factor;
        color += o;
      }

      /* ---------- vignette ---------- */
      let dv = length(vUv - vec2f(0.5)) * uniform.vignette;
      color *= smoothstep(1.0, 0.35, dv);

      /* ---------- tone-mapping ---------- */
      color *= uniform.exposure;

      color  = (color * (2.51 * color + 0.03))
        / (color * (2.43 * color + 0.59) + 0.35);

      color = mix(color,
        pow(color, vec3f(1.4)),
        0.30);

      var output: FragmentOutput;
      output.color = vec4f(color, 1.0);
      return output;
    }
  `;

  /**
   * Creates a new shader when the shader contents change
   */
  useEffect(() => {
    if(!app) return;
    shaderRef.current = ShaderUtils.createShader(app.graphicsDevice, {
      uniqueName: 'magic-shader',
      attributes: { aPosition: SEMANTIC_POSITION },
      vertexWGSL,
      fragmentWGSL,
    });

    return () => {
      shaderRef.current?.destroy();
      shaderRef.current = null;
    };
  }, [app, vertexWGSL, fragmentWGSL]);

  /**
   * Update the uniforms and render the shader each frame
   */
  usePrerender((dt: number) => {
    if (!shaderRef.current || !app) return;

    // Set up basic uniforms
    app.graphicsDevice.scope.resolve('uTime').setValue((t += dt * controls.speed));
    app.graphicsDevice.scope
      .resolve('uResolution')
      .setValue([window.innerWidth, window.innerHeight]);

    // Add the uniforms from the controls
    uniforms.forEach((entry) => applyUniformControls(controls, entry));

    drawQuadWithShader(app.graphicsDevice, null, shaderRef.current);
  });

  return null;
}

export default Scene;
