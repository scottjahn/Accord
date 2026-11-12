declare const brand: unique symbol;

/** Nominal typing for ids so a SystemId cannot be passed where an EmpireId is expected. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SystemId = Brand<string, 'SystemId'>;
export type EmpireId = Brand<string, 'EmpireId'>;
export type FactionId = Brand<string, 'FactionId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type HullId = Brand<string, 'HullId'>;
export type FleetId = Brand<string, 'FleetId'>;
export type ShipId = Brand<string, 'ShipId'>;

/**
 * Keys of a record in sorted order. The sim always iterates records through this
 * so results never depend on insertion order.
 */
export function sortedKeys<K extends string>(record: Record<K, unknown>): K[] {
  return (Object.keys(record) as K[]).sort();
}
