/**
 * Mesa VTT — Generic / Freeform Multisystem Engine (`generic-rpg`).
 * Proves the RpgSystemEngine contract works for any tabletop RPG out of the box
 * with editable attributes, custom resource bars, arbitrary NdX+M actions, and macros.
 */

import manifestJson from "./manifest.json";
import schemaJson from "./schema.json";
import { interpolateFormula } from "../sandbox";
import type {
  ActiveCondition,
  Character,
  CompendiumCategory,
  GenericActionEntry,
  GenericAttributeEntry,
  GenericRpgSystemData,
  InteractiveAction,
  RollEvaluation,
  RollPlan,
  RollResult,
  RpgSystemEngine,
  SystemManifest,
  SystemSchema,
} from "../types";

const GENERIC_CONDITIONS: Array<{
  id: string;
  name: string;
  icon: string;
  defenseDelta?: number;
  attackDelta?: number;
  description: string;
}> = [
  { id: "ferido", name: "Ferido", icon: "droplet", attackDelta: -1, description: "Sofre -1 em rolagens de ataque e testes físicos." },
  { id: "atordoado", name: "Atordoado", icon: "zap", defenseDelta: -2, attackDelta: -2, description: "Sofre -2 na Defesa e nos ataques." },
  { id: "caido", name: "Caído", icon: "arrow-down-circle", defenseDelta: -2, attackDelta: -2, description: "Prostrado no chão (-2 Defesa corpo a corpo, -2 ataques)." },
  { id: "envenenado", name: "Envenenado", icon: "skull", attackDelta: -1, description: "Sofre -1 em testes e pode sofrer dano contínuo." },
  { id: "inspirado", name: "Inspirado", icon: "sparkles", attackDelta: 2, defenseDelta: 1, description: "Concede +2 em rolagens e +1 na Defesa." },
  { id: "inconsciente", name: "Inconsciente", icon: "moon", defenseDelta: -5, description: "Incapaz de agir." },
];

function readGenericData(character: Character): GenericRpgSystemData {
  const raw = (character.systemData ?? {}) as Partial<GenericRpgSystemData>;
  const attrs: GenericAttributeEntry[] = Array.isArray(raw.attributes) && raw.attributes.length > 0
    ? raw.attributes
    : (schemaJson.attributes ?? []).map((a) => ({
        key: a.key,
        label: a.label,
        value: a.defaultValue,
      }));
  return {
    level: typeof raw.level === "number" ? raw.level : 1,
    archetype: raw.archetype ?? "Aventureiro",
    attributes: attrs,
    customBars: Array.isArray(raw.customBars) ? raw.customBars : [],
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    notes: raw.notes ?? "",
  };
}

function getAttrValue(data: GenericRpgSystemData, key: string): number {
  const found = data.attributes.find((a) => a.key === key);
  return found ? found.value : 0;
}

function formatMod(value: number): string {
  if (value === 0) return "";
  return value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
}

