/**
 * Mesa VTT — Tagmar 3.0 Full Automation Engine (`tagmar-3`).
 * Implements official Projeto Tagmar 3.0 + Expansions mechanics:
 * - 6 Core Attributes (INT, AUR, CAR, FOR, FIS, AGI), 15-pt progressive buy (16 Humanos)
 * - Official 1d20 Tabela de Resolução (-7..20 + >20 overflow rule)
 * - Official 1d20 Tabela de Resistências (RF = Estágio + FIS, RM = Estágio + AUR)
 * - Authentic Damage Pipeline: EH absorbs first → Absorção (ef.temp) → EF;
 *   Golpe Crítico (Azul) bypasses EH & normal Absorção straight to EF!
 * - Unconscious at EF <= 0, Agonizando at EF < 0, Morto at EF <= -15
 * - Karma = (AUR + 1) × (Estágio + 1) for mystics with AUR >= 1
 * - Stage progression (Estágios 1–20, 1d10 EH evolution, Stage 5 Specialization unlock)
 * - 48 Livro das Criaturas bestiary templates ready to drop on the tactical map
 */

import manifestJson from "./manifest.json";
import schemaJson from "./schema.json";
import {
  findTagmarArmor,
  findTagmarCombatTechnique,
  findTagmarCondition,
  findTagmarCreature,
  findTagmarGear,
  findTagmarProfession,
  findTagmarRace,
  findTagmarSkill,
  findTagmarSpell,
  findTagmarWeapon,
  getTagmarContent,
  tagmarBestiary,
  tagmarCombatTechniques,
  tagmarConditions,
  tagmarCoreProfessions,
  tagmarEquipment,
  tagmarProfessions,
  tagmarRaces,
  tagmarRules,
  tagmarSkills,
  tagmarSpecializations,
  tagmarSpells,
  type TagmarProfession,
  type TagmarRace,
} from "./compendium";
import {
  TAGMAR_COLOR_META,
  computeWeaponDamage,
  getResistanceTarget,
  resolveTagmarResistance,
  resolveTagmarRoll,
} from "./resolutionTable";
import { interpolateFormula } from "../sandbox";
import type {
  ActiveCondition,
  Character,
  CompendiumCategory,
  DamageOptions,
  InteractiveAction,
  RollEvaluation,
  RollPlan,
  RollRequest,
  RollResult,
  RpgSystemEngine,
  SystemManifest,
  SystemSchema,
  TagmarAttributes,
  TagmarColorDamage,
  TagmarCombatEntry,
  TagmarEquipmentEntry,
  TagmarMoney,
  TagmarResolutionColor,
  TagmarSkillEntry,
  TagmarSpellEntry,
  TagmarSystemData,
  TagmarWizardInput,
} from "../types";

const ATTR_KEYS: Array<keyof TagmarAttributes> = [
  "intelecto",
  "aura",
  "carisma",
  "forca",
  "fisico",
  "agilidade",
];

