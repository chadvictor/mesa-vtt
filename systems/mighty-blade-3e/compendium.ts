/**
 * Mesa VTT — Mighty Blade 3ª Edição Compendium Loader & Typed Views.
 * Statically bundles verified core rules/races/classes/conditions JSONs from
 * `data/mighty-blade/` and provides hydration + lookup helpers for
 * abilities, spells, equipment, and bestiary datasets.
 */

import rulesJson from "../../data/mighty-blade/rules.json";
import racesJson from "../../data/mighty-blade/races.json";
import classesJson from "../../data/mighty-blade/classes.json";
import conditionsJson from "../../data/mighty-blade/conditions.json";
import abilitiesJson from "../../data/mighty-blade/abilities.json";
import spellsJson from "../../data/mighty-blade/spells.json";
import equipmentJson from "../../data/mighty-blade/equipment.json";
import bestiaryJson from "../../data/mighty-blade/bestiary.json";
import type { MightyBladeAttributes } from "../types";

export interface MBRace {
  id: string;
  name: string;
  source: string;
  description: string;
  attributes: MightyBladeAttributes;
  extraPoints: number;
  pvBonus: number;
  pmBonus: number;
  baseDefenseOverride: number | null;
  size: string;
  movementModifier: number;
  racialAbility: {
    id: string;
    name: string;
    type: string;
    costPm: number;
    description: string;
    automationEffect?: Record<string, unknown>;
  };
  languages: string[];
  suggestedPortrait: string;
}

export interface MBClass {
  id: string;
  name: string;
  source: string;
  category: string;
  description: string;
  primaryAttribute: keyof MightyBladeAttributes;
  spellcastingAttribute: keyof MightyBladeAttributes | null;
  attributeBonuses: MightyBladeAttributes;
  automaticAbility: {
    id: string;
    name: string;
    type: string;
    costPm: number;
    description: string;
    automationEffect?: Record<string, unknown>;
  };
  startingEquipment: string[];
  startingGold?: number;
  allowedPaths: string[];
  suggestedAbilities: string[];
  suggestedPortrait: string;
}

export interface MBCondition {
  id: string;
  name: string;
  category: string;
  icon: string;
  emoji?: string;
  color?: string;
  description: string;
  durationType: string;
  defaultTurns?: number;
  saveRule?: {
    attribute: keyof MightyBladeAttributes;
    difficulty: number;
    timing: string;
  } | null;
  modifiers: {
    defenseDelta?: number;
    attackDelta?: number;
    attackDiceMod?: number;
    testDelta?: number;
    testDiceMod?: number;
    damageBonus?: number;
    forcaBonus?: number;
    moveMultiplier?: number;
    moveDelta?: number;
    skipTurn?: boolean;
    cannotCastSpells?: boolean;
    cannotReact?: boolean;
    dotDamage?: number;
    dotType?: string | null;
    [key: string]: unknown;
  };
}

export interface MBAbility {
  id: string;
  name: string;
  classId: string;
  category: string;
  source?: string;
  requirement?: string;
  manaCost?: number;
  difficulty?: number;
  range?: string;
  duration?: string;
  description: string;
  automation?: {
    rollAttribute?: keyof MightyBladeAttributes;
    rollBonus?: number;
    damageFormula?: string;
    damageType?: string;
    healFormula?: string;
    defenseBonus?: number;
    appliesCondition?: string;
    targetType?: "self" | "single" | "area" | "ally";
    [key: string]: unknown;
  };
}

export interface MBSpell {
  id: string;
  name: string;
  path: string;
  classIds?: string[];
  type: string;
  manaCost: number;
  difficulty: number;
  range?: string;
  duration?: string;
  source?: string;
  description: string;
  automation?: {
    rollAttribute?: "inteligencia" | "vontade";
    damageFormula?: string;
    damageType?: string;
    healFormula?: string;
    defenseBonus?: number;
    appliesCondition?: string;
    area?: string;
    targetType?: "self" | "single" | "area" | "ally";
    [key: string]: unknown;
  };
}

