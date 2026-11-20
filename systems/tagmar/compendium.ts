/**
 * Mesa VTT — Tagmar 3.0 + Expansions Compendium Loader & Typed Views.
 * Statically bundles all 8 verified JSON datasets from `data/tagmar/`:
 * - `rules.json`, `races.json` (15), `professions.json` (42), `conditions.json` (24),
 *   `skills.json` (66 skills + 37 combat techniques), `spells.json` (187),
 *   `equipment.json` (52 weapons, 28 armor/shields/helmets, 68 gear/relics),
 *   `bestiary.json` (48 creatures from Livro das Criaturas).
 *
 * Content Attribution: Projeto Tagmar (https://www.tagmar.com.br) — CC BY-NC-SA 3.0 BR.
 */

import rulesJson from "../../data/tagmar/rules.json";
import racesJson from "../../data/tagmar/races.json";
import professionsJson from "../../data/tagmar/professions.json";
import conditionsJson from "../../data/tagmar/conditions.json";
import skillsJson from "../../data/tagmar/skills.json";
import spellsJson from "../../data/tagmar/spells.json";
import equipmentJson from "../../data/tagmar/equipment.json";
import bestiaryJson from "../../data/tagmar/bestiary.json";
import type { TagmarAttributes, TagmarColorDamage } from "../types";

export interface TagmarRace {
  id: string;
  name: string;
  source: string;
  officialStatus: "core" | "official-expansion" | "optional-expansion" | string;
  description: string;
  attributeAdjustments: TagmarAttributes;
  tagmar3PercepcaoAdjustment?: number;
  extraAttributePoints: number;
  baseEF: number;
  classicBaseEF?: number;
  baseVB: number;
  specialMovement?: {
    swimVB?: number;
    flyVB?: number;
    flySprintMultiplier?: number;
    notes?: string;
  } | null;
  size: string;
  allowedProfessions: string[];
  nativeLiteracy: boolean;
  racialAbilities: Array<{
    id: string;
    name: string;
    description: string;
    automationEffect?: Record<string, unknown>;
  }>;
  heightWeight: {
    averageHeightMeters: number;
    heightRange: string;
    averageWeightKg: number;
    weightRange: string;
  };
  lifespan: {
    maturityYears: number;
    averageLifespanYears: number;
    notes?: string;
  };
  languages: string[];
  portrait: string;
  suggestedPortrait: string;
}

export interface TagmarProfession {
  id: string;
  name: string;
  source: string;
  isSpecialization: boolean;
  baseProfessionId: string | null;
  minStage: number;
  organizationType: string;
  deity?: string;
  domains?: string[];
  role: string;
  baseEH: number;
  ehTable: Record<string, number>;
  ehPerStage: string;
  isMystic: boolean;
  spellcastingAttribute: keyof TagmarAttributes | null;
  karmaRule: string;
  startingPoints: {
    skills: number;
    combatWeapons: number;
    combatTechniques: number;
    magic: number;
    magicFormula: string;
  };
  skillCosts: {
    penalizedGroups: string[];
    penalizedExtraCost: number;
    specializedSkills: string[];
    notes?: string;
  };
  startingEquipment: string[];
  startingCurrency?: {
    amount: number;
    unit: "MO" | "MP" | "MC" | string;
    altOption?: string;
  };
  startingSkills: string[];
  startingCombatTechniques: string[];
  startingSpells: string[];
  description: string;
  suggestedPortrait: string;
}

export interface TagmarCondition {
  id: string;
  name: string;
  category: "debuff" | "control" | "injury" | "buff" | string;
  source: string;
  icon: string;
  emoji?: string;
  color?: string;
  description: string;
  durationType: string;
  defaultTurns?: number | null;
  saveRule?: {
    resistanceType: "rf" | "rm";
    attackForce: number;
    timing: string;
  } | null;
  modifiers: {
    columnShift: number;
    daDelta: number;
    dpDelta: number;
    rfDelta: number;
    rmDelta: number;
    vbMultiplier: number;
    skipTurn: boolean;
    efDot: number;
    ehDot: number;
    usesPassiveDefense?: boolean;
    autoCritAgainst?: boolean;
    bypassesEh?: boolean;
    attackColumnMultiplier?: number;
    cannotCastSpells?: boolean;
    requiresMoveToStand?: boolean;
    [key: string]: unknown;
  };
}

