/**
 * Mesa VTT — Multisystem Registry (`@systems/registry`).
 * Loads built-in systems (`mighty-blade-3e`, `tagmar-3`, `generic-rpg`) and allows
 * dynamic registration of custom/community RPG system engines at runtime.
 */

import { genericRpgEngine } from "./generic-rpg/engine";
import { mightyBlade3eEngine } from "./mighty-blade-3e/engine";
import { tagmar3Engine } from "./tagmar/engine";
import type { RpgSystemEngine, SystemManifest } from "./types";

const engines = new Map<string, RpgSystemEngine>([
  [mightyBlade3eEngine.manifest.id, mightyBlade3eEngine],
  [tagmar3Engine.manifest.id, tagmar3Engine],
  [genericRpgEngine.manifest.id, genericRpgEngine],
]);

const SYSTEM_ALIASES: Record<string, string> = {
  tagmar: "tagmar-3",
  "tagmar-3e": "tagmar-3",
  "tagmar-3.0": "tagmar-3",
};

function normalizeSystemId(systemId: string): string {
  return SYSTEM_ALIASES[systemId] ?? systemId;
}

/** Registers or overrides an RPG system engine at runtime. */
export function registerSystem(engine: RpgSystemEngine): void {
  if (!engine?.manifest?.id) {
    throw new Error("Sistema inválido: manifest.id é obrigatório.");
  }
  engines.set(engine.manifest.id, engine);
}

/** Returns the system engine for `systemId`, falling back to `generic-rpg` if unknown. */
export function getSystemEngine(systemId: string): RpgSystemEngine {
  return engines.get(normalizeSystemId(systemId)) ?? genericRpgEngine;
}

/** Alias for `getSystemEngine(systemId)` matching Multisystem SDK docs. */
export function getSystem(systemId: string): RpgSystemEngine {
  return getSystemEngine(systemId);
}

/** Strict lookup without fallback (returns undefined if system is not registered). */
export function findSystemEngine(systemId: string): RpgSystemEngine | undefined {
  return engines.get(normalizeSystemId(systemId));
}

/** Lists all registered system manifests (`[mighty-blade-3e, tagmar-3, generic-rpg]`). */
export function listSystemManifests(): SystemManifest[] {
  return Array.from(engines.values()).map((e) => e.manifest);
}

/** Alias returning all registered system manifests (`[mighty-blade-3e, tagmar-3, generic-rpg]`). */
export function listSystems(): SystemManifest[] {
  return listSystemManifests();
}

/** Lists all registered system engines. */
export function listSystemEngines(): RpgSystemEngine[] {
  return Array.from(engines.values());
}

export { mightyBlade3eEngine, tagmar3Engine, genericRpgEngine };
