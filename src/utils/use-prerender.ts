import { useEffect, useCallback, useRef } from "react";
import { useApp } from "@playcanvas/react/hooks";

/**
 * useFrame hook — registers a callback on every frame update.
 * The callback receives the delta time (dt) since the last frame.
 */
export const usePrerender = (callback: (dt: number) => void) => {
  const app = useApp();

  // store timestamp of previous frame to compute our own delta time
  const lastTimeRef = useRef<number>(performance.now());

  // memoize handler so we can clean up properly
  const handler = useCallback(() => {
    const now = performance.now();
    const dt = (now - lastTimeRef.current) / 1000; // convert ms → s

    // update for the next frame BEFORE invoking callback to avoid side effects
    lastTimeRef.current = now;

    callback(dt);
  }, [callback]);

  useEffect(() => {
    if (!app) {
      throw new Error("`useApp` must be used within an Application component");
    }

    // initialize timestamp when the effect (and therefore listener) is set up
    lastTimeRef.current = performance.now();

    app.on("prerender", handler);
    return () => {
      app.off("prerender", handler);
    };
  }, [app, handler]);
};