export interface TagmarSkill {
  id: string;
  name: string;
  group: string;
  attribute: keyof TagmarAttributes;
  restricted: boolean;
  source: string;
  description: string;
  specializations?: string[];
}

export interface TagmarCombatTechnique {
  id: string;
  name: string;
  category: "melee" | "ranged" | "defense" | "maneuver" | string;
  attribute: keyof TagmarAttributes;
  source: string;
  description: string;
  automation?: Record<string, unknown>;
}

export interface TagmarSpell {
  id: string;
  name: string;
  professionIds: string[];
  group: string;
  source: string;
  karmaCost: number;
  evocationTime: string;
  range: string;
  duration: string;
  resistance: "none" | "rf" | "rm" | string;
  effectLevels: Array<{ level: number; summary: string }>;
  description: string;
  automation?: {
    damageByColor?: TagmarColorDamage;
    healByColor?: TagmarColorDamage;
    damageType?: string;
    appliesCondition?: string;
    defenseBonus?: number;
    targetType?: string;
    [key: string]: unknown;
  };
}

export interface TagmarWeapon {
  id: string;
  name: string;
  damage: TagmarColorDamage;
  damageType: string;
  hands: number;
  minFor: number;
  columnBonus: number;
  range: string;
  category: string;
  price: number;
  priceDisplay?: string;
  weight: number;
  properties?: string[];
  source: string;
  description: string;
}

export interface TagmarArmor {
  id: string;
  name: string;
  slot: "armor" | "shield" | "helmet" | string;
  armorClass: "L" | "M" | "P" | string;
  absorcao: number;
  defPassiveBonus: number;
  defActiveBonus: number;
  agilityPenalty: number;
  minFor: number;
  price: number;
  priceDisplay?: string;
  weight: number;
  source: string;
  description: string;
}

export interface TagmarGear {
  id: string;
  name: string;
  category: string;
  rarity?: string;
  price: number;
  priceDisplay?: string;
  weight: number;
  source: string;
  description: string;
  effect?: {
    healEf?: number;
    healEh?: number;
    restoreKarma?: number;
    skillBonus?: Record<string, number>;
    [key: string]: unknown;
  };
}

export interface TagmarEquipmentCatalog {
  system: string;
  edition: string;
  currency: string;
  currencyRates?: Record<string, number>;
  weapons: TagmarWeapon[];
  armor: TagmarArmor[];
  gear: TagmarGear[];
}

export interface TagmarCreature {
  id: string;
  name: string;
  category: string;
  stage: number;
  source: string;
  description: string;
  portrait: string;
  attributes: TagmarAttributes;
  efMax: number;
  ehMax: number;
  karmaMax: number;
  armorClass?: string;
  defesaAtiva: number;
  defesaPassiva: number;
  absorcao: number;
  rf: number;
  rm: number;
  vb: number;
  xpReward: number;
  attacks: Array<{
    name: string;
    column: number;
    damage: TagmarColorDamage;
    damageType: string;
    range?: string;
    notes?: string;
  }>;
  abilities: Array<{
    name: string;
    karmaCost?: number;
    description: string;
  }>;
  loot?: string | string[];
}

export interface TagmarContentBundle {
  rules: typeof rulesJson;
  races: TagmarRace[];
  professions: TagmarProfession[];
  conditions: TagmarCondition[];
  skills: TagmarSkill[];
  combatTechniques: TagmarCombatTechnique[];
  spells: TagmarSpell[];
  equipment: TagmarEquipmentCatalog;
  bestiary: TagmarCreature[];
}

const rawSkillsBundle = skillsJson as unknown as {
  skills: TagmarSkill[];
  combatTechniques: TagmarCombatTechnique[];
};