export const genericRpgEngine: RpgSystemEngine = {
  manifest: manifestJson as SystemManifest,
  schema: schemaJson as SystemSchema,

  computeDerivedStats(character: Character) {
    const data = readGenericData(character);
    const destreza = getAttrValue(data, "destreza") || data.attributes[1]?.value || 0;
    const fisico = getAttrValue(data, "fisico") || data.attributes[0]?.value || 0;

    let defenseDelta = 0;
    let attackDelta = 0;
    for (const cond of character.conditions ?? []) {
      const def = GENERIC_CONDITIONS.find((c) => c.id === cond.id);
      if (def?.defenseDelta) defenseDelta += def.defenseDelta;
      if (def?.attackDelta) attackDelta += def.attackDelta;
    }

    const armorBonus = (data.inventory ?? [])
      .filter((i) => i.equipped && (i.category === "armor" || i.category === "shield"))
      .reduce((acc, i) => acc + (i.defenseBonus ?? 0), 0);

    const defesa = 10 + destreza + armorBonus + defenseDelta;
    const hpMax = Math.max(1, character.resources?.hp?.max ?? 20 + fisico * 5 + (data.level - 1) * 5);
    const mpMax = Math.max(0, character.resources?.mp?.max ?? 15 + (data.level - 1) * 3);

    const resourceMax: Record<string, number> = { hp: hpMax, mp: mpMax };
    for (const bar of data.customBars ?? []) {
      resourceMax[bar.key] = Math.max(1, bar.max);
    }

    return {
      computed: {
        defesa,
        bloqueio: defesa,
        esquiva: defesa,
        iniciativaBonus: destreza,
        attackDelta,
        deslocamento: 9,
        deslocamentoQuadrados: 6,
        nivel: data.level,
      },
      resourceMax,
    };
  },

  createCharacterFromWizard(input: Record<string, unknown>) {
    const name = String(input.name ?? "Novo Personagem").trim() || "Novo Personagem";
    const archetype = String(input.archetype ?? "Aventureiro");
    const portraitUrl = String(input.portraitUrl ?? "./assets/portraits/human-warrior.svg");
    const hpMax = Number(input.hpMax ?? 30);
    const mpMax = Number(input.mpMax ?? 20);
    const attrs: GenericAttributeEntry[] = Array.isArray(input.attributes)
      ? (input.attributes as GenericAttributeEntry[])
      : schemaJson.attributes.map((a) => ({
          key: a.key,
          label: a.label,
          value: a.defaultValue,
        }));

    const defaultActions: GenericActionEntry[] = [
      {
        id: "act-ataque",
        name: "Ataque Básico",
        formula: "1d20 + @fisico",
        damageFormula: "1d8 + @fisico",
        description: "Ataque padrão corpo a corpo.",
      },
      {
        id: "act-habilidade",
        name: "Ação Especial",
        formula: "1d20 + @mente",
        resourceKey: "mp",
        resourceCost: 3,
        difficulty: 12,
        description: "Usa energia para um feito especial.",
      },
    ];

    const systemData: GenericRpgSystemData = {
      level: Number(input.level ?? 1),
      archetype,
      attributes: attrs,
      customBars: [],
      actions: Array.isArray(input.actions) ? (input.actions as GenericActionEntry[]) : defaultActions,
      inventory: [],
      notes: String(input.notes ?? ""),
    };

    const draft: Character = {
      id: "",
      campaignId: "",
      systemId: "generic-rpg",
      kind: (input.kind as Character["kind"]) ?? "pc",
      name,
      subtitle: `${archetype} · Nível ${systemData.level}`,
      portraitUrl,
      ownerUserId: (input.ownerUserId as string | null) ?? null,
      controlledByUserIds: input.ownerUserId ? [String(input.ownerUserId)] : [],
      visibility: "all_players",
      resources: {
        hp: { current: hpMax, max: hpMax },
        mp: { current: mpMax, max: mpMax },
      },
      conditions: [],
      systemData: systemData as unknown as Record<string, unknown>,
      computed: {},
      updatedAt: "",
    };

    const { computed, resourceMax } = this.computeDerivedStats(draft);
    draft.computed = computed;
    draft.resources.hp.max = resourceMax.hp;
    draft.resources.hp.current = resourceMax.hp;
    draft.resources.mp.max = resourceMax.mp;
    draft.resources.mp.current = resourceMax.mp;

    const { id: _id, campaignId: _cid, updatedAt: _u, ...result } = draft;
    return result;
  },

  buildRollRequest(character, request) {
    if (request.kind === "attribute" && request.key) {
      return this.planAttributeCheck(character, request.key, {
        bonus: request.bonus,
        difficulty: request.difficulty,
        label: request.label,
      });
    }
    if (request.kind === "attack") {
      return this.planAttack(character, request.itemId ?? "", request.target);
    }
    if (request.kind === "ability" || request.kind === "spell") {
      return this.planAbility(character, request.itemId ?? "", request.target);
    }
    if (request.kind === "initiative") {
      return this.planInitiative(character);
    }
    const rawFormula = request.formula ?? "1d20";
    const formula = interpolateFormula(rawFormula, { character, target: request.target });
    return {
      formula,
      label: request.label ?? "Rolagem Personalizada",
      difficulty: request.difficulty,
      targetCharacterId: request.target?.id,
      targetDefense: typeof request.target?.computed?.defesa === "number" ? request.target.computed.defesa : undefined,
      targetName: request.target?.name,
      systemMeta: { systemId: "generic-rpg", kind: "custom" },
    };
  },

  planAttributeCheck(character, attrKey, opts) {
    const data = readGenericData(character);
    const attr = data.attributes.find((a) => a.key === attrKey);
    const mod = (attr?.value ?? 0) + (opts?.bonus ?? 0);
    return {
      formula: `1d20${formatMod(mod)}`,
      label: opts?.label ?? `Teste de ${attr?.label ?? attrKey}`,
      difficulty: opts?.difficulty,
      systemMeta: { systemId: "generic-rpg", kind: "attribute", attrKey },
    };
  },

  planAttack(character, weaponId, target) {
    const data = readGenericData(character);
    const action = data.actions.find((a) => a.id === weaponId) ?? data.actions[0];
    const targetDefense = typeof target?.computed?.defesa === "number" ? target.computed.defesa : undefined;
    if (action) {
      return {
        formula: interpolateFormula(action.formula, { character, target }),
        label: action.name,
        difficulty: action.difficulty,
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
        manaCost: action.resourceKey === "mp" ? action.resourceCost : undefined,
        damageFormula: action.damageFormula
          ? interpolateFormula(action.damageFormula, { character, target })
          : undefined,
        systemMeta: {
          systemId: "generic-rpg",
          kind: "attack",
          actionId: action.id,
          damageFormula: action.damageFormula
            ? interpolateFormula(action.damageFormula, { character, target })
            : undefined,
          manaCost: action.resourceCost,
        },
      };
    }
    const mod = getAttrValue(data, "fisico") + Number(character.computed?.attackDelta ?? 0);
    return {
      formula: `1d20${formatMod(mod)}`,
      label: "Ataque Básico",
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
      systemMeta: { systemId: "generic-rpg", kind: "attack" },
    };
  },

  planAbility(character, abilityId, target) {
    return this.planAttack(character, abilityId, target);
  },

  planSpell(character, spellId, target) {
    return this.planAttack(character, spellId, target);
  },

  planInitiative(character) {
    const data = readGenericData(character);
    const destreza = getAttrValue(data, "destreza");
    return {
      formula: `1d20${formatMod(destreza)}`,
      label: "Iniciativa",
      systemMeta: { systemId: "generic-rpg", kind: "initiative" },
    };
  },

  resolveRollOutcome(roll, _actor, target) {
    const meta = (roll.systemMeta ?? {}) as Record<string, unknown>;
    const d20 = roll.dice.find((d) => d.sides === 20 && !d.dropped);
    const difficulty =
      typeof meta.targetDefense === "number"
        ? meta.targetDefense
        : typeof roll.outcome?.targetDefense === "number"
          ? roll.outcome.targetDefense
          : typeof roll.outcome?.difficulty === "number"
            ? roll.outcome.difficulty
            : typeof meta.difficulty === "number"
              ? meta.difficulty
              : undefined;

    let outcome: RollEvaluation["outcome"];
    if (d20?.value === 20) {
      outcome = {
        kind: "critical",
        badgeText: "CRÍTICO NATURAL (20)!",
        difficulty,
        targetName: target?.name,
      };
    } else if (d20?.value === 1) {
      outcome = {
        kind: "fumble",
        badgeText: "FALHA CRÍTICA (1)!",
        difficulty,
        targetName: target?.name,
      };
    } else if (difficulty !== undefined) {
      const hit = roll.total >= difficulty;
      outcome = {
        kind: hit ? "success" : "failure",
        badgeText: hit
          ? `SUCESSO (${roll.total} vs ${difficulty})`
          : `FALHA (${roll.total} vs ${difficulty})`,
        difficulty,
        margin: roll.total - difficulty,
        targetName: target?.name,
      };
    } else {
      outcome = {
        kind: "info",
        badgeText: `Total ${roll.total}`,
      };
    }

    const actions: InteractiveAction[] = [];
    if (typeof meta.manaCost === "number" && meta.manaCost > 0) {
      actions.push({
        id: `spend-mp-${roll.rollId}`,
        label: `Gastar ${meta.manaCost} PE`,
        style: "mana",
        actionType: "spend_mana",
        payload: { resource: "mp", amount: meta.manaCost },
      });
    }
    if (typeof meta.damageFormula === "string" && meta.damageFormula && outcome.kind !== "failure" && outcome.kind !== "fumble") {
      actions.push({
        id: `roll-dmg-${roll.rollId}`,
        label: `Rolar Dano (${meta.damageFormula})`,
        style: "damage",
        actionType: "roll_followup",
        targetCharacterId: target?.id,
        payload: { formula: meta.damageFormula, label: `Dano · ${roll.label}` },
      });
    }

    return { outcome, actions };
  },

  evaluateRoll(roll, actor, target) {
    return this.resolveRollOutcome(roll, actor, target);
  },

  applyDamage(character, amount) {
    const dmg = Math.max(0, Math.floor(amount));
    const cur = character.resources?.hp ?? { current: 20, max: 20 };
    const nextHp = cur.current - dmg;
    const conditions = [...(character.conditions ?? [])];
    if (nextHp <= 0 && !conditions.some((c) => c.id === "inconsciente")) {
      conditions.push({ id: "inconsciente", name: "Inconsciente", icon: "moon" });
    }
    return {
      resources: { ...character.resources, hp: { ...cur, current: nextHp } },
      conditions,
    };
  },

  applyHealing(character, amount) {
    const heal = Math.max(0, Math.floor(amount));
    const cur = character.resources?.hp ?? { current: 0, max: 20 };
    const nextHp = Math.min(cur.max, Math.max(0, cur.current) + heal);
    const conditions = nextHp > 0
      ? (character.conditions ?? []).filter((c) => c.id !== "inconsciente")
      : character.conditions ?? [];
    return {
      resources: { ...character.resources, hp: { ...cur, current: nextHp } },
      conditions,
    };
  },

  spendMana(character, amount) {
    const cost = Math.max(0, Math.floor(amount));
    const cur = character.resources?.mp ?? { current: 0, max: 0 };
    if (cur.current < cost) {
      return { error: `Energia insuficiente (${cur.current}/${cost} PE).` };
    }
    return {
      patch: {
        resources: { ...character.resources, mp: { ...cur, current: cur.current - cost } },
      },
    };
  },

  applyCondition(character, conditionId, rounds) {
    const def = GENERIC_CONDITIONS.find((c) => c.id === conditionId);
    const entry: ActiveCondition = {
      id: conditionId,
      name: def?.name ?? conditionId,
      icon: def?.icon ?? "alert-circle",
      roundsRemaining: rounds,
    };
    const filtered = (character.conditions ?? []).filter((c) => c.id !== conditionId);
    const nextChar: Character = { ...character, conditions: [...filtered, entry] };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextChar.conditions, computed };
  },

  removeCondition(character, conditionId) {
    const nextConds = (character.conditions ?? []).filter((c) => c.id !== conditionId);
    const nextChar: Character = { ...character, conditions: nextConds };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextConds, computed };
  },

  levelUp(character, choices) {
    const data = readGenericData(character);
    const nextLevel = data.level + 1;
    const hpBonus = Number(choices.hpBonus ?? 5);
    const mpBonus = Number(choices.mpBonus ?? 3);
    const nextData: GenericRpgSystemData = { ...data, level: nextLevel };
    const curHp = character.resources?.hp ?? { current: 20, max: 20 };
    const curMp = character.resources?.mp ?? { current: 15, max: 15 };
    const nextChar: Character = {
      ...character,
      subtitle: `${data.archetype ?? "Aventureiro"} · Nível ${nextLevel}`,
      systemData: nextData as unknown as Record<string, unknown>,
      resources: {
        ...character.resources,
        hp: { current: curHp.current + hpBonus, max: curHp.max + hpBonus },
        mp: { current: curMp.current + mpBonus, max: curMp.max + mpBonus },
      },
    };
    const { computed } = this.computeDerivedStats(nextChar);
    return {
      subtitle: nextChar.subtitle,
      systemData: nextChar.systemData,
      resources: nextChar.resources,
      computed,
    };
  },

  rest(character, kind) {
    const hp = character.resources?.hp ?? { current: 20, max: 20 };
    const mp = character.resources?.mp ?? { current: 15, max: 15 };
    const ratio = kind === "long" ? 1 : 0.35;
    return {
      resources: {
        ...character.resources,
        hp: { ...hp, current: Math.min(hp.max, hp.current + Math.ceil(hp.max * ratio)) },
        mp: { ...mp, current: Math.min(mp.max, mp.current + Math.ceil(mp.max * ratio)) },
      },
    };
  },

  shortRest(character) {
    return this.rest(character, "short");
  },

  longRest(character) {
    return this.rest(character, "long");
  },

  getCompendium() {
    return {
      conditions: GENERIC_CONDITIONS,
    };
  },

  getCompendiumCategories(): CompendiumCategory[] {
    return [
      { id: "conditions", label: "Condições", items: GENERIC_CONDITIONS as unknown as Record<string, unknown>[] },
    ];
  },
};
