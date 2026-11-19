/**
 * Mesa VTT — Multisystem Registry (`@systems/registry`).
 * Loads built-in systems (`mighty-blade-3e`, `generic-rpg`) and allows dynamic
 * registration of custom/community RPG system engines at runtime.
 */

import { genericRpgEngine } from "./generic-rpg/engine";
import { mightyBlade3eEngine } from "./mighty-blade-3e/engine";
import type { RpgSystemEngine, SystemManifest } from "./types";

const engines = new Map<string, RpgSystemEngine>([
  [mightyBlade3eEngine.manifest.id, mightyBlade3eEngine],
  [genericRpgEngine.manifest.id, genericRpgEngine],
]);

/** Registers or overrides an RPG system engine at runtime. */
export function registerSystem(engine: RpgSystemEngine): void {
  if (!engine?.manifest?.id) {
    throw new Error("Sistema inválido: manifest.id é obrigatório.");
  }
  engines.set(engine.manifest.id, engine);
}

/** Returns the system engine for `systemId`, falling back to `generic-rpg` if unknown. */
export function getSystemEngine(systemId: string): RpgSystemEngine {
  return engines.get(systemId) ?? genericRpgEngine;
}

/** Strict lookup without fallback (returns undefined if system is not registered). */
export function findSystemEngine(systemId: string): RpgSystemEngine | undefined {
  return engines.get(systemId);
}

/** Lists all registered system manifests (Mighty Blade 3e first as flagship). */
export function listSystemManifests(): SystemManifest[] {
  return Array.from(engines.values()).map((e) => e.manifest);
}

/** Lists all registered system engines. */
export function listSystemEngines(): RpgSystemEngine[] {
  return Array.from(engines.values());
}

export { mightyBlade3eEngine, genericRpgEngine };