export const tagmarRules = rulesJson;
export const tagmarRaces = racesJson as unknown as TagmarRace[];
export const tagmarProfessions = professionsJson as unknown as TagmarProfession[];
export const tagmarCoreProfessions = tagmarProfessions.filter((p) => !p.isSpecialization);
export const tagmarSpecializations = tagmarProfessions.filter((p) => p.isSpecialization);
export const tagmarConditions = conditionsJson as unknown as TagmarCondition[];
export const tagmarSkills = rawSkillsBundle.skills ?? [];
export const tagmarCombatTechniques = rawSkillsBundle.combatTechniques ?? [];
export const tagmarSpells = spellsJson as unknown as TagmarSpell[];
export const tagmarEquipment = equipmentJson as unknown as TagmarEquipmentCatalog;
export const tagmarBestiary = bestiaryJson as unknown as TagmarCreature[];

const dynamicContent: TagmarContentBundle = {
  rules: tagmarRules,
  races: tagmarRaces,
  professions: tagmarProfessions,
  conditions: tagmarConditions,
  skills: tagmarSkills,
  combatTechniques: tagmarCombatTechniques,
  spells: tagmarSpells,
  equipment: {
    system: tagmarEquipment.system ?? "tagmar",
    edition: tagmarEquipment.edition ?? "3.0",
    currency: tagmarEquipment.currency ?? "MP",
    currencyRates: tagmarEquipment.currencyRates,
    weapons: tagmarEquipment.weapons ?? [],
    armor: tagmarEquipment.armor ?? [],
    gear: tagmarEquipment.gear ?? [],
  },
  bestiary: tagmarBestiary,
};

/** Optional runtime hydration from `/api/v1/compendium/tagmar-3`. */
export function hydrateTagmarCompendium(partial: Partial<TagmarContentBundle>): void {
  if (Array.isArray(partial.races)) dynamicContent.races = partial.races;
  if (Array.isArray(partial.professions)) dynamicContent.professions = partial.professions;
  if (Array.isArray(partial.conditions)) dynamicContent.conditions = partial.conditions;
  if (Array.isArray(partial.skills)) dynamicContent.skills = partial.skills;
  if (Array.isArray(partial.combatTechniques)) dynamicContent.combatTechniques = partial.combatTechniques;
  if (Array.isArray(partial.spells)) dynamicContent.spells = partial.spells;
  if (partial.equipment) {
    dynamicContent.equipment = {
      ...dynamicContent.equipment,
      weapons: Array.isArray(partial.equipment.weapons)
        ? partial.equipment.weapons
        : dynamicContent.equipment.weapons,
      armor: Array.isArray(partial.equipment.armor)
        ? partial.equipment.armor
        : dynamicContent.equipment.armor,
      gear: Array.isArray(partial.equipment.gear)
        ? partial.equipment.gear
        : dynamicContent.equipment.gear,
    };
  }
  if (Array.isArray(partial.bestiary)) dynamicContent.bestiary = partial.bestiary;
}

export function getTagmarContent(): TagmarContentBundle {
  return dynamicContent;
}

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function findTagmarRace(idOrName: string): TagmarRace | undefined {
  const n = norm(idOrName);
  return dynamicContent.races.find((r) => r.id === idOrName || norm(r.name) === n);
}

export function findTagmarProfession(idOrName: string): TagmarProfession | undefined {
  const n = norm(idOrName);
  return dynamicContent.professions.find((p) => p.id === idOrName || norm(p.name) === n);
}

export function getSpecializationsForProfession(baseProfessionId: string): TagmarProfession[] {
  return dynamicContent.professions.filter(
    (p) => p.isSpecialization && p.baseProfessionId === baseProfessionId
  );
}

const TAGMAR_CONDITION_ALIASES: Record<string, string> = {
  queimando: "em-chamas",
  incendiado: "em-chamas",
  pegando_fogo: "em-chamas",
  dominado: "encantado",
  enfeiticado: "encantado",
  fascinado: "encantado",
  petrificado: "paralisado",
  desorientado: "atordoado",
};

export function findTagmarCondition(idOrName: string): TagmarCondition | undefined {
  const n = norm(idOrName);
  const aliased = TAGMAR_CONDITION_ALIASES[n] ?? idOrName;
  const na = norm(aliased);
  return dynamicContent.conditions.find(
    (c) => c.id === idOrName || c.id === aliased || norm(c.name) === n || norm(c.name) === na
  );
}

