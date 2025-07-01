import { useApp, useFrame } from '@playcanvas/react/hooks';
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

let t = 0.0;

function Scene() {
  const app = useApp();
  const shaderRef = useRef<Shader>(null);
  const controls = useControls({
    exposure: {
      value: 7,
      min: 0,
      max: 10,
    },
    bendAmount: {
      value: 1.0,
      min: 0.0,
      max: 10.0,
    },
    speed: {
      value: 0.16,
      min: 0.0,
      max: 2.0,
    },
    vignette: {
      value: 1.1,
      min: 0.0,
      max: 1.5,
    },
    turbulence: {
      value: 1.1,
      min: 0.0,
      max: 2.5,
    },
    highlight: {
      value: 0.04,
      min: 0.0,
      max: 0.1,
    },
    baseColor: {
      r: 0.0,
      g: 255.0,
      b: 255.0,
    },
  });

  // Resolve the shader uniforms for each control
  const uniforms = useMemo<[string, ScopeId][]>(
    () =>
      Object.entries(controls).map(([name]) => [
        name,
        app.graphicsDevice.scope.resolve(name),
      ]),
    [...Object.keys(controls)]
  );

  // ────────────────────────
  // Full Screen Quad Shader
  // ────────────────────────
  const vertexGLSL = /* glsl */ `
    attribute vec4 aPosition;
    varying vec2 vUv;

    void main () {
      vUv = (aPosition.xy + 1.0) * 0.5;
      gl_Position = aPosition;
    }
  `;

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

  const fragmentGLSL = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;

    // controls
    uniform float exposure;
    uniform float bendAmount;
    uniform float speed;
    uniform float vignette;
    uniform float turbulence;
    uniform float highlight;
    uniform vec3 baseColor;
    
    /* tweakables */

    const float EPSILON = 0.001;
    const int MAX_STEPS = 100;

    vec3 twistyTorus(vec3 p) {
      vec3 bend = vec3(
        sin(0.1 * p.z - (uTime * 0.2 * speed)), 
        sin(0.15 * p.z + uTime * speed), 
        0.0) * vec3(6.0, 4.0, 0.0) * bendAmount;

      p -= bend;
      p = vec3(
        atan(p.y, p.x),
        p.z / 10.0 + (uTime* 0.8 * speed),
        length(p.xy) - 9.0
      );
      return p;
    }

    void main () {

      // Output color
      vec3 color = vec3(0.0);

      // centred, aspect-correct coordinates
      vec2 uv = vUv * 2.0 - 1.0;
      uv.x *= uResolution.x / uResolution.y;

      // primary rays
      vec3 ro = vec3(0.0, 0.0, 0.0);
      vec3 rd = normalize(vec3(uv, 1.0));

      float t = 3.0;
      float d = 0.0;
      float factor = 1.0 / float(MAX_STEPS);

      for (int i = 0; i < MAX_STEPS; ++i) {

          vec3 p = ro + rd * t;

          p = twistyTorus(p);          

          // turbulence
          for (int s = 1; s <= 6; ++s) { 
              float fs = float(s);
              p += sin(p.zxy * fs - (uTime*speed) + float(i) * 0.3) / fs * turbulence;
          }

          /* signed-distance estimate */
          d = .2 * length(vec4(0.2 * cos(6.0 * p) - 0.2, p.z));
          t += d;

          // rotate the color over time
          float hueShift = 0.15 * sin(speed * uTime);
          vec3 phase = baseColor + vec3(2.0 + 6.2831 * hueShift, 0.5 + hueShift, 0.2);

          // accumulate color at this point
          vec3 o = (cos(p.x + phase) + 1.0) / max(d, highlight) / t;
          o *= factor;
          color += o;
      }

      // Vignette
      float dv = length(vUv - 0.5) * vignette;
      color *= smoothstep(1.0, 0.35, dv);
      
      /* tone-map */
      
      // filmic
      color *= exposure;

      // Simple tonemapper
      // color = tanh(color * color / 100.0);

      // A filmic tonemapper
      color = (color * (2.51*color + 0.03))
            / (color * (2.43*color + 0.59) + 0.35);   // 0.14 → 0.35

      // after tone-map, before gamma
      color = mix( color,        // keep 70 %
        pow(color, vec3(1.4)),   // darken mids / lift brights
        0.30 );                  // 0→no change, 1→full curve

      // gamma
      // color = pow(color, vec3(1.0/2.2));   // ≈ sRGB encode

      gl_FragColor = vec4(color, 1.0);
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

    varying vUv: vec2f;

    /*----------------------------------------------------------
      Constants
    ----------------------------------------------------------*/
    const EPSILON   : f32 = 0.001;
    const MAX_STEPS : i32 = 100;

    /*----------------------------------------------------------
      Helper – “twisty torus” deformation
    ----------------------------------------------------------*/
    fn twistyTorus(p : vec3f) -> vec3f {
      let bend = vec3f(
        sin(0.1 * p.z - (uniform.uTime * 0.2 * uniform.speed)),
        sin(0.15 * p.z +  uniform.uTime       * uniform.speed),
        0.0
      ) * vec3f(6.0, 4.0, 0.0) * uniform.bendAmount;

      var outp = p - bend;

      return vec3f(
        atan2(outp.y, outp.x),
        outp.z / 10.0 + (uniform.uTime * 0.8 * uniform.speed),
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
      let rd = normalize(vec3f(uv, 1.0));

      var t       : f32 = 3.0;
      var d       : f32 = 0.0;
      let factor  : f32 = 1.0 / f32(MAX_STEPS);

      var color : vec3f = vec3f(0.0);
      

      /* ---------- ray-march loop ---------- */
      for (var i : i32 = 0; i < MAX_STEPS; i = i + 1) {

        var p = ro + rd * t;
        p = twistyTorus(p);

        /* turbulence */
        for (var s : i32 = 1; s <= 6; s = s + 1) {
          let fs : f32 = f32(s);
          p += sin(p.zxy * fs
            - (uniform.uTime * uniform.speed)
            + f32(i) * 0.3) / fs * uniform.turbulence;
        }

        /* signed-distance estimate */
        d  = 0.2 * length(vec4f(0.2 * cos(6.0 * p) - 0.2, p.z));
        t += d;

        /* colour phase shift */
        let hueShift = 0.15 * sin(uniform.speed * uniform.uTime);
        let phase = uniform.baseColor
          + vec3f(2.0 + 6.2831 * hueShift,
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
    shaderRef.current = ShaderUtils.createShader(app.graphicsDevice, {
      uniqueName: 'magic-shader',
      attributes: { aPosition: SEMANTIC_POSITION },
      // vertexGLSL,
      // fragmentGLSL,
      vertexWGSL,
      fragmentWGSL,
    });

    return () => {
      shaderRef.current?.destroy();
      shaderRef.current = null;
    };
  }, [app, vertexGLSL, fragmentGLSL, vertexWGSL, fragmentWGSL]);

  /**
   * Frame loop.
   * Update the uniforms and render the shader each gframe
   */
  useFrame((dt: number) => {
    if (!shaderRef.current) return;

    // Set up basic uniforms
    app.graphicsDevice.scope.resolve('uTime').setValue((t += dt));
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
