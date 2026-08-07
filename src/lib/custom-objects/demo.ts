import type { CustomObject } from "@/domain";

/**
 * Demo object types for the offline preview (ARC_DEMO_DATA).
 *
 * Same reasoning as the custom-field fixtures: without these the whole feature
 * is invisible without a database, and a surface nobody can look at is a
 * surface whose bugs nobody finds — the custom-field fixtures caught a real
 * styling defect within a minute of existing.
 *
 * Tenant-agnostic on purpose. "Equipment" is the kind of thing an owner-operator
 * tracks that none of the six model, and it is not specific to any one trade.
 *
 * ⚠️ Not writable. Demo mode has no Supabase, so creating or editing an object
 * type reports that plainly rather than appearing to save.
 */
const DEMO_OBJECTS: CustomObject[] = [
  {
    id: "demo-object-equipment",
    key: "equipment",
    labelPlural: "Equipment",
    labelSingular: "Equipment item",
    description: "Machines and tools you own, and what state they are in.",
    sortOrder: 0,
    active: true,
  },
];

export function demoCustomObjects(): CustomObject[] {
  return DEMO_OBJECTS;
}

/** Demo rows for a demo object, so the list is not empty in the preview. */
export function demoCustomRecords(objectKey: string): { id: string; title: string; subtitle: string | null }[] {
  if (objectKey !== "equipment") return [];
  return [
    { id: "demo-eqr-1", title: "Truck-mounted extractor #3", subtitle: "In service · Van 2" },
    { id: "demo-eqr-2", title: "Air scrubber — 500 CFM", subtitle: "In service · Warehouse" },
    { id: "demo-eqr-3", title: "Moisture meter (pin-type)", subtitle: "Needs calibration" },
  ];
}