export function findTagmarSkill(idOrName: string): TagmarSkill | undefined {
  const n = norm(idOrName);
  return dynamicContent.skills.find((s) => s.id === idOrName || norm(s.name) === n);
}

export function findTagmarCombatTechnique(idOrName: string): TagmarCombatTechnique | undefined {
  const n = norm(idOrName);
  return dynamicContent.combatTechniques.find((t) => t.id === idOrName || norm(t.name) === n);
}

export function findTagmarSpell(idOrName: string): TagmarSpell | undefined {
  const n = norm(idOrName);
  return dynamicContent.spells.find((s) => s.id === idOrName || norm(s.name) === n);
}

export function getSpellsByProfession(professionId: string, groupQuery?: string): TagmarSpell[] {
  const gq = groupQuery ? norm(groupQuery) : "";
  return dynamicContent.spells.filter((sp) => {
    const matchesProf =
      !professionId || professionId === "all" || sp.professionIds.includes(professionId);
    if (!matchesProf) return false;
    if (!gq) return true;
    return norm(sp.group).includes(gq) || norm(sp.name).includes(gq);
  });
}

export function findTagmarWeapon(idOrName: string): TagmarWeapon | undefined {
  const n = norm(idOrName);
  return dynamicContent.equipment.weapons.find((w) => w.id === idOrName || norm(w.name) === n);
}

export function findTagmarArmor(idOrName: string): TagmarArmor | undefined {
  const n = norm(idOrName);
  return dynamicContent.equipment.armor.find((a) => a.id === idOrName || norm(a.name) === n);
}

export function findTagmarGear(idOrName: string): TagmarGear | undefined {
  const n = norm(idOrName);
  return dynamicContent.equipment.gear.find((g) => g.id === idOrName || norm(g.name) === n);
}

export function findTagmarCreature(idOrName: string): TagmarCreature | undefined {
  const n = norm(idOrName);
  return dynamicContent.bestiary.find((c) => c.id === idOrName || norm(c.name) === n);
}

export interface TagmarSearchResults {
  races: TagmarRace[];
  professions: TagmarProfession[];
  skills: TagmarSkill[];
  combatTechniques: TagmarCombatTechnique[];
  spells: TagmarSpell[];
  weapons: TagmarWeapon[];
  armor: TagmarArmor[];
  gear: TagmarGear[];
  conditions: TagmarCondition[];
  bestiary: TagmarCreature[];
}

export function searchTagmarCompendium(query: string): TagmarSearchResults {
  const q = norm(query);
  const match = (fields: Array<string | undefined>) =>
    !q || fields.some((f) => (f ? norm(f).includes(q) : false));

  return {
    races: dynamicContent.races.filter((r) => match([r.name, r.source, r.description])),
    professions: dynamicContent.professions.filter((p) =>
      match([p.name, p.role, p.organizationType, p.deity, p.source, p.description])
    ),
    skills: dynamicContent.skills.filter((s) => match([s.name, s.group, s.source, s.description])),
    combatTechniques: dynamicContent.combatTechniques.filter((t) =>
      match([t.name, t.category, t.source, t.description])
    ),
    spells: dynamicContent.spells.filter((s) =>
      match([s.name, s.group, s.source, s.description, ...s.professionIds])
    ),
    weapons: dynamicContent.equipment.weapons.filter((w) =>
      match([w.name, w.category, w.damageType, w.source, w.description])
    ),
    armor: dynamicContent.equipment.armor.filter((a) =>
      match([a.name, a.slot, a.armorClass, a.source, a.description])
    ),
    gear: dynamicContent.equipment.gear.filter((g) =>
      match([g.name, g.category, g.rarity, g.source, g.description])
    ),
    conditions: dynamicContent.conditions.filter((c) => match([c.name, c.category, c.description])),
    bestiary: dynamicContent.bestiary.filter((b) =>
      match([b.name, b.category, b.source, b.description])
    ),
  };
}
