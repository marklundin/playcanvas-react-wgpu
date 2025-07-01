import { ScopeId } from 'playcanvas';

export const applyUniformControls = (
  controls: Record<string, unknown>,
  entry: [string, ScopeId]
) => {
  const [name, uniform] = entry;
  let value = controls[name];
  value =
    typeof value === 'object'
      ? // @ts-expect-error
        Object.values(value).map((c: number) => c / 255.0)
      : value;

  uniform.setValue(value);
};
