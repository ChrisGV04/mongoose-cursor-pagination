/**
 * Assertive function to check if any input is a POJO
 * @param item Any item to check
 * @returns Whether or not the input is an Object
 */
export function isObject(item: unknown): item is Object {
  return !!item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Function that merges two objects together. The `source` properties will override overlapping properties from the `target`.
 * @param target The base object to use as reference
 * @param source Extra fields to merge into the target
 * @returns A merged version of both objects
 */
export function deepMerge<T extends Object>(target: T, source?: Partial<T>): T {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    (Object.keys(source) as (keyof T)[]).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          // @ts-ignore
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}