const ATTR_LABELS: Record<keyof TagmarAttributes, string> = {
  intelecto: "Intelecto",
  aura: "Aura",
  carisma: "Carisma",
  forca: "Força",
  fisico: "Físico",
  agilidade: "Agilidade",
};

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatMod(value: number): string {
  if (value === 0) return "";
  return value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Calculates the official Tagmar 3.0 progressive attribute point-buy cost
 * to move a single attribute from `base` (racial base) to `target`.
 * - Raising a negative value costs 1 pt per step.
 * - Raising a positive value from (k-1) to k costs k pts (0->1=1, 1->2=2, 2->3=3, 3->4=4).
 * - Lowering below `base` (up to -2) refunds 0.5 pt per step.
 */
export function computeSingleAttributeCost(base: number, target: number): number {
  let cost = 0;
  if (target > base) {
    for (let v = base + 1; v <= target; v++) {
      cost += v <= 0 ? 1 : v;
    }
  } else if (target < base) {
    cost -= (base - target) * 0.5;
  }
  return cost;
}

/** Computes total Tagmar 3.0 point-buy cost for a full 6-attribute spread against a race. */
export function computePointBuyCost(
  race: TagmarRace,
  finalAttrs: TagmarAttributes
): { spent: number; budget: number; remaining: number; valid: boolean; errors: string[] } {
  const budget =
    tagmarRules.characterCreation.attributePointPool + (race.extraAttributePoints ?? 0);
  const errors: string[] = [];
  let spent = 0;

  for (const key of ATTR_KEYS) {
    const base = race.attributeAdjustments[key] ?? 0;
    const val = finalAttrs[key] ?? base;
    if (val > base + 4) {
      errors.push(`${ATTR_LABELS[key]} excede o limite de criação (${base + 4}).`);
    }
    if (val < base - 2) {
      errors.push(`${ATTR_LABELS[key]} está abaixo do mínimo permitido (${base - 2}).`);
    }
    if (val < -4 || val > 6) {
      errors.push(`${ATTR_LABELS[key]} fora da escala de Tagmar (-4 a +6).`);
    }
    spent += computeSingleAttributeCost(base, val);
  }

  const remaining = Number((budget - spent).toFixed(2));
  if (spent > budget) {
    errors.push(`Pontos gastos (${spent}) excedem o orçamento da raça (${budget}).`);
  }

  return { spent, budget, remaining, valid: errors.length === 0, errors };
}

export function validateTagmarPointBuy(
  raceId: string,
  finalAttrs: TagmarAttributes
): { spent: number; budget: number; remaining: number; valid: boolean; errors: string[] } {
  const race = findTagmarRace(raceId) ?? tagmarRaces[0];
  return computePointBuyCost(race, finalAttrs);
}

/** Reads and normalizes `character.systemData` into a safe `TagmarSystemData` object. */
export function readTagmarData(character: Character): TagmarSystemData {
  const raw = (character.systemData ?? {}) as Partial<TagmarSystemData>;
  const rawAttrs = (raw.attributes ?? {}) as Partial<TagmarAttributes>;
  const raceId = raw.raceId ?? "humano";
  const professionId = raw.professionId ?? "guerreiro";
  const race = findTagmarRace(raceId);
  const prof = findTagmarProfession(professionId);
  const spec = raw.specializationId ? findTagmarProfession(raw.specializationId) : undefined;
  const rawMoney = (raw.money ?? {}) as Partial<TagmarMoney>;

  return {
    raceId,
    raceName: raw.raceName ?? race?.name ?? "Humano",
    professionId,
    professionName: raw.professionName ?? prof?.name ?? "Guerreiro",
    specializationId: raw.specializationId ?? null,
    specializationName: raw.specializationName ?? spec?.name ?? null,
    stage: clamp(Number(raw.stage ?? 1), 1, 20),
    xp: Math.max(0, Number(raw.xp ?? 0)),
    attributes: {
      intelecto: Number(rawAttrs.intelecto ?? 0),
      aura: Number(rawAttrs.aura ?? 0),
      carisma: Number(rawAttrs.carisma ?? 0),
      forca: Number(rawAttrs.forca ?? 0),
      fisico: Number(rawAttrs.fisico ?? 0),
      agilidade: Number(rawAttrs.agilidade ?? 0),
    },
    ehBonus: Number(raw.ehBonus ?? 0),
    efBonus: Number(raw.efBonus ?? 0),
    karmaBonus: Number(raw.karmaBonus ?? 0),
    ehGainedFromStages: Number(raw.ehGainedFromStages ?? 0),
    baseEfOverride: typeof raw.baseEfOverride === "number" ? raw.baseEfOverride : undefined,
    baseEhOverride: typeof raw.baseEhOverride === "number" ? raw.baseEhOverride : undefined,
    baseVbOverride: typeof raw.baseVbOverride === "number" ? raw.baseVbOverride : undefined,
    naturalAbsorption: typeof raw.naturalAbsorption === "number" ? raw.naturalAbsorption : undefined,
    naturalDefenseActive:
      typeof raw.naturalDefenseActive === "number" ? raw.naturalDefenseActive : undefined,
    naturalDefensePassive:
      typeof raw.naturalDefensePassive === "number" ? raw.naturalDefensePassive : undefined,
    rfBonus: typeof raw.rfBonus === "number" ? raw.rfBonus : undefined,
    rmBonus: typeof raw.rmBonus === "number" ? raw.rmBonus : undefined,
    armorClassOverride:
      raw.armorClassOverride === "L" || raw.armorClassOverride === "M" || raw.armorClassOverride === "P"
        ? raw.armorClassOverride
        : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    combatTechniques: Array.isArray(raw.combatTechniques) ? raw.combatTechniques : [],
    spells: Array.isArray(raw.spells) ? raw.spells : [],
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    money: {
      mo: Math.max(0, Number(rawMoney.mo ?? 0)),
      mp: Math.max(0, Number(rawMoney.mp ?? 0)),
      mc: Math.max(0, Number(rawMoney.mc ?? 0)),
    },
    languages: Array.isArray(raw.languages) ? raw.languages : race?.languages ?? ["Malês"],
    notes: raw.notes ?? "",
    biography: raw.biography ?? "",
  };
}

function lookupEhGainFromTable(profession: TagmarProfession, roll1d10: number): number {
  const r = clamp(Math.round(roll1d10), 1, 10);
  const table = profession.ehTable ?? { "1-2": 4, "3-5": 5, "6-8": 6, "9-10": 7 };
  if (r <= 2) return table["1-2"] ?? 4;
  if (r <= 5) return table["3-5"] ?? 5;
  if (r <= 8) return table["6-8"] ?? 6;
  return table["9-10"] ?? 7;
}

function defaultStarterWeaponForProfession(professionId: string): string {
  switch (professionId) {
    case "guerreiro":
      return "espada-longa";
    case "ladino":
      return "espada-curta";
    case "sacerdote":
      return "maca-estrela";
    case "mago":
      return "bordao";
    case "rastreador":
      return "arco-longo";
    case "bardo":
      return "florete";
    default:
      return "espada-curta";
  }
}

function resolveStarterInventory(
  profession: TagmarProfession,
  selectedWeaponId?: string,
  selectedArmorId?: string
): TagmarEquipmentEntry[] {
  const content = getTagmarContent();
  const items: TagmarEquipmentEntry[] = [];
  let idx = 1;
  let hasWeapon = false;
  let hasArmor = false;

  const pushWeapon = (weaponId: string) => {
    const w = findTagmarWeapon(weaponId);
    if (!w) return;
    hasWeapon = true;
    items.push({
      id: `tg-eq-${idx++}`,
      itemId: w.id,
      name: w.name,
      category: "weapon",
      equipped: true,
      quantity: 1,
      damage: { ...w.damage },
      damageType: w.damageType,
      hands: w.hands,
      minFor: w.minFor,
      columnBonus: w.columnBonus,
      range: w.range,
      weaponGroup: w.category,
      price: w.price,
      weight: w.weight,
      properties: w.properties,
      description: w.description,
    });
  };

  const pushArmor = (armorId: string) => {
    const a = findTagmarArmor(armorId);
    if (!a) return;
    const cat =
      a.slot === "shield" ? "shield" : a.slot === "helmet" ? "helmet" : ("armor" as const);
    if (cat === "armor") hasArmor = true;
    items.push({
      id: `tg-eq-${idx++}`,
      itemId: a.id,
      name: a.name,
      category: cat,
      slot: a.slot,
      equipped: true,
      quantity: 1,
      armorClass: a.armorClass,
      absorcao: a.absorcao,
      defPassiveBonus: a.defPassiveBonus,
      defActiveBonus: a.defActiveBonus,
      agilityPenalty: a.agilityPenalty,
      minFor: a.minFor,
      price: a.price,
      weight: a.weight,
      description: a.description,
    });
  };

  if (selectedWeaponId) pushWeapon(selectedWeaponId);
  if (selectedArmorId) pushArmor(selectedArmorId);

  const armorsByLen = [...content.equipment.armor].sort((a, b) => b.name.length - a.name.length);
  const weaponsByLen = [...content.equipment.weapons].sort((a, b) => b.name.length - a.name.length);
  const gearByLen = [...content.equipment.gear].sort((a, b) => b.name.length - a.name.length);

  for (const label of profession.startingEquipment ?? []) {
    const n = norm(label);
    if (n.includes("arma a escolha") || n.includes("arma leve") || n.includes("arma permitida")) {
      if (!hasWeapon) {
        pushWeapon(defaultStarterWeaponForProfession(profession.baseProfessionId ?? profession.id));
      }
      continue;
    }

    if (n.includes("escudo pequeno")) {
      pushArmor("rodela-de-madeira");
      continue;
    }
    if (n.includes("escudo grande")) {
      pushArmor("paves-grande");
      continue;
    }
    if (n.includes("elmo aberto")) {
      pushArmor("elmo-aberto");
      continue;
    }
    if (n.includes("couro rigido")) {
      if (!hasArmor) pushArmor("couro-rigido");
      continue;
    }
    if (n.includes("couro leve")) {
      if (!hasArmor) pushArmor("couro-leve");
      continue;
    }

    const matchedArmor = armorsByLen.find((a) => n.includes(norm(a.name)));
    if (matchedArmor) {
      if (matchedArmor.slot !== "armor" || !hasArmor) {
        pushArmor(matchedArmor.id);
      }
      continue;
    }

    const matchedWeapon = weaponsByLen.find((w) => n.includes(norm(w.name)));
    if (matchedWeapon) {
      pushWeapon(matchedWeapon.id);
      continue;
    }

    const matchedGear = gearByLen.find((g) => n.includes(norm(g.name)));
    if (matchedGear) {
      items.push({
        id: `tg-eq-${idx++}`,
        itemId: matchedGear.id,
        name: matchedGear.name,
        category: matchedGear.effect ? "consumable" : "gear",
        equipped: false,
        quantity: 1,
        price: matchedGear.price,
        weight: matchedGear.weight,
        effect: matchedGear.effect,
        description: matchedGear.description,
      });
      continue;
    }

    items.push({
      id: `tg-eq-${idx++}`,
      name: label,
      category: "gear",
      equipped: false,
      quantity: 1,
      weight: 1,
    });
  }

  if (!hasWeapon) {
    pushWeapon(defaultStarterWeaponForProfession(profession.baseProfessionId ?? profession.id));
  }

  return items;
}

function findMatchingTechniqueLevel(
  weapon: TagmarEquipmentEntry,
  techniques: TagmarCombatEntry[]
): { level: number; attribute: keyof TagmarAttributes; techniqueName?: string } {
  const wg = norm(weapon.weaponGroup ?? weapon.name);
  const isRanged =
    Boolean(weapon.range && !norm(weapon.range).startsWith("corpo")) ||
    wg.includes("arco") ||
    wg.includes("besta") ||
    wg.includes("arremesso") ||
    wg.includes("funda");

  for (const tech of techniques) {
    const autoGroups = Array.isArray(tech.automation?.weaponGroups)
      ? (tech.automation?.weaponGroups as string[]).map(norm)
      : [];
    if (autoGroups.some((g) => wg.includes(g) || g.includes(wg))) {
      return {
        level: tech.level + (tech.bonus ?? 0),
        attribute: tech.attribute ?? (isRanged ? "agilidade" : "agilidade"),
        techniqueName: tech.name,
      };
    }
    const tn = norm(tech.name);
    if (
      (wg.includes("espada") && tn.includes("espada")) ||
      (wg.includes("machado") && tn.includes("machado")) ||
      (wg.includes("lanca") && tn.includes("lanca")) ||
      (wg.includes("arco") && tn.includes("arco")) ||
      (wg.includes("besta") && tn.includes("besta")) ||
      (wg.includes("corte") && tn.includes("corte")) ||
      (wg.includes("perfuracao") && tn.includes("perfuracao")) ||
      (wg.includes("contusao") && tn.includes("contusao"))
    ) {
      return {
        level: tech.level + (tech.bonus ?? 0),
        attribute: tech.attribute ?? "agilidade",
        techniqueName: tech.name,
      };
    }
  }

  // Fallback to highest compatible melee/ranged technique
  const fallback = techniques.find((t) => t.category === (isRanged ? "ranged" : "melee"));
  if (fallback) {
    return {
      level: fallback.level + (fallback.bonus ?? 0),
      attribute: fallback.attribute ?? "agilidade",
      techniqueName: fallback.name,
    };
  }

  return { level: 0, attribute: isRanged ? "agilidade" : "forca" };
}

function readRacialAutomationNumber(race: TagmarRace | undefined, key: string): number {
  if (!race) return 0;
  let sum = 0;
  for (const ab of race.racialAbilities ?? []) {
    const val = ab.automationEffect?.[key];
    if (typeof val === "number") sum += val;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Tagmar 3.0 Specific Roll Builders & State Mutators (exported for UI & Tests)
// ---------------------------------------------------------------------------

export function buildAttributeRoll(
  character: Character,
  attrKey: string,
  opts?: { bonus?: number; difficulty?: number; label?: string; columnOverride?: number }
): RollPlan {
  const data = readTagmarData(character);
  const { computed } = tagmar3Engine.computeDerivedStats(character);
  const key = (attrKey in data.attributes ? attrKey : "forca") as keyof TagmarAttributes;
  const conditionShift = Number(computed.conditionColumnShift ?? 0);
  const column =
    typeof opts?.columnOverride === "number"
      ? Math.trunc(opts.columnOverride)
      : data.attributes[key] + (opts?.bonus ?? 0) + conditionShift;

  return {
    formula: "1d20",
    label: opts?.label ?? `Teste de ${ATTR_LABELS[key]} (Col. ${column})`,
    difficulty: opts?.difficulty,
    tagmarColumn: column,
    systemMeta: {
      systemId: "tagmar-3",
      kind: "attribute",
      attrKey: key,
      tagmarColumn: column,
      difficulty: opts?.difficulty,
    },
  };
}

export function buildSkillRoll(
  character: Character,
  skillId: string,
  opts?: { bonus?: number; difficulty?: number; label?: string }
): RollPlan {
  const data = readTagmarData(character);
  const { computed } = tagmar3Engine.computeDerivedStats(character);
  const conditionShift = Number(computed.conditionColumnShift ?? 0);

  const owned = data.skills.find(
    (s) => s.id === skillId || s.skillId === skillId || norm(s.name) === norm(skillId)
  );
  const compSkill = findTagmarSkill(skillId);
  const ownedTech = !owned
    ? data.combatTechniques.find(
        (t) => t.id === skillId || t.techniqueId === skillId || norm(t.name) === norm(skillId)
      )
    : undefined;

  if (owned) {
    const attrVal = data.attributes[owned.attribute] ?? 0;
    const specBonus = owned.specialized ? 2 : 0;
    const column = attrVal + owned.level + (owned.bonus ?? 0) + specBonus + (opts?.bonus ?? 0) + conditionShift;
    return {
      formula: "1d20",
      label: opts?.label ?? `Habilidade · ${owned.name} (Col. ${column})`,
      difficulty: opts?.difficulty,
      tagmarColumn: column,
      systemMeta: {
        systemId: "tagmar-3",
        kind: "skill",
        skillId: owned.id,
        skillName: owned.name,
        tagmarColumn: column,
        difficulty: opts?.difficulty,
      },
    };
  }

  if (ownedTech) {
    const attrKey = ownedTech.attribute ?? "agilidade";
    const attrVal = data.attributes[attrKey] ?? 0;
    const column = attrVal + ownedTech.level + (ownedTech.bonus ?? 0) + (opts?.bonus ?? 0) + conditionShift;
    return {
      formula: "1d20",
      label: opts?.label ?? `Técnica · ${ownedTech.name} (Col. ${column})`,
      difficulty: opts?.difficulty,
      tagmarColumn: column,
      systemMeta: {
        systemId: "tagmar-3",
        kind: "skill",
        skillId: ownedTech.id,
        skillName: ownedTech.name,
        tagmarColumn: column,
        difficulty: opts?.difficulty,
      },
    };
  }

  if (compSkill) {
    // Untrained skill check: Tagmar 3.0 applies -7 if restricted, else attribute alone
    const attrVal = data.attributes[compSkill.attribute] ?? 0;
    const untrainedPen = compSkill.restricted ? -7 : 0;
    const column = attrVal + untrainedPen + (opts?.bonus ?? 0) + conditionShift;
    return {
      formula: "1d20",
      label:
        opts?.label ??
        `Habilidade · ${compSkill.name}${compSkill.restricted ? " (Sem Treino)" : ""} (Col. ${column})`,
      difficulty: opts?.difficulty,
      tagmarColumn: column,
      systemMeta: {
        systemId: "tagmar-3",
        kind: "skill",
        skillId: compSkill.id,
        skillName: compSkill.name,
        untrained: true,
        tagmarColumn: column,
      },
    };
  }

  const fallbackCol = (opts?.bonus ?? 0) + conditionShift;
  return {
    formula: "1d20",
    label: opts?.label ?? `Teste na Tabela (Col. ${fallbackCol})`,
    difficulty: opts?.difficulty,
    tagmarColumn: fallbackCol,
    systemMeta: {
      systemId: "tagmar-3",
      kind: "skill",
      tagmarColumn: fallbackCol,
    },
  };
}

export function buildWeaponAttackRoll(
  character: Character,
  weaponId: string,
  target?: Character,
  bonus = 0
): RollPlan {
  const data = readTagmarData(character);
  const { computed } = tagmar3Engine.computeDerivedStats(character);
  const equippedWeapons =
    (computed.equippedWeapons as Array<{
      id: string;
      name: string;
      column: number;
      damage: TagmarColorDamage;
      damageType: string;
      range: string;
      underMinFor: boolean;
    }>) ?? [];

  const isExplicitUnarmed =
    weaponId === "__unarmed__" || norm(weaponId) === "unarmed" || norm(weaponId) === "desarmado";
  const selected = isExplicitUnarmed
    ? undefined
    : equippedWeapons.find((w) => w.id === weaponId || norm(w.name) === norm(weaponId)) ??
      equippedWeapons[0];

  // Determine target effective defense (DA normal, or DP if surprised/paralyzed/unconscious)
  let targetDefense: number | undefined;
  let usedPassive = false;
  if (target) {
    const tComp = target.computed ?? {};
    const tPassive = Boolean(tComp.usesPassiveDefense);
    usedPassive = tPassive;
    if (tPassive && typeof tComp.defesaPassiva === "number") {
      targetDefense = tComp.defesaPassiva;
    } else if (typeof tComp.effectiveDefense === "number") {
      targetDefense = tComp.effectiveDefense;
    } else if (typeof tComp.defesaAtiva === "number") {
      targetDefense = tComp.defesaAtiva;
    } else if (typeof tComp.defesa === "number") {
      targetDefense = tComp.defesa;
    }
  }

  if (selected) {
    const finalCol = selected.column + bonus - (targetDefense ?? 0);
    return {
      formula: "1d20",
      label: `Ataque · ${selected.name} (Col. ${finalCol}${targetDefense !== undefined ? ` vs ${usedPassive ? "DP" : "DA"} ${targetDefense}` : ""})`,
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
      damageType: selected.damageType,
      tagmarColumn: finalCol,
      systemMeta: {
        systemId: "tagmar-3",
        kind: "attack",
        weaponId: selected.id,
        weaponName: selected.name,
        tagmarColumn: finalCol,
        weaponDamage: selected.damage,
        damageType: selected.damageType,
        underMinFor: selected.underMinFor,
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
      },
    };
  }

  // Unarmed strike fallback
  const conditionShift = Number(computed.conditionColumnShift ?? 0);
  const baseCol = data.attributes.agilidade + data.attributes.forca + bonus + conditionShift;
  const finalCol = baseCol - (targetDefense ?? 0);
  const unarmedDamage: TagmarColorDamage = { verde: 1, amarelo: 2, laranja: 3, vermelho: 4, azul: 6 };

  return {
    formula: "1d20",
    label: `Ataque Desarmado (Col. ${finalCol})`,
    targetCharacterId: target?.id,
    targetDefense,
    targetName: target?.name,
    damageType: "Contusão",
    tagmarColumn: finalCol,
    systemMeta: {
      systemId: "tagmar-3",
      kind: "attack",
      weaponName: "Ataque Desarmado",
      tagmarColumn: finalCol,
      weaponDamage: unarmedDamage,
      damageType: "Contusão",
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
    },
  };
}

export function buildSpellRoll(
  character: Character,
  spellId: string,
  target?: Character,
  bonus = 0
): RollPlan {
  const data = readTagmarData(character);
  const { computed } = tagmar3Engine.computeDerivedStats(character);
  const owned = data.spells.find(
    (s) => s.id === spellId || s.spellId === spellId || norm(s.name) === norm(spellId)
  );
  const comp = findTagmarSpell(spellId);
  const spell = owned ?? comp;

  const prof = findTagmarProfession(data.professionId);
  const castAttrKey: keyof TagmarAttributes = prof?.spellcastingAttribute ?? "aura";
  const castAttrVal = Math.max(data.attributes.aura, data.attributes[castAttrKey] ?? 0);
  const spellLevel = owned?.level ?? Math.max(1, data.stage);
  const conditionShift = Number(computed.conditionColumnShift ?? 0);
  const blocked = Boolean(computed.cannotCastSpells);
  const column = castAttrVal + spellLevel + bonus + conditionShift;

  const karmaCost = spell?.karmaCost ?? 1;
  const auto = spell?.automation ?? {};
  const resistance = spell?.resistance ?? "none";

  return {
    formula: "1d20",
    label: `Magia · ${spell?.name ?? spellId} (Col. ${column}${blocked ? " · Silenciado!" : ""})`,
    targetCharacterId: target?.id,
    targetName: target?.name,
    manaCost: karmaCost,
    karmaCost,
    damageType: auto.damageType ?? "Mágico",
    appliesCondition: auto.appliesCondition,
    tagmarColumn: column,
    systemMeta: {
      systemId: "tagmar-3",
      kind: "spell",
      spellId: spell?.id ?? spellId,
      spellName: spell?.name ?? spellId,
      tagmarColumn: column,
      karmaCost,
      resistance,
      attackForce: Math.max(1, data.stage + data.attributes.aura + spellLevel),
      damageByColor: auto.damageByColor,
      healByColor: auto.healByColor,
      damageType: auto.damageType ?? "Mágico",
      appliesCondition: auto.appliesCondition,
      cannotCastSpells: blocked,
      targetCharacterId: target?.id,
      targetName: target?.name,
    },
  };
}

export function buildResistanceRoll(
  character: Character,
  kind: "rf" | "rm",
  fa: number,
  opts?: { label?: string }
): RollPlan {
  const { computed } = tagmar3Engine.computeDerivedStats(character);
  const fd = kind === "rf" ? Number(computed.rf ?? 1) : Number(computed.rm ?? 1);
  const target = getResistanceTarget(fa, fd);
  const labelKind = kind === "rf" ? "Resistência Física (RF)" : "Resistência à Magia (RM)";

  return {
    formula: "1d20",
    label: opts?.label ?? `${labelKind} · FD ${fd} vs FA ${fa} (Alvo ${target}+)`,
    difficulty: target,
    tagmarResistance: { kind, fa, fd },
    systemMeta: {
      systemId: "tagmar-3",
      kind: "resistance",
      resistanceKind: kind,
      fa,
      fd,
      target,
    },
  };
}

export function spendKarma(
  character: Character,
  amount: number
): { patch?: Partial<Character>; error?: string } {
  const cost = Math.max(0, Math.floor(amount));
  const curKarma = character.resources?.karma ?? { current: 0, max: 0 };
  if (curKarma.current < cost) {
    return {
      error: `Karma insuficiente: possui ${curKarma.current}, necessário ${cost} Karma.`,
    };
  }
  return {
    patch: {
      resources: {
        ...character.resources,
        karma: { ...curKarma, current: curKarma.current - cost },
      },
    },
  };
}

export function advanceStage(
  character: Character,
  choices: { ehRoll?: number; specializationId?: string; xp?: number } = {}
): Partial<Character> {
  const data = readTagmarData(character);
  if (data.stage >= 20) return {};

  const nextStage = data.stage + 1;
  const prof = findTagmarProfession(data.professionId) ?? tagmarCoreProfessions[0];
  const roll =
    typeof choices.ehRoll === "number"
      ? clamp(Math.round(choices.ehRoll), 1, 10)
      : 5; // deterministic average fallback when UI doesn't supply 1d10
  const ehGain = Math.max(1, lookupEhGainFromTable(prof, roll) + data.attributes.fisico);

  let specId = data.specializationId ?? null;
  let specName = data.specializationName ?? null;
  if (nextStage >= 5 && choices.specializationId) {
    const spec = findTagmarProfession(choices.specializationId);
    if (spec && spec.isSpecialization && spec.baseProfessionId === data.professionId) {
      specId = spec.id;
      specName = spec.name;
    }
  }

  const stageRow = tagmarRules.stageProgression.stages.find((s) => s.stage === nextStage);
  const nextXp =
    typeof choices.xp === "number"
      ? Math.max(data.xp, choices.xp)
      : Math.max(data.xp, stageRow?.xpMin ?? data.xp);

  const nextData: TagmarSystemData = {
    ...data,
    stage: nextStage,
    xp: nextXp,
    specializationId: specId,
    specializationName: specName,
    ehGainedFromStages: (data.ehGainedFromStages ?? 0) + ehGain,
  };

  const titleRole = specName ? `${data.professionName} · ${specName}` : data.professionName;
  const nextChar: Character = {
    ...character,
    subtitle: `${titleRole} (${data.raceName}) · Estágio ${nextStage}`,
    systemData: nextData as unknown as Record<string, unknown>,
  };

  const { computed, resourceMax } = tagmar3Engine.computeDerivedStats(nextChar);
  const curEh = character.resources?.eh ?? { current: resourceMax.eh, max: resourceMax.eh };
  const curEf = character.resources?.ef ?? { current: resourceMax.ef, max: resourceMax.ef };
  const curKarma = character.resources?.karma ?? { current: resourceMax.karma, max: resourceMax.karma };
  const karmaDelta = Math.max(0, resourceMax.karma - curKarma.max);

  nextData.efMax = resourceMax.ef;
  nextData.ehMax = resourceMax.eh;
  nextData.karmaMax = resourceMax.karma;
  nextData.defesaAtiva = Number(computed.defesaAtiva);
  nextData.defesaPassiva = Number(computed.defesaPassiva);
  nextData.absorcao = Number(computed.absorcao);
  nextData.rf = Number(computed.rf);
  nextData.rm = Number(computed.rm);
  nextData.vb = Number(computed.vb);
  nextData.iniciativa = Number(computed.iniciativa);

  return {
    subtitle: nextChar.subtitle,
    systemData: nextData as unknown as Record<string, unknown>,
    resources: {
      ...character.resources,
      eh: { ...curEh, current: curEh.current + ehGain, max: resourceMax.eh },
      ef: { ...curEf, max: resourceMax.ef },
      karma: { ...curKarma, current: curKarma.current + karmaDelta, max: resourceMax.karma },
    },
    computed,
  };
}

export function spawnBestiaryMonster(
  creatureId: string
): Omit<Character, "id" | "campaignId" | "updatedAt"> | null {
  const creature = findTagmarCreature(creatureId);
  if (!creature) return null;

  const inventory: TagmarEquipmentEntry[] = (creature.attacks ?? []).map((atk, idx) => ({
    id: `mob-atk-${idx + 1}`,
    name: atk.name,
    category: "weapon",
    equipped: true,
    quantity: 1,
    damage: { ...atk.damage },
    damageType: atk.damageType ?? "Corte",
    columnBonus: atk.column - (creature.attributes.agilidade ?? 0),
    fixedColumn: atk.column,
    range: atk.range ?? "Corpo a Corpo",
    description: atk.notes ?? "",
  }));

  const combatTechniques: TagmarCombatEntry[] = (creature.abilities ?? []).map((ab, idx) => ({
    id: `mob-ab-${idx + 1}`,
    name: ab.name,
    category: "maneuver",
    level: creature.stage,
    description: ab.description,
    automation: ab.karmaCost ? { karmaCost: ab.karmaCost } : undefined,
  }));

  const acOverride =
    creature.armorClass === "L" || creature.armorClass === "M" || creature.armorClass === "P"
      ? creature.armorClass
      : undefined;

  const systemData: TagmarSystemData = {
    raceId: "criatura",
    raceName: creature.category,
    professionId: "bestiario",
    professionName: `Estágio ${creature.stage}`,
    specializationId: null,
    specializationName: null,
    stage: creature.stage,
    xp: creature.xpReward,
    attributes: { ...creature.attributes },
    baseEfOverride: creature.efMax - creature.attributes.forca - creature.attributes.fisico,
    baseEhOverride: creature.ehMax - creature.attributes.fisico,
    baseVbOverride: creature.vb - creature.attributes.fisico,
    naturalAbsorption: creature.absorcao,
    naturalDefenseActive: creature.defesaAtiva - creature.attributes.agilidade,
    naturalDefensePassive: creature.defesaPassiva,
    rfBonus: creature.rf - (creature.stage + creature.attributes.fisico),
    rmBonus: creature.rm - (creature.stage + creature.attributes.aura),
    armorClassOverride: acOverride,
    skills: [],
    combatTechniques,
    spells: [],
    inventory,
    money: { mo: 0, mp: 0, mc: 0 },
    notes: `${creature.description}${creature.loot ? `\n\nEspólio: ${Array.isArray(creature.loot) ? creature.loot.join(", ") : creature.loot}` : ""}`,
    biography: creature.description,
    efMax: creature.efMax,
    ehMax: creature.ehMax,
    karmaMax: creature.karmaMax,
    defesaAtiva: creature.defesaAtiva,
    defesaPassiva: creature.defesaPassiva,
    absorcao: creature.absorcao,
    rf: creature.rf,
    rm: creature.rm,
    vb: creature.vb,
    iniciativa: creature.attributes.agilidade,
  };

  return {
    systemId: "tagmar-3",
    kind: "monster",
    name: creature.name,
    subtitle: `${creature.category} · Estágio ${creature.stage}`,
    portraitUrl: creature.portrait || "./assets/monsters/goblin-raider.svg",
    ownerUserId: null,
    controlledByUserIds: [],
    visibility: "all_players",
    resources: {
      eh: { current: creature.ehMax, max: creature.ehMax },
      ef: { current: creature.efMax, max: creature.efMax, temp: creature.absorcao },
      karma: { current: creature.karmaMax, max: creature.karmaMax },
    },
    conditions: [],
    systemData: systemData as unknown as Record<string, unknown>,
    computed: {
      defesaAtiva: creature.defesaAtiva,
      defesaPassiva: creature.defesaPassiva,
      effectiveDefense: creature.defesaAtiva,
      absorcao: creature.absorcao,
      armorClass: creature.armorClass ?? "L",
      rf: creature.rf,
      rm: creature.rm,
      vb: creature.vb,
      vbQuadrados: Math.max(1, Math.floor(creature.vb / 1.5)),
      iniciativa: creature.attributes.agilidade,
      inconsciente: false,
      agonizando: false,
      morto: false,
      equippedWeapons: (creature.attacks ?? []).map((atk, idx) => ({
        id: `mob-atk-${idx + 1}`,
        name: atk.name,
        column: atk.column,
        damage: atk.damage,
        damageType: atk.damageType,
        range: atk.range ?? "Corpo a Corpo",
        underMinFor: false,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// RpgSystemEngine Implementation (`tagmar-3`)
// ---------------------------------------------------------------------------

export const tagmar3Engine: RpgSystemEngine = {
  manifest: manifestJson as SystemManifest,
  schema: schemaJson as SystemSchema,

  computeDerivedStats(character: Character) {
    const data = readTagmarData(character);
    const race = findTagmarRace(data.raceId);
    const prof = findTagmarProfession(data.professionId);
    const spec = data.specializationId ? findTagmarProfession(data.specializationId) : undefined;
    const effectiveProf = spec ?? prof;

    // 1. Aggregate active Tagmar condition modifiers
    let conditionColumnShift = 0;
    let daDelta = 0;
    let dpDelta = 0;
    let rfDelta = 0;
    let rmDelta = 0;
    let vbMultiplier = 1;
    let skipTurn = false;
    let efDot = 0;
    let ehDot = 0;
    let usesPassiveDefense = false;
    let autoCritAgainst = false;
    let bypassesEh = false;
    let cannotCastSpells = false;
    let attackColumnMultiplier = 1;

    for (const active of character.conditions ?? []) {
      const def = findTagmarCondition(active.id);
      if (!def?.modifiers) continue;
      const m = def.modifiers;
      conditionColumnShift += m.columnShift ?? 0;
      daDelta += m.daDelta ?? 0;
      dpDelta += m.dpDelta ?? 0;
      rfDelta += m.rfDelta ?? 0;
      rmDelta += m.rmDelta ?? 0;
      vbMultiplier *= m.vbMultiplier ?? 1;
      if (m.skipTurn) skipTurn = true;
      efDot += m.efDot ?? 0;
      ehDot += m.ehDot ?? 0;
      if (m.usesPassiveDefense) usesPassiveDefense = true;
      if (m.autoCritAgainst) autoCritAgainst = true;
      if (m.bypassesEh) bypassesEh = true;
      if (m.cannotCastSpells) cannotCastSpells = true;
      if (typeof m.attackColumnMultiplier === "number") {
        attackColumnMultiplier *= m.attackColumnMultiplier;
      }
    }

    // 2. Aggregate equipped armor, shield, helmet & carried weight
    let armorDefActive = 0;
    let armorDefPassive = 0;
    let shieldDefActive = 0;
    let shieldDefPassive = 0;
    let helmetDefActive = 0;
    let helmetDefPassive = 0;
    let agilityPenalty = 0;
    let equipAbsorcao = 0;
    let armorClass: "L" | "M" | "P" = "L";
    let totalWeight = 0;

    const armorClassRank: Record<string, number> = { L: 1, M: 2, P: 3 };

    for (const item of data.inventory) {
      totalWeight += (item.weight ?? 0) * Math.max(1, item.quantity ?? 1);
      if (!item.equipped) continue;

      if (item.category === "armor" || item.slot === "armor") {
        armorDefActive += item.defActiveBonus ?? 0;
        armorDefPassive += item.defPassiveBonus ?? 0;
        agilityPenalty += Math.abs(item.agilityPenalty ?? 0);
        equipAbsorcao += item.absorcao ?? 0;
        if (item.armorClass && (armorClassRank[item.armorClass] ?? 0) > armorClassRank[armorClass]) {
          armorClass = item.armorClass as "L" | "M" | "P";
        }
      } else if (item.category === "shield" || item.slot === "shield") {
        shieldDefActive += item.defActiveBonus ?? 0;
        shieldDefPassive += item.defPassiveBonus ?? 0;
        agilityPenalty += Math.abs(item.agilityPenalty ?? 0);
        equipAbsorcao += item.absorcao ?? 0;
      } else if (item.category === "helmet" || item.slot === "helmet") {
        helmetDefActive += item.defActiveBonus ?? 0;
        helmetDefPassive += item.defPassiveBonus ?? 0;
        agilityPenalty += Math.abs(item.agilityPenalty ?? 0);
        equipAbsorcao += item.absorcao ?? 0;
      }
    }

    // 3. Racial passive bonuses
    const racialRfBonus = readRacialAutomationNumber(race, "rfBonus");
    const racialRmBonus = readRacialAutomationNumber(race, "rmBonus");
    const racialNaturalAbs =
      data.naturalAbsorption ?? readRacialAutomationNumber(race, "naturalAbsorption");

    const { aura, forca, fisico, agilidade } = data.attributes;

    // 4. Core Tagmar 3.0 derived stats
    const baseEF = data.baseEfOverride ?? race?.baseEF ?? 15;
    const efMax = Math.max(1, baseEF + forca + fisico + (data.efBonus ?? 0));

    const baseEH = data.baseEhOverride ?? effectiveProf?.baseEH ?? 12;
    const ehMax = Math.max(
      character.kind === "pc" ? 1 : 0,
      baseEH + fisico + (data.ehGainedFromStages ?? 0) + (data.ehBonus ?? 0)
    );

    const isMystic = effectiveProf?.isMystic ?? false;
    const karmaMax =
      character.kind === "monster"
        ? Math.max(0, character.resources?.karma?.max ?? data.karmaBonus ?? 0)
        : isMystic && aura >= 1
          ? Math.max(0, (aura + 1) * (data.stage + 1) + (data.karmaBonus ?? 0))
          : Math.max(0, data.karmaBonus ?? 0);

    const absorcao = Math.max(0, equipAbsorcao + racialNaturalAbs);
    if (
      data.armorClassOverride &&
      (armorClassRank[data.armorClassOverride] ?? 0) > armorClassRank[armorClass]
    ) {
      armorClass = data.armorClassOverride;
    }
    const defesaPassiva = Math.max(
      0,
      armorDefPassive +
        shieldDefPassive +
        helmetDefPassive +
        (data.naturalDefensePassive ?? 0) +
        dpDelta
    );
    const defesaAtiva = Math.max(
      0,
      agilidade -
        agilityPenalty +
        armorDefActive +
        shieldDefActive +
        helmetDefActive +
        (data.naturalDefenseActive ?? 0) +
        daDelta
    );
    const effectiveDefense = usesPassiveDefense ? defesaPassiva : defesaAtiva;

    const rf = data.stage + fisico + racialRfBonus + (data.rfBonus ?? 0) + rfDelta;
    const rm = data.stage + aura + racialRmBonus + (data.rmBonus ?? 0) + rmDelta;

    const baseVB = data.baseVbOverride ?? race?.baseVB ?? 20;
    const vb =
      vbMultiplier <= 0 ? 0 : Math.max(1, Math.floor((baseVB + fisico) * vbMultiplier));
    const vbQuadrados = vb <= 0 ? 0 : Math.max(1, Math.floor(vb / 1.5));
    const iniciativa = agilidade;

    // 5. Pre-computed equipped weapon attack columns for 1-click UI buttons
    const equippedWeapons = data.inventory
      .filter((i) => i.category === "weapon" && i.equipped !== false)
      .map((w) => {
        const tech = findMatchingTechniqueLevel(w, data.combatTechniques);
        const attrVal = data.attributes[tech.attribute] ?? agilidade;
        const underMinFor = typeof w.minFor === "number" && forca < w.minFor;
        const minForPenalty = underMinFor ? -2 : 0;
        const rawCol =
          typeof w.fixedColumn === "number"
            ? w.fixedColumn + conditionColumnShift
            : attrVal + tech.level + (w.columnBonus ?? 0) + minForPenalty + conditionColumnShift;
        const column =
          attackColumnMultiplier < 1 ? Math.floor(rawCol * attackColumnMultiplier) : rawCol;
        const dmg: TagmarColorDamage = w.damage ?? {
          verde: 2,
          amarelo: 4,
          laranja: 6,
          vermelho: 8,
          azul: 10,
        };
        return {
          id: w.id,
          name: w.name,
          column,
          damage: dmg,
          damageType: w.damageType ?? "Corte",
          range: w.range ?? "Corpo a Corpo",
          techniqueName: tech.techniqueName,
          underMinFor,
        };
      });

    // 6. Pre-computed skill columns
    const computedSkills = data.skills.map((s) => {
      const attrVal = data.attributes[s.attribute] ?? 0;
      const specBonus = s.specialized ? 2 : 0;
      return {
        id: s.id,
        name: s.name,
        attribute: s.attribute,
        level: s.level,
        column: attrVal + s.level + (s.bonus ?? 0) + specBonus + conditionColumnShift,
      };
    });

    const curEf = character.resources?.ef?.current ?? efMax;

    return {
      computed: {
        efMax,
        ehMax,
        karmaMax,
        efWithAbsorption: efMax + absorcao,
        defesaAtiva,
        defesaPassiva,
        effectiveDefense,
        absorcao,
        armorClass,
        agilityPenalty,
        rf,
        rm,
        vb,
        vbQuadrados,
        iniciativa,
        iniciativaBonus: iniciativa,
        totalWeight: Number(totalWeight.toFixed(1)),
        conditionColumnShift,
        skipTurn,
        efDot,
        ehDot,
        usesPassiveDefense,
        autoCritAgainst,
        bypassesEh,
        cannotCastSpells,
        inconsciente: curEf <= 0,
        agonizando: curEf < 0 && curEf > -15,
        morto: curEf <= -15,
        isMystic,
        spellcastingAttribute: effectiveProf?.spellcastingAttribute ?? null,
        equippedWeapons,
        computedSkills,
      },
      resourceMax: {
        eh: ehMax,
        ef: efMax,
        karma: karmaMax,
      },
    };
  },

  createCharacterFromWizard(rawInput: Record<string, unknown>) {
    const input = rawInput as unknown as TagmarWizardInput;
    const race = findTagmarRace(input.raceId) ?? tagmarRaces[0];
    const baseProf = findTagmarProfession(input.professionId) ?? tagmarCoreProfessions[0];
    const coreProf =
      baseProf.isSpecialization && baseProf.baseProfessionId
        ? findTagmarProfession(baseProf.baseProfessionId) ?? tagmarCoreProfessions[0]
        : baseProf;
    const spec =
      baseProf.isSpecialization
        ? baseProf
        : input.specializationId
          ? findTagmarProfession(input.specializationId)
          : undefined;

    // Build final 6 attributes from racial base + allocations (or direct final attributes)
    const attrs: TagmarAttributes = { ...race.attributeAdjustments };
    if (input.attributes) {
      for (const key of ATTR_KEYS) {
        if (typeof input.attributes[key] === "number") {
          attrs[key] = clamp(
            Math.trunc(input.attributes[key] as number),
            Math.max(-4, race.attributeAdjustments[key] - 2),
            Math.min(6, race.attributeAdjustments[key] + 4)
          );
        }
      }
    } else if (input.attributeAllocations) {
      for (const key of ATTR_KEYS) {
        const delta = Math.trunc(Number(input.attributeAllocations[key] ?? 0));
        attrs[key] = clamp(
          race.attributeAdjustments[key] + delta,
          Math.max(-4, race.attributeAdjustments[key] - 2),
          Math.min(6, race.attributeAdjustments[key] + 4)
        );
      }
    }

    // Skills
    const skillIds =
      input.selectedSkillIds && input.selectedSkillIds.length > 0
        ? input.selectedSkillIds
        : (spec ?? coreProf).startingSkills;
    const specializedSet = new Set(
      ((spec ?? coreProf).skillCosts?.specializedSkills ?? []).map(norm)
    );
    const skills: TagmarSkillEntry[] = [];
    for (const sid of skillIds) {
      const found = findTagmarSkill(sid);
      if (found && !skills.some((s) => s.id === found.id)) {
        skills.push({
          id: found.id,
          skillId: found.id,
          name: found.name,
          group: found.group,
          attribute: found.attribute,
          level: specializedSet.has(norm(found.name)) ? 2 : 1,
          restricted: found.restricted,
          specialized: specializedSet.has(norm(found.name)),
          description: found.description,
        });
      }
    }

    // Combat Techniques
    const techIds =
      input.selectedCombatTechniqueIds && input.selectedCombatTechniqueIds.length > 0
        ? input.selectedCombatTechniqueIds
        : (spec ?? coreProf).startingCombatTechniques;
    const combatTechniques: TagmarCombatEntry[] = [];
    for (const tid of techIds) {
      const found = findTagmarCombatTechnique(tid);
      if (found && !combatTechniques.some((t) => t.id === found.id)) {
        combatTechniques.push({
          id: found.id,
          techniqueId: found.id,
          name: found.name,
          category: found.category,
          attribute: found.attribute,
          level: coreProf.id === "guerreiro" ? 3 : coreProf.id === "rastreador" ? 2 : 1,
          description: found.description,
          automation: found.automation,
        });
      }
    }

    // Spells (for mystic professions)
    const spells: TagmarSpellEntry[] = [];
    if ((spec ?? coreProf).isMystic) {
      const spellIds =
        input.selectedSpellIds && input.selectedSpellIds.length > 0
          ? input.selectedSpellIds
          : (spec ?? coreProf).startingSpells;
      for (const spId of spellIds) {
        const found = findTagmarSpell(spId);
        if (found && !spells.some((s) => s.id === found.id)) {
          spells.push({
            id: found.id,
            spellId: found.id,
            name: found.name,
            group: found.group,
            professionIds: found.professionIds,
            level: 1,
            karmaCost: found.karmaCost,
            evocationTime: found.evocationTime,
            range: found.range,
            duration: found.duration,
            resistance: found.resistance,
            effectLevels: found.effectLevels,
            description: found.description,
            automation: found.automation,
          });
        }
      }
    }

    // Starting equipment & currency
    const inventory = resolveStarterInventory(
      spec ?? coreProf,
      input.selectedWeaponId,
      input.selectedArmorId
    );
    const cur = coreProf.startingCurrency;
    const money: TagmarMoney = {
      mo: cur?.unit === "MO" ? cur.amount : 0,
      mp: cur?.unit === "MP" ? cur.amount : 0,
      mc: cur?.unit === "MC" ? cur.amount : 0,
    };

    const name =
      String(input.name ?? `${race.name} ${coreProf.name}`).trim() || "Novo Herói de Tagmar";
    const portraitUrl =
      input.portraitUrl ||
      spec?.suggestedPortrait ||
      coreProf.suggestedPortrait ||
      race.suggestedPortrait ||
      "./assets/portraits/human-warrior.svg";

    const roleSubtitle = spec ? `${coreProf.name} · ${spec.name}` : coreProf.name;

    const systemData: TagmarSystemData = {
      raceId: race.id,
      raceName: race.name,
      professionId: coreProf.id,
      professionName: coreProf.name,
      specializationId: spec?.id ?? null,
      specializationName: spec?.name ?? null,
      stage: 1,
      xp: 0,
      attributes: attrs,
      ehBonus: 0,
      efBonus: 0,
      karmaBonus: 0,
      ehGainedFromStages: 0,
      skills,
      combatTechniques,
      spells,
      inventory,
      money,
      languages: race.languages,
      biography: input.biography ?? "",
      notes: input.notes ?? "",
    };

    const draft: Character = {
      id: "",
      campaignId: "",
      systemId: "tagmar-3",
      kind: "pc",
      name,
      subtitle: `${roleSubtitle} (${race.name}) · Estágio 1`,
      portraitUrl,
      ownerUserId: input.ownerUserId ?? null,
      controlledByUserIds: input.ownerUserId ? [input.ownerUserId] : [],
      visibility: "all_players",
      resources: {
        eh: { current: 12, max: 12 },
        ef: { current: 15, max: 15, temp: 0 },
        karma: { current: 0, max: 0 },
      },
      conditions: [],
      systemData: systemData as unknown as Record<string, unknown>,
      computed: {},
      updatedAt: "",
    };

    const { computed, resourceMax } = this.computeDerivedStats(draft);
    const absorcao = Number(computed.absorcao ?? 0);

    systemData.efMax = resourceMax.ef;
    systemData.ehMax = resourceMax.eh;
    systemData.karmaMax = resourceMax.karma;
    systemData.defesaAtiva = Number(computed.defesaAtiva);
    systemData.defesaPassiva = Number(computed.defesaPassiva);
    systemData.absorcao = absorcao;
    systemData.rf = Number(computed.rf);
    systemData.rm = Number(computed.rm);
    systemData.vb = Number(computed.vb);
    systemData.iniciativa = Number(computed.iniciativa);

    draft.systemData = systemData as unknown as Record<string, unknown>;
    draft.computed = computed;
    draft.resources = {
      eh: { current: resourceMax.eh, max: resourceMax.eh },
      ef: { current: resourceMax.ef, max: resourceMax.ef, temp: absorcao },
      karma: { current: resourceMax.karma, max: resourceMax.karma },
    };

    const { id: _id, campaignId: _cid, updatedAt: _u, ...result } = draft;
    return result;
  },

  buildRollRequest(character: Character, request: RollRequest): RollPlan {
    switch (request.kind) {
      case "attribute":
        return buildAttributeRoll(character, request.key ?? "forca", {
          bonus: request.bonus,
          difficulty: request.difficulty,
          label: request.label,
          columnOverride: request.tagmarColumn,
        });
      case "skill":
      case "ability":
        return buildSkillRoll(character, request.itemId ?? request.key ?? "", {
          bonus: request.bonus,
          difficulty: request.difficulty,
          label: request.label,
        });
      case "attack":
        return buildWeaponAttackRoll(character, request.itemId ?? "", request.target, request.bonus ?? 0);
      case "spell":
        return buildSpellRoll(character, request.itemId ?? "", request.target, request.bonus ?? 0);
      case "resistance": {
        const resKind = request.tagmarResistance?.kind ?? (request.key === "rm" ? "rm" : "rf");
        const fa = request.tagmarResistance?.fa ?? request.difficulty ?? 5;
        return buildResistanceRoll(character, resKind, fa, { label: request.label });
      }
      case "initiative":
        return this.planInitiative(character);
      default: {
        const formula = interpolateFormula(request.formula ?? "1d20", {
          character,
          target: request.target,
        });
        return {
          formula,
          label:
            request.label ??
            (typeof request.tagmarColumn === "number"
              ? `Tabela de Resolução (Col. ${request.tagmarColumn})`
              : "Rolagem Tagmar"),
          difficulty: request.difficulty,
          targetCharacterId: request.target?.id,
          targetName: request.target?.name,
          tagmarColumn: request.tagmarColumn,
          tagmarResistance: request.tagmarResistance,
          systemMeta: {
            systemId: "tagmar-3",
            kind: "custom",
            tagmarColumn: request.tagmarColumn,
          },
        };
      }
    }
  },

  planAttributeCheck(character, attrKey, opts) {
    return buildAttributeRoll(character, attrKey, opts);
  },

  planAttack(character, weaponId, target) {
    return buildWeaponAttackRoll(character, weaponId, target);
  },

  planAbility(character, abilityId, target) {
    return buildSkillRoll(character, abilityId, { label: target ? undefined : undefined });
  },

  planSpell(character, spellId, target) {
    return buildSpellRoll(character, spellId, target);
  },

  planInitiative(character) {
    const { computed } = this.computeDerivedStats(character);
    const agi = Number(computed.iniciativa ?? 0);
    return {
      formula: `1d10${formatMod(agi)}`,
      label: `Iniciativa (1d10${formatMod(agi)})`,
      systemMeta: {
        systemId: "tagmar-3",
        kind: "initiative",
      },
    };
  },

  resolveRollOutcome(roll: RollResult, _actor?: Character, target?: Character): RollEvaluation {
    const meta = (roll.systemMeta ?? {}) as Record<string, unknown>;
    const activeDice = roll.dice.filter((d) => !d.dropped);
    const d20Die = activeDice.find((d) => d.sides === 20);
    const d20Val = d20Die?.value ?? roll.total;

    const targetName =
      target?.name ?? (typeof meta.targetName === "string" ? meta.targetName : roll.outcome?.targetName);
    const targetId =
      target?.id ?? (typeof meta.targetCharacterId === "string" ? meta.targetCharacterId : undefined);
    const actions: InteractiveAction[] = [];

    // 1. Resistance Table roll (RF or RM)
    const resistanceInfo =
      roll.tagmarResistance ??
      (meta.kind === "resistance"
        ? {
            kind: (meta.resistanceKind === "rm" ? "rm" : "rf") as "rf" | "rm",
            fa: Number(meta.fa ?? 5),
            fd: Number(meta.fd ?? 1),
            target: Number(meta.target ?? getResistanceTarget(Number(meta.fa ?? 5), Number(meta.fd ?? 1))),
            resisted: false,
          }
        : undefined);

    if (resistanceInfo && d20Die) {
      const res = resolveTagmarResistance(d20Val, resistanceInfo.fa, resistanceInfo.fd);
      const kindLabel = resistanceInfo.kind.toUpperCase();
      return {
        outcome: {
          kind: res.resisted
            ? res.isCritical
              ? "critical"
              : "success"
            : res.isFumble
              ? "fumble"
              : "failure",
          badgeText: res.resisted
            ? `RESISTIU (${kindLabel}) · ${d20Val} ≥ ${res.target} (FD ${res.fd} vs FA ${res.fa})`
            : `AFETADO (${kindLabel}) · ${d20Val} < ${res.target} (FD ${res.fd} vs FA ${res.fa})`,
          difficulty: res.target,
          margin: d20Val - res.target,
        },
        actions,
      };
    }

    // 2. Initiative roll
    if (meta.kind === "initiative") {
      return {
        outcome: {
          kind: "info",
          badgeText: `Iniciativa: ${roll.total}`,
        },
        actions,
      };
    }

    // 3. Official Tagmar 3.0 Tabela de Resolução roll (1d20 vs Column)
    const column =
      typeof roll.tagmarColumn === "number"
        ? roll.tagmarColumn
        : typeof meta.tagmarColumn === "number"
          ? meta.tagmarColumn
          : undefined;

    if (column !== undefined && d20Die) {
      const resolved = resolveTagmarRoll(d20Val, column);
      const color: TagmarResolutionColor = roll.tagmarColor ?? resolved.color;
      const colorMeta = TAGMAR_COLOR_META[color];

      // Karma deduction action for spells
      const karmaCost = typeof meta.karmaCost === "number" ? meta.karmaCost : 0;
      if (karmaCost > 0) {
        actions.push({
          id: `spend-karma-${roll.rollId}`,
          label: `Gastar ${karmaCost} Karma`,
          style: "mana",
          actionType: "spend_mana",
          payload: { resource: "karma", amount: karmaCost },
        });
      }

      // Weapon damage action (EH->EF normal, or Direct to EF on Azul Critical!)
      const weaponDamage = meta.weaponDamage as TagmarColorDamage | undefined;
      if (weaponDamage && colorMeta.isSuccess) {
        const dmg = computeWeaponDamage(weaponDamage, color);
        const dmgType = typeof meta.damageType === "string" ? meta.damageType : "Corte";
        if (dmg.damage > 0) {
          actions.push({
            id: `apply-dmg-${roll.rollId}`,
            label: dmg.directToEf
              ? `Aplicar ${dmg.damage} Dano Direto na EF (Crítico!)${targetName ? ` em ${targetName}` : ""}`
              : `Aplicar ${dmg.damage} de Dano (EH→EF)${targetName ? ` em ${targetName}` : ""}`,
            style: "damage",
            actionType: "apply_damage",
            targetCharacterId: targetId,
            payload: {
              amount: dmg.damage,
              damageType: dmgType,
              critical: dmg.directToEf,
              directToEf: dmg.directToEf,
              ignoreAbsorption: dmg.directToEf,
              tagmarColor: color,
            },
          });
        }
      }

      // Spell color-coded damage
      const spellDamage = meta.damageByColor as TagmarColorDamage | undefined;
      if (spellDamage && colorMeta.isSuccess) {
        const dmg = computeWeaponDamage(spellDamage, color);
        const dmgType = typeof meta.damageType === "string" ? meta.damageType : "Mágico";
        if (dmg.damage > 0) {
          actions.push({
            id: `apply-spell-dmg-${roll.rollId}`,
            label: dmg.directToEf
              ? `Aplicar ${dmg.damage} Dano Mágico Direto na EF (Crítico!)${targetName ? ` em ${targetName}` : ""}`
              : `Aplicar ${dmg.damage} Dano Mágico (EH→EF)${targetName ? ` em ${targetName}` : ""}`,
            style: "damage",
            actionType: "apply_damage",
            targetCharacterId: targetId,
            payload: {
              amount: dmg.damage,
              damageType: dmgType,
              critical: dmg.directToEf,
              directToEf: dmg.directToEf,
              ignoreAbsorption: dmg.directToEf,
              tagmarColor: color,
            },
          });
        }
      }

      // Spell color-coded healing
      const spellHeal = meta.healByColor as TagmarColorDamage | undefined;
      if (spellHeal && colorMeta.isSuccess) {
        const heal = computeWeaponDamage(spellHeal, color);
        if (heal.damage > 0) {
          actions.push({
            id: `apply-heal-${roll.rollId}`,
            label: `Aplicar Cura (+${heal.damage} EF/EH)${targetName ? ` em ${targetName}` : ""}`,
            style: "heal",
            actionType: "apply_heal",
            targetCharacterId: targetId,
            payload: { amount: heal.damage, tagmarColor: color },
          });
        }
      }

      // Condition button
      if (colorMeta.isSuccess && typeof meta.appliesCondition === "string" && meta.appliesCondition) {
        const condDef = findTagmarCondition(meta.appliesCondition);
        actions.push({
          id: `apply-cond-${roll.rollId}`,
          label: `Aplicar ${condDef?.name ?? meta.appliesCondition}${targetName ? ` em ${targetName}` : ""}`,
          style: "condition",
          actionType: "apply_condition",
          targetCharacterId: targetId,
          payload: {
            conditionId: condDef?.id ?? meta.appliesCondition,
            rounds: condDef?.defaultTurns ?? 2,
          },
        });
      }

      // Resistance followup prompt when casting a spell with RF/RM resistance
      if (
        colorMeta.isSuccess &&
        (meta.resistance === "rf" || meta.resistance === "rm")
      ) {
        const fa = Number(meta.attackForce ?? 5);
        actions.push({
          id: `resist-followup-${roll.rollId}`,
          label: `Rolar ${String(meta.resistance).toUpperCase()} (FA ${fa})`,
          style: "roll",
          actionType: "roll_followup",
          targetCharacterId: targetId,
          payload: {
            formula: "1d20",
            label: `Teste de ${String(meta.resistance).toUpperCase()} vs ${String(meta.spellName ?? roll.label)}`,
            tagmarResistance: {
              kind: meta.resistance,
              fa,
              fd:
                meta.resistance === "rf"
                  ? Number(target?.computed?.rf ?? 1)
                  : Number(target?.computed?.rm ?? 1),
            },
          },
        });
      }

      const kind: RollEvaluation["outcome"]["kind"] = colorMeta.isCritical
        ? "critical"
        : colorMeta.isFumble
          ? "fumble"
          : colorMeta.isSuccess
            ? "success"
            : "failure";

      const overflowNote =
        resolved.overflowSteps > 0
          ? ` · Col ${column} → ${resolved.effectiveColumn} (+${resolved.overflowTiers} faixas)`
          : "";

      return {
        outcome: {
          kind,
          badgeText: `${resolved.label} · d20=${d20Val} na Col. ${column}${overflowNote}`,
          targetDefense:
            typeof meta.targetDefense === "number" ? meta.targetDefense : roll.outcome?.targetDefense,
          targetName,
        },
        actions,
      };
    }

    // Fallback plain roll
    return {
      outcome: {
        kind: "info",
        badgeText: `Resultado: ${roll.total}`,
      },
      actions,
    };
  },

  evaluateRoll(roll, actor, target) {
    return this.resolveRollOutcome(roll, actor, target);
  },

  applyDamage(
    character: Character,
    amount: number,
    damageTypeOrOptions?: string | DamageOptions
  ): Partial<Character> {
    const dmg = Math.max(0, Math.floor(amount));
    const opts: DamageOptions =
      typeof damageTypeOrOptions === "object" && damageTypeOrOptions !== null
        ? damageTypeOrOptions
        : { damageType: damageTypeOrOptions };

    const { computed, resourceMax } = this.computeDerivedStats(character);
    const curEh = character.resources?.eh ?? { current: resourceMax.eh, max: resourceMax.eh };
    const curEf = character.resources?.ef ?? {
      current: resourceMax.ef,
      max: resourceMax.ef,
      temp: Number(computed.absorcao ?? 0),
    };

    let nextEh = curEh.current;
    let nextAbs = typeof curEf.temp === "number" ? curEf.temp : Number(computed.absorcao ?? 0);
    let nextEf = curEf.current;

    const directToEf = Boolean(opts.directToEf) || Boolean(computed.bypassesEh);
    const ignoreAbsorption = Boolean(opts.ignoreAbsorption) || Boolean(opts.directToEf);

    if (directToEf) {
      // Critical Hit / direct-to-EF bypasses EH (and non-magical armor absorption)
      let remaining = dmg;
      if (!ignoreAbsorption && nextAbs > 0) {
        const absorbed = Math.min(nextAbs, remaining);
        nextAbs -= absorbed;
        remaining -= absorbed;
      }
      nextEf -= remaining;
    } else {
      // Standard Tagmar 3.0 damage pipeline: EH first -> Absorção (ef.temp) -> EF
      let remaining = dmg;
      if (nextEh > 0) {
        const ehAbsorbed = Math.min(nextEh, remaining);
        nextEh -= ehAbsorbed;
        remaining -= ehAbsorbed;
      }
      if (remaining > 0 && !ignoreAbsorption && nextAbs > 0) {
        const armorAbsorbed = Math.min(nextAbs, remaining);
        nextAbs -= armorAbsorbed;
        remaining -= armorAbsorbed;
      }
      if (remaining > 0) {
        nextEf -= remaining;
      }
    }

    const conditions = [...(character.conditions ?? [])];
    const ensureCond = (cid: string) => {
      if (!conditions.some((c) => c.id === cid)) {
        const def = findTagmarCondition(cid);
        conditions.push({
          id: cid,
          name: def?.name ?? cid,
          icon: def?.icon ?? "moon-star",
        });
      }
    };

    if (nextEf <= 0) {
      ensureCond("inconsciente");
    }
    if (nextEf < 0) {
      ensureCond("agonizando");
    }

    const nextResources = {
      ...character.resources,
      eh: { ...curEh, current: nextEh },
      ef: { ...curEf, current: nextEf, temp: Math.max(0, nextAbs) },
    };
    const nextChar: Character = {
      ...character,
      resources: nextResources,
      conditions,
    };
    const recomputed = this.computeDerivedStats(nextChar);

    return {
      resources: nextResources,
      conditions,
      computed: recomputed.computed,
    };
  },

  applyHealing(character: Character, amount: number): Partial<Character> {
    const heal = Math.max(0, Math.floor(amount));
    const { resourceMax } = this.computeDerivedStats(character);
    const curEh = character.resources?.eh ?? { current: 0, max: resourceMax.eh };
    const curEf = character.resources?.ef ?? { current: 0, max: resourceMax.ef };

    // Restore EF first (stabilizing critical wounds), overflow into EH
    let remaining = heal;
    const efMissing = Math.max(0, curEf.max - curEf.current);
    const efGain = Math.min(efMissing, remaining);
    const nextEf = curEf.current + efGain;
    remaining -= efGain;

    const ehMissing = Math.max(0, curEh.max - curEh.current);
    const ehGain = Math.min(ehMissing, remaining);
    const nextEh = curEh.current + ehGain;

    const conditions =
      nextEf > 0
        ? (character.conditions ?? []).filter(
            (c) => c.id !== "inconsciente" && c.id !== "agonizando"
          )
        : character.conditions ?? [];

    const nextResources = {
      ...character.resources,
      eh: { ...curEh, current: nextEh },
      ef: { ...curEf, current: nextEf },
    };
    const nextChar: Character = {
      ...character,
      resources: nextResources,
      conditions,
    };
    const recomputed = this.computeDerivedStats(nextChar);

    return {
      resources: nextResources,
      conditions,
      computed: recomputed.computed,
    };
  },

  spendMana(character: Character, amount: number) {
    return spendKarma(character, amount);
  },

  applyCondition(character: Character, conditionId: string, rounds?: number) {
    const def = findTagmarCondition(conditionId);
    const entry: ActiveCondition = {
      id: def?.id ?? conditionId,
      name: def?.name ?? conditionId,
      icon: def?.icon ?? "alert-circle",
      roundsRemaining: rounds ?? (typeof def?.defaultTurns === "number" ? def.defaultTurns : undefined),
    };
    const nextConds = [...(character.conditions ?? []).filter((c) => c.id !== entry.id), entry];
    const nextChar: Character = { ...character, conditions: nextConds };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextConds, computed };
  },

  removeCondition(character: Character, conditionId: string) {
    const nextConds = (character.conditions ?? []).filter((c) => c.id !== conditionId);
    const nextChar: Character = { ...character, conditions: nextConds };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextConds, computed };
  },

  levelUp(character: Character, choices: Record<string, unknown>) {
    return advanceStage(character, {
      ehRoll: typeof choices.ehRoll === "number" ? choices.ehRoll : undefined,
      specializationId:
        typeof choices.specializationId === "string" ? choices.specializationId : undefined,
      xp: typeof choices.xp === "number" ? choices.xp : undefined,
    });
  },

  rest(character: Character, kind: "short" | "long"): Partial<Character> {
    const { computed, resourceMax } = this.computeDerivedStats(character);
    const curEh = character.resources?.eh ?? { current: 0, max: resourceMax.eh };
    const curEf = character.resources?.ef ?? { current: 0, max: resourceMax.ef };
    const curKarma = character.resources?.karma ?? { current: 0, max: resourceMax.karma };
    const fullAbs = Number(computed.absorcao ?? 0);

    let nextEh = curEh.current;
    let nextEf = curEf.current;
    let nextAbs = typeof curEf.temp === "number" ? curEf.temp : fullAbs;
    let nextKarma = curKarma.current;
    let conditions = [...(character.conditions ?? [])];

    if (kind === "short") {
      // Short rest (~2h resting/light): +2 EH (1/h), +1 Karma (half awake rest cycle)
      nextEh = Math.min(curEh.max, Math.max(0, curEh.current) + 2);
      if (curKarma.max > 0) {
        nextKarma = Math.min(curKarma.max, curKarma.current + 1);
      }
    } else {
      // Long rest (8h sleep with Focus): +16 EH (2/h × 8h), +1 EF (if EF > 0), 100% Karma, repair armor Absorção
      nextEh = Math.min(curEh.max, Math.max(0, curEh.current) + 16);
      if (curEf.current > 0) {
        nextEf = Math.min(curEf.max, curEf.current + 1);
      }
      nextAbs = fullAbs;
      nextKarma = curKarma.max;
      conditions = conditions.filter((c) => c.id !== "exausto");
    }

    const nextResources = {
      ...character.resources,
      eh: { ...curEh, current: nextEh },
      ef: { ...curEf, current: nextEf, temp: nextAbs },
      karma: { ...curKarma, current: nextKarma },
    };
    const nextChar: Character = {
      ...character,
      resources: nextResources,
      conditions,
    };
    const recomputed = this.computeDerivedStats(nextChar);

    return {
      resources: nextResources,
      conditions,
      computed: recomputed.computed,
    };
  },

  shortRest(character: Character) {
    return this.rest(character, "short");
  },

  longRest(character: Character) {
    return this.rest(character, "long");
  },

  getCompendium() {
    const content = getTagmarContent();
    return {
      rules: [content.rules],
      races: content.races,
      professions: content.professions,
      skills: content.skills,
      combatTechniques: content.combatTechniques,
      spells: content.spells,
      weapons: content.equipment.weapons,
      armor: content.equipment.armor,
      gear: content.equipment.gear,
      conditions: content.conditions,
      bestiary: content.bestiary,
    };
  },

  getCompendiumCategories(): CompendiumCategory[] {
    const content = getTagmarContent();
    return [
      { id: "races", label: "Raças", items: content.races as unknown as Record<string, unknown>[] },
      {
        id: "professions",
        label: "Profissões & Especializações",
        items: content.professions as unknown as Record<string, unknown>[],
      },
      {
        id: "skills",
        label: "Habilidades",
        items: content.skills as unknown as Record<string, unknown>[],
      },
      {
        id: "combatTechniques",
        label: "Técnicas de Combate",
        items: content.combatTechniques as unknown as Record<string, unknown>[],
      },
      {
        id: "spells",
        label: "Magias",
        items: content.spells as unknown as Record<string, unknown>[],
      },
      {
        id: "weapons",
        label: "Armas",
        items: content.equipment.weapons as unknown as Record<string, unknown>[],
      },
      {
        id: "armor",
        label: "Armaduras, Escudos & Elmos",
        items: content.equipment.armor as unknown as Record<string, unknown>[],
      },
      {
        id: "gear",
        label: "Itens, Alquimia & Relíquias",
        items: content.equipment.gear as unknown as Record<string, unknown>[],
      },
      {
        id: "conditions",
        label: "Condições",
        items: content.conditions as unknown as Record<string, unknown>[],
      },
      {
        id: "bestiary",
        label: "Bestiário (Livro das Criaturas)",
        items: content.bestiary as unknown as Record<string, unknown>[],
      },
    ];
  },

  createCharacterFromBestiary(creatureId: string) {
    return spawnBestiaryMonster(creatureId);
  },
};

export const tagmarEngine = tagmar3Engine;

export {
  tagmarRules,
  tagmarRaces,
  tagmarProfessions,
  tagmarCoreProfessions,
  tagmarSpecializations,
  tagmarConditions,
  tagmarSkills,
  tagmarCombatTechniques,
  tagmarSpells,
  tagmarEquipment,
  tagmarBestiary,
  findTagmarRace,
  findTagmarProfession,
  getSpecializationsForProfession,
  findTagmarCondition,
  findTagmarSkill,
  findTagmarCombatTechnique,
  findTagmarSpell,
  getSpellsByProfession,
  findTagmarWeapon,
  findTagmarArmor,
  findTagmarGear,
  findTagmarCreature,
  searchTagmarCompendium,
  getTagmarContent,
  hydrateTagmarCompendium,
} from "./compendium";

export {
  TAGMAR_COLOR_META,
  TAGMAR_COLOR_ORDER,
  resolveTagmarRoll,
  resolveTagmarResistance,
  computeWeaponDamage,
  getResolutionRow,
  getAllResolutionRows,
  getResistanceTarget,
  tagmarResistanceMatrix,
} from "./resolutionTable";