export interface MBWeapon {
  id: string;
  name: string;
  fn: number;
  damageBonus: number;
  damageAttribute?: keyof MightyBladeAttributes;
  damageType: string;
  hands?: number;
  range?: string;
  distance?: string;
  price?: number;
  weight?: number;
  properties?: string[];
  description?: string;
}

export interface MBArmor {
  id: string;
  name: string;
  slot: "armor" | "shield";
  fn: number;
  defenseBonus: number;
  agilityPenalty?: number;
  dodgePenalty?: number;
  rd?: number;
  price?: number;
  weight?: number;
  properties?: string[];
  description?: string;
}

export interface MBGear {
  id: string;
  name: string;
  category?: string;
  consumable?: boolean;
  effect?: Record<string, unknown>;
  price?: number;
  weight?: number;
  description?: string;
}

export interface MBEquipmentCatalog {
  weapons: MBWeapon[];
  armor: MBArmor[];
  gear: MBGear[];
}

export interface MBCreature {
  id: string;
  name: string;
  category?: string;
  challengeLevel?: number;
  description?: string;
  portrait?: string;
  attributes: MightyBladeAttributes;
  pvMax: number;
  pmMax: number;
  bloqueio: number;
  esquiva: number;
  determinacao: number;
  movement?: number;
  xpReward?: number;
  attacks?: Array<{
    name: string;
    rollAttr?: keyof MightyBladeAttributes;
    rollBonus?: number;
    damage: number | string;
    damageType?: string;
    range?: string;
    notes?: string;
  }>;
  abilities?: Array<{
    name: string;
    manaCost?: number;
    description: string;
  }>;
  loot?: string[];
}

export interface MightyBladeContentBundle {
  abilities: MBAbility[];
  spells: MBSpell[];
  equipment: MBEquipmentCatalog;
  bestiary: MBCreature[];
}

export const mbRules = rulesJson;
export const mbRaces = racesJson as MBRace[];
export const mbClasses = classesJson as MBClass[];
export const mbConditions = conditionsJson as MBCondition[];
export const mbAbilities = abilitiesJson as unknown as MBAbility[];
export const mbSpells = spellsJson as unknown as MBSpell[];
export const mbEquipment = equipmentJson as unknown as MBEquipmentCatalog;
export const mbBestiary = bestiaryJson as unknown as MBCreature[];

const dynamicContent: MightyBladeContentBundle = {
  abilities: mbAbilities,
  spells: mbSpells,
  equipment: {
    weapons: mbEquipment.weapons ?? [],
    armor: mbEquipment.armor ?? [],
    gear: mbEquipment.gear ?? [],
  },
  bestiary: mbBestiary,
};

/**
 * Hydrates or replaces the extended Mighty Blade 3e compendium (abilities, spells,
 * equipment, bestiary) — called automatically with static JSON data when bundled
 * or from the server's `/api/v1/compendium/mighty-blade` endpoint at runtime.
 */
export function hydrateMightyBladeCompendium(partial: Partial<MightyBladeContentBundle>): void {
  if (Array.isArray(partial.abilities)) dynamicContent.abilities = partial.abilities;
  if (Array.isArray(partial.spells)) dynamicContent.spells = partial.spells;
  if (partial.equipment) {
    dynamicContent.equipment = {
      weapons: Array.isArray(partial.equipment.weapons) ? partial.equipment.weapons : dynamicContent.equipment.weapons,
      armor: Array.isArray(partial.equipment.armor) ? partial.equipment.armor : dynamicContent.equipment.armor,
      gear: Array.isArray(partial.equipment.gear) ? partial.equipment.gear : dynamicContent.equipment.gear,
    };
  }
  if (Array.isArray(partial.bestiary)) dynamicContent.bestiary = partial.bestiary;
}

export function getMightyBladeContent(): MightyBladeContentBundle {
  return dynamicContent;
}

export function findRace(id: string): MBRace | undefined {
  return mbRaces.find((r) => r.id === id);
}

export function findClass(id: string): MBClass | undefined {
  return mbClasses.find((c) => c.id === id);
}

export function findCondition(id: string): MBCondition | undefined {
  return mbConditions.find((c) => c.id === id);
}
