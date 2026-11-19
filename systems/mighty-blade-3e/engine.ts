/**
 * Mesa VTT — Mighty Blade 3ª Edição (3.5) Full Automation Engine (`mighty-blade-3e`).
 * Implements exact verified rules from `data/mighty-blade/{rules,races,classes,conditions}.json`:
 * - Base 60 PV / 60 PM at level 1 + race bonuses + level evolution bonuses
 * - Esquiva = (5 ou 6 se Pequeno) + Agilidade + bônus
 * - Bloqueio = (5 ou 6 se Pequeno) + Força + Armadura + Escudo + bônus
 * - Defesa Efetiva = max(Esquiva, Bloqueio)
 * - Determinação = 8 + max(Inteligência, Vontade) + bônus
 * - Deslocamento = floor(Agilidade / 2) + 5m (1 quadrado = 1,5m), Corrida = 2×
 * - Carga = FOR×7 (Básica) / FOR×14 (Pesada) / FOR×21 (Máxima)
 * - FN (Força Necessária): Força < FN => Inapto (rola 1d6 em vez de 2d6)
 * - Crítico: todos os dados = 6 (sucesso automático + dano ×2)
 * - Falha Crítica: todos os dados = 1 (erro automático)
 * - Descanso Curto (+5 PV/PM) e Longo (+30 PV/PM), Morte (-10 PV) e Inconsciente (0 PV)
 */

import manifestJson from "./manifest.json";
import schemaJson from "./schema.json";
import {
  findClass,
  findCondition,
  findRace,
  getMightyBladeContent,
  mbClasses,
  mbConditions,
  mbRaces,
  mbRules,
} from "./compendium";
import { interpolateFormula } from "../sandbox";
import type {
  ActiveCondition,
  Character,
  CharacterAbilityEntry,
  CharacterEquipmentEntry,
  CharacterSpellEntry,
  CompendiumCategory,
  InteractiveAction,
  MightyBladeAttributes,
  MightyBladeSystemData,
  MightyBladeWizardInput,
  RollEvaluation,
  RollPlan,
  RollResult,
  RpgSystemEngine,
  SystemManifest,
  SystemSchema,
} from "../types";

const ATTR_LABELS: Record<keyof MightyBladeAttributes, string> = {
  forca: "Força",
  agilidade: "Agilidade",
  inteligencia: "Inteligência",
  vontade: "Vontade",
};

const STARTER_ITEM_DEFAULTS: Array<{
  match: RegExp;
  item: Omit<CharacterEquipmentEntry, "id" | "quantity">;
}> = [
  { match: /espada longa/i, item: { name: "Espada Longa", category: "weapon", equipped: true, fn: 3, damageBonus: 3, damageAttribute: "forca", damageType: "Corte", weight: 2, range: "Corpo a corpo" } },
  { match: /machado grande/i, item: { name: "Machado Grande", category: "weapon", equipped: true, fn: 4, damageBonus: 5, damageAttribute: "forca", damageType: "Corte", weight: 4, range: "Corpo a corpo", properties: ["Duas Mãos"] } },
  { match: /machado de batalha/i, item: { name: "Machado de Batalha", category: "weapon", equipped: true, fn: 3, damageBonus: 4, damageAttribute: "forca", damageType: "Corte", weight: 2.5, range: "Corpo a corpo" } },
  { match: /martelo de guerra/i, item: { name: "Martelo de Guerra", category: "weapon", equipped: true, fn: 3, damageBonus: 4, damageAttribute: "forca", damageType: "Contusão", weight: 3, range: "Corpo a corpo" } },
  { match: /rapieira|florete/i, item: { name: "Rapieira", category: "weapon", equipped: true, fn: 2, damageBonus: 3, damageAttribute: "agilidade", damageType: "Perfuração", weight: 1.5, range: "Corpo a corpo", properties: ["Ágil"] } },
  { match: /arco longo/i, item: { name: "Arco Longo", category: "weapon", equipped: true, fn: 3, damageBonus: 4, damageAttribute: "agilidade", damageType: "Perfuração", weight: 1.5, range: "Distância (30m)" } },
  { match: /arco curto/i, item: { name: "Arco Curto", category: "weapon", equipped: true, fn: 2, damageBonus: 3, damageAttribute: "agilidade", damageType: "Perfuração", weight: 1, range: "Distância (20m)" } },
  { match: /adaga|punhal/i, item: { name: "Adaga", category: "weapon", equipped: true, fn: 1, damageBonus: 2, damageAttribute: "agilidade", damageType: "Perfuração", weight: 0.5, range: "Corpo a corpo / Arremesso" } },
  { match: /cajado|bord[aã]o/i, item: { name: "Cajado Arcano", category: "weapon", equipped: true, fn: 1, damageBonus: 2, damageAttribute: "forca", damageType: "Contusão", weight: 1.5, range: "Corpo a corpo" } },
  { match: /ma[cç]a/i, item: { name: "Maça", category: "weapon", equipped: true, fn: 2, damageBonus: 3, damageAttribute: "forca", damageType: "Contusão", weight: 2, range: "Corpo a corpo" } },
  { match: /escudo de torre|escudo grande/i, item: { name: "Escudo Grande", category: "shield", equipped: true, fn: 4, defenseBonus: 3, weight: 5 } },
  { match: /escudo m[eé]dio/i, item: { name: "Escudo Médio", category: "shield", equipped: true, fn: 2, defenseBonus: 2, weight: 3 } },
  { match: /escudo leve|broquel/i, item: { name: "Escudo Leve", category: "shield", equipped: true, fn: 1, defenseBonus: 1, weight: 1.5 } },
  { match: /armadura de placas|completa/i, item: { name: "Armadura de Placas", category: "armor", equipped: true, fn: 5, defenseBonus: 5, agilityPenalty: 2, weight: 18 } },
  { match: /cota de malha/i, item: { name: "Cota de Malha", category: "armor", equipped: true, fn: 3, defenseBonus: 3, agilityPenalty: 1, weight: 10 } },
  { match: /couro batido/i, item: { name: "Armadura de Couro Batido", category: "armor", equipped: true, fn: 2, defenseBonus: 2, agilityPenalty: 0, weight: 5 } },
  { match: /couro|gib[aã]o de peles/i, item: { name: "Armadura de Couro", category: "armor", equipped: true, fn: 1, defenseBonus: 1, agilityPenalty: 0, weight: 3.5 } },
  { match: /po[cç][aã]o de cura/i, item: { name: "Poção de Cura Menor", category: "consumable", equipped: false, weight: 0.3, effect: { healPv: 20 }, description: "Recupera 20 PV ao ser ingerida." } },
  { match: /po[cç][aã]o de mana/i, item: { name: "Poção de Mana Menor", category: "consumable", equipped: false, weight: 0.3, effect: { healPm: 20 }, description: "Recupera 20 PM ao ser ingerida." } },
];

function readMBData(character: Character): MightyBladeSystemData {
  const raw = (character.systemData ?? {}) as Partial<MightyBladeSystemData>;
  const attrs = raw.attributes ?? { forca: 3, agilidade: 3, inteligencia: 3, vontade: 3 };
  return {
    raceId: raw.raceId ?? "humano",
    raceName: raw.raceName ?? findRace(raw.raceId ?? "humano")?.name ?? "Humano",
    classId: raw.classId ?? "guerreiro",
    className: raw.className ?? findClass(raw.classId ?? "guerreiro")?.name ?? "Guerreiro",
    level: Math.max(1, Math.min(10, Number(raw.level ?? 1))),
    xp: Math.max(0, Number(raw.xp ?? 0)),
    attributes: {
      forca: Number(attrs.forca ?? 3),
      agilidade: Number(attrs.agilidade ?? 3),
      inteligencia: Number(attrs.inteligencia ?? 3),
      vontade: Number(attrs.vontade ?? 3),
    },
    pvBonus: Number(raw.pvBonus ?? 0),
    pmBonus: Number(raw.pmBonus ?? 0),
    defenseBonus: Number(raw.defenseBonus ?? 0),
    movementModifier: Number(raw.movementModifier ?? 0),
    size: raw.size,
    money: Number(raw.money ?? mbRules.characterCreation.startingGold),
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    abilities: Array.isArray(raw.abilities) ? raw.abilities : [],
    spells: Array.isArray(raw.spells) ? raw.spells : [],
    languages: Array.isArray(raw.languages) ? raw.languages : ["Comum"],
    background: raw.background ?? "",
    notes: raw.notes ?? "",
  };
}

function formatMod(value: number): string {
  if (value === 0) return "";
  return value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
}

function resolveStarterEquipment(names: string[]): CharacterEquipmentEntry[] {
  const content = getMightyBladeContent();
  const weaponsByLen = [...content.equipment.weapons].sort((a, b) => b.name.length - a.name.length);
  const armorByLen = [...content.equipment.armor].sort((a, b) => b.name.length - a.name.length);
  const gearByLen = [...content.equipment.gear].sort((a, b) => b.name.length - a.name.length);
  const items: CharacterEquipmentEntry[] = [];
  let idx = 1;

  for (const label of names) {
    // Prefer the primary choice before "(ou ...)" so e.g. "Armadura de Couro Batido (ou Cota de Malha)" picks Couro Batido.
    const primary = label.split("(")[0].trim();
    const norm = primary.toLowerCase();

    // 1. Try matching against loaded equipment.json (longest name first)
    const matchedWeapon = weaponsByLen.find((w) => norm.includes(w.name.toLowerCase()));
    if (matchedWeapon) {
      items.push({
        id: `eq-${idx++}`,
        itemId: matchedWeapon.id,
        name: matchedWeapon.name,
        category: "weapon",
        equipped: true,
        quantity: 1,
        fn: matchedWeapon.fn,
        damageBonus: matchedWeapon.damageBonus,
        damageAttribute: matchedWeapon.damageAttribute ?? "forca",
        damageType: matchedWeapon.damageType,
        weight: matchedWeapon.weight ?? 2,
        range: matchedWeapon.range ?? matchedWeapon.distance ?? "Corpo a corpo",
        properties: matchedWeapon.properties,
        description: matchedWeapon.description,
      });
      continue;
    }

    const matchedArmor = armorByLen.find((a) => norm.includes(a.name.toLowerCase()));
    if (matchedArmor) {
      items.push({
        id: `eq-${idx++}`,
        itemId: matchedArmor.id,
        name: matchedArmor.name,
        category: matchedArmor.slot === "shield" ? "shield" : "armor",
        equipped: true,
        quantity: 1,
        fn: matchedArmor.fn,
        defenseBonus: matchedArmor.defenseBonus,
        agilityPenalty: matchedArmor.agilityPenalty ?? matchedArmor.dodgePenalty ?? 0,
        rd: matchedArmor.rd ?? 0,
        weight: matchedArmor.weight ?? 4,
        properties: matchedArmor.properties,
        description: matchedArmor.description,
      });
      continue;
    }

    const matchedGear = gearByLen.find((g) => norm.includes(g.name.toLowerCase()));
    if (matchedGear) {
      items.push({
        id: `eq-${idx++}`,
        itemId: matchedGear.id,
        name: matchedGear.name,
        category: matchedGear.consumable ? "consumable" : "gear",
        equipped: false,
        quantity: 1,
        weight: matchedGear.weight ?? 1,
        effect: matchedGear.effect,
        description: matchedGear.description,
      });
      continue;
    }

    // 2. Fallback to built-in MB 3e defaults table
    const fallback = STARTER_ITEM_DEFAULTS.find((entry) => entry.match.test(primary));
    if (fallback) {
      items.push({
        id: `eq-${idx++}`,
        quantity: 1,
        ...fallback.item,
      });
      continue;
    }

    // 3. Generic adventure gear item
    items.push({
      id: `eq-${idx++}`,
      name: label,
      category: "gear",
      equipped: false,
      quantity: 1,
      weight: 1,
    });
  }

  return items;
}

export const mightyBlade3eEngine: RpgSystemEngine = {
  manifest: manifestJson as SystemManifest,
  schema: schemaJson as SystemSchema,

  computeDerivedStats(character: Character) {
    const data = readMBData(character);
    const race = findRace(data.raceId);
    const cls = findClass(data.classId);

    // Aggregate active condition modifiers from official conditions.json
    let defenseDelta = 0;
    let attackDelta = 0;
    let attackDiceMod = 0;
    let testDelta = 0;
    let testDiceMod = 0;
    let conditionDamageBonus = 0;
    let conditionForcaBonus = 0;
    let moveDelta = 0;
    let moveMultiplier = 1;
    let skipTurn = false;
    let cannotCastSpells = false;
    let cannotReact = false;

    for (const active of character.conditions ?? []) {
      const def = findCondition(active.id);
      if (!def?.modifiers) continue;
      const m = def.modifiers;
      if (typeof m.defenseDelta === "number") defenseDelta += m.defenseDelta;
      if (typeof m.attackDelta === "number") attackDelta += m.attackDelta;
      if (typeof m.attackDiceMod === "number") attackDiceMod += m.attackDiceMod;
      if (typeof m.testDelta === "number") testDelta += m.testDelta;
      if (typeof m.testDiceMod === "number") testDiceMod += m.testDiceMod;
      if (typeof m.damageBonus === "number") conditionDamageBonus += m.damageBonus;
      if (typeof m.forcaBonus === "number") conditionForcaBonus += m.forcaBonus;
      if (typeof m.moveDelta === "number") moveDelta += m.moveDelta;
      if (typeof m.moveMultiplier === "number") moveMultiplier *= m.moveMultiplier;
      if (m.skipTurn) skipTurn = true;
      if (m.cannotCastSpells) cannotCastSpells = true;
      if (m.cannotReact) cannotReact = true;
    }

    const effForca = data.attributes.forca + conditionForcaBonus;
    const effAgi = data.attributes.agilidade;
    const effInt = data.attributes.inteligencia;
    const effVon = data.attributes.vontade;

    // Class & racial passive automation effects
    const clsAuto = (cls?.automaticAbility?.automationEffect ?? {}) as Record<string, unknown>;
    const raceAuto = (race?.racialAbility?.automationEffect ?? {}) as Record<string, unknown>;

    const classAttackBonus = typeof clsAuto.attackBonus === "number" ? clsAuto.attackBonus : 0;
    const classDamageBonus = typeof clsAuto.damageBonus === "number" ? clsAuto.damageBonus : 0;
    const classDetBonus = typeof clsAuto.determinacaoBonus === "number" ? clsAuto.determinacaoBonus : 0;
    const raceInitBonus = typeof raceAuto.initiativeBonus === "number" ? raceAuto.initiativeBonus : 0;

    // Ability passive bonuses
    let abilityDefenseBonus = 0;
    let abilityPvBonus = 0;
    let abilityPmBonus = 0;
    for (const ab of data.abilities) {
      const auto = (ab.automation ?? {}) as Record<string, unknown>;
      if (typeof auto.defenseBonus === "number" && (ab.category === "suporte" || ab.category === "caracteristica")) {
        abilityDefenseBonus += auto.defenseBonus;
      }
      if (typeof auto.pvBonus === "number") abilityPvBonus += auto.pvBonus;
      if (typeof auto.pmBonus === "number") abilityPmBonus += auto.pmBonus;
    }

    // Equipment: armor, shields, total carried weight, FN checks
    let armorBonus = 0;
    let shieldBonus = 0;
    let agilityPenalty = 0;
    let totalWeight = 0;
    let fnArmorInapto = false;

    for (const item of data.inventory) {
      totalWeight += (item.weight ?? 0) * Math.max(1, item.quantity ?? 1);
      if (!item.equipped) continue;
      if (item.category === "armor") {
        armorBonus += item.defenseBonus ?? 0;
        agilityPenalty += item.agilityPenalty ?? 0;
        if (typeof item.fn === "number" && effForca < item.fn) {
          fnArmorInapto = true;
        }
      } else if (item.category === "shield") {
        shieldBonus += item.defenseBonus ?? 0;
        if (typeof item.fn === "number" && effForca < item.fn) {
          fnArmorInapto = true;
        }
      }
    }

    // Load capacity (Carga): Básica = FOR*7, Pesada = FOR*14, Máxima = FOR*21
    const cargaBasica = effForca * 7;
    const cargaPesada = effForca * 14;
    const cargaMaxima = effForca * 21;
    let cargaStatus: "basica" | "pesada" | "maxima" = "basica";
    if (totalWeight > cargaPesada) {
      cargaStatus = "maxima";
    } else if (totalWeight > cargaBasica) {
      cargaStatus = "pesada";
      moveMultiplier *= 0.5;
    }

    // Base Defense: 5 default, 6 for Small races (race.baseDefenseOverride)
    const size = data.size ?? race?.size ?? "Médio";
    const baseDefense =
      race?.baseDefenseOverride ??
      (size === "Pequeno" ? mbRules.derivedStats.esquiva.smallSizeBase : mbRules.derivedStats.esquiva.baseDefault);

    const esquiva = Math.max(
      0,
      baseDefense + effAgi - agilityPenalty + (data.defenseBonus ?? 0) + abilityDefenseBonus + defenseDelta
    );
    const bloqueio = Math.max(
      0,
      baseDefense + effForca + armorBonus + shieldBonus + (data.defenseBonus ?? 0) + abilityDefenseBonus + defenseDelta
    );
    const defesa = Math.max(esquiva, bloqueio);
    const determinacao = Math.max(0, 8 + Math.max(effInt, effVon) + classDetBonus);

    // Movement: floor(AGI / 2) + 5 + race.movementModifier + data.movementModifier + moveDelta
    const baseMoveMeters =
      Math.floor(effAgi / 2) +
      mbRules.derivedStats.deslocamento.baseMeters +
      (race?.movementModifier ?? 0) +
      (data.movementModifier ?? 0) +
      moveDelta;
    const deslocamento =
      cargaStatus === "maxima" || moveMultiplier <= 0
        ? 0
        : Math.max(1, Math.floor(baseMoveMeters * moveMultiplier));
    const deslocamentoQuadrados =
      deslocamento <= 0
        ? 0
        : Math.max(1, Math.floor(deslocamento / mbRules.derivedStats.deslocamento.gridSquareMeters));
    const corrida = cargaStatus === "basica" && moveMultiplier >= 1 ? deslocamento * 2 : 0;

    // Resource maximums: 60 base PV / 60 base PM + race + evolution/ability bonuses
    const pvMax = Math.max(
      1,
      mbRules.derivedStats.pv.base + (race?.pvBonus ?? 0) + (data.pvBonus ?? 0) + abilityPvBonus
    );
    const pmMax = Math.max(
      0,
      mbRules.derivedStats.pm.base + (race?.pmBonus ?? 0) + (data.pmBonus ?? 0) + abilityPmBonus
    );

    // Pre-computed weapon attack summaries for 1-click UI buttons
    const equippedWeapons = data.inventory
      .filter((i) => i.category === "weapon" && i.equipped !== false)
      .map((w) => {
        const rollAttr: keyof MightyBladeAttributes = w.damageAttribute ?? "forca";
        const attrVal = rollAttr === "forca" ? effForca : data.attributes[rollAttr];
        const inaptoByFn = typeof w.fn === "number" && effForca < w.fn;
        const inapto = inaptoByFn || fnArmorInapto || attackDiceMod < 0;
        const diceCount = inapto ? 1 : Math.max(1, 2 + Math.max(0, attackDiceMod));
        const totalAttackMod = attrVal + classAttackBonus + attackDelta;
        const baseDamage = Math.max(1, attrVal + (w.damageBonus ?? 0) + classDamageBonus + conditionDamageBonus);
        return {
          id: w.id,
          name: w.name,
          rollAttr,
          diceCount,
          inapto,
          fn: w.fn ?? 0,
          attackFormula: `${diceCount}d6${formatMod(totalAttackMod)}`,
          baseDamage,
          damageType: w.damageType ?? "Corte",
          range: w.range ?? "Corpo a corpo",
        };
      });

    const curPv = character.resources?.pv?.current ?? pvMax;

    return {
      computed: {
        esquiva,
        bloqueio,
        defesa,
        determinacao,
        deslocamento,
        deslocamentoQuadrados,
        corrida,
        iniciativaBonus: effAgi + raceInitBonus,
        cargaAtual: Number(totalWeight.toFixed(1)),
        cargaBasica,
        cargaPesada,
        cargaMaxima,
        cargaStatus,
        armorBonus,
        shieldBonus,
        fnArmorInapto,
        attackDelta: classAttackBonus + attackDelta,
        testDelta,
        testDiceMod: fnArmorInapto ? Math.min(-1, testDiceMod) : testDiceMod,
        attackDiceMod,
        skipTurn,
        cannotCastSpells,
        cannotReact,
        inconsciente: curPv <= 0,
        morto: curPv <= mbRules.combat.deathAndUnconsciousness.deathThresholdPv,
        spellcastingAttribute: cls?.spellcastingAttribute ?? (effInt >= effVon ? "inteligencia" : "vontade"),
        equippedWeapons,
      },
      resourceMax: { pv: pvMax, pm: pmMax },
    };
  },

  createCharacterFromWizard(rawInput: Record<string, unknown>) {
    const input = rawInput as unknown as MightyBladeWizardInput;
    const race = findRace(input.raceId) ?? mbRaces[0];
    const cls = findClass(input.classId) ?? mbClasses[0];
    const content = getMightyBladeContent();

    const attrs: MightyBladeAttributes = {
      forca: race.attributes.forca + cls.attributeBonuses.forca,
      agilidade: race.attributes.agilidade + cls.attributeBonuses.agilidade,
      inteligencia: race.attributes.inteligencia + cls.attributeBonuses.inteligencia,
      vontade: race.attributes.vontade + cls.attributeBonuses.vontade,
    };

    // Apply racial free points (e.g. Humano extraPoints = 1) safely capped to race.extraPoints
    if (input.freeAttributePoints && race.extraPoints > 0) {
      let remaining = race.extraPoints;
      for (const key of ["forca", "agilidade", "inteligencia", "vontade"] as const) {
        const add = Math.max(0, Math.floor(Number(input.freeAttributePoints[key] ?? 0)));
        const applied = Math.min(remaining, add);
        attrs[key] += applied;
        remaining -= applied;
      }
    }

    // Automatic racial + class abilities
    const abilities: CharacterAbilityEntry[] = [
      {
        id: race.racialAbility.id,
        abilityId: race.racialAbility.id,
        name: `${race.racialAbility.name} (Racial)`,
        category: "suporte",
        manaCost: race.racialAbility.costPm,
        description: race.racialAbility.description,
        automation: race.racialAbility.automationEffect,
      },
      {
        id: cls.automaticAbility.id,
        abilityId: cls.automaticAbility.id,
        name: `${cls.automaticAbility.name} (Classe)`,
        category: cls.automaticAbility.costPm > 0 ? "acao" : "suporte",
        manaCost: cls.automaticAbility.costPm,
        description: cls.automaticAbility.description,
        automation: cls.automaticAbility.automationEffect,
      },
    ];

    // Add selected abilities from compendium
    for (const abId of input.selectedAbilityIds ?? []) {
      const found = content.abilities.find((a) => a.id === abId || a.name === abId);
      if (found) {
        abilities.push({
          id: found.id,
          abilityId: found.id,
          name: found.name,
          category: found.category,
          manaCost: found.manaCost ?? 0,
          difficulty: found.difficulty,
          range: found.range,
          duration: found.duration,
          description: found.description,
          automation: found.automation,
        });
      }
    }

    // Add selected spells from compendium
    const spells: CharacterSpellEntry[] = [];
    for (const spId of input.selectedSpellIds ?? []) {
      const found = content.spells.find((s) => s.id === spId || s.name === spId);
      if (found) {
        spells.push({
          id: found.id,
          spellId: found.id,
          name: found.name,
          path: found.path,
          type: found.type,
          manaCost: found.manaCost,
          difficulty: found.difficulty,
          range: found.range,
          duration: found.duration,
          description: found.description,
          automation: found.automation,
        });
      }
    }

    const inventory = resolveStarterEquipment(cls.startingEquipment ?? []);
    const name = String(input.name ?? `${race.name} ${cls.name}`).trim() || "Novo Herói";
    const portraitUrl = input.portraitUrl || cls.suggestedPortrait || race.suggestedPortrait || "./assets/portraits/human-warrior.svg";

    const systemData: MightyBladeSystemData = {
      raceId: race.id,
      raceName: race.name,
      classId: cls.id,
      className: cls.name,
      level: 1,
      xp: 0,
      attributes: attrs,
      pvBonus: 0,
      pmBonus: 0,
      defenseBonus: 0,
      movementModifier: 0,
      size: race.size,
      money: cls.startingGold ?? mbRules.characterCreation.startingGold,
      inventory,
      abilities,
      spells,
      languages: race.languages,
      background: input.background ?? "",
      notes: "",
    };

    const draft: Character = {
      id: "",
      campaignId: "",
      systemId: "mighty-blade-3e",
      kind: "pc",
      name,
      subtitle: `${cls.name} ${race.name} · Nível 1`,
      portraitUrl,
      ownerUserId: input.ownerUserId ?? null,
      controlledByUserIds: input.ownerUserId ? [input.ownerUserId] : [],
      visibility: "all_players",
      resources: {
        pv: { current: 60 + race.pvBonus, max: 60 + race.pvBonus },
        pm: { current: 60 + race.pmBonus, max: 60 + race.pmBonus },
      },
      conditions: [],
      systemData: systemData as unknown as Record<string, unknown>,
      computed: {},
      updatedAt: "",
    };

    const { computed, resourceMax } = this.computeDerivedStats(draft);
    draft.computed = computed;
    draft.resources = {
      pv: { current: resourceMax.pv, max: resourceMax.pv },
      pm: { current: resourceMax.pm, max: resourceMax.pm },
    };

    const { id: _id, campaignId: _cid, updatedAt: _u, ...result } = draft;
    return result;
  },

  buildRollRequest(character, request) {
    switch (request.kind) {
      case "attribute":
        return this.planAttributeCheck(character, request.key ?? "forca", {
          bonus: request.bonus,
          difficulty: request.difficulty,
          label: request.label,
        });
      case "attack":
        return this.planAttack(character, request.itemId ?? "", request.target);
      case "ability":
        return this.planAbility(character, request.itemId ?? "", request.target);
      case "spell":
        return this.planSpell(character, request.itemId ?? "", request.target);
      case "initiative":
        return this.planInitiative(character);
      default: {
        const formula = interpolateFormula(request.formula ?? "2d6", {
          character,
          target: request.target,
        });
        return {
          formula,
          label: request.label ?? "Rolagem",
          difficulty: request.difficulty,
          targetCharacterId: request.target?.id,
          targetName: request.target?.name,
          systemMeta: { systemId: "mighty-blade-3e", kind: "custom" },
        };
      }
    }
  },

  planAttributeCheck(character, attrKey, opts) {
    const data = readMBData(character);
    const { computed } = this.computeDerivedStats(character);
    const key = (attrKey in data.attributes ? attrKey : "forca") as keyof MightyBladeAttributes;
    const attrVal = data.attributes[key];
    const testDelta = Number(computed.testDelta ?? 0);
    const testDiceMod = Number(computed.testDiceMod ?? 0);
    const diceCount = testDiceMod < 0 ? 1 : 2 + Math.max(0, testDiceMod);
    const mod = attrVal + (opts?.bonus ?? 0) + testDelta;

    return {
      formula: `${diceCount}d6${formatMod(mod)}`,
      label: opts?.label ?? `Teste de ${ATTR_LABELS[key]}${diceCount === 1 ? " (Inapto)" : ""}`,
      difficulty: opts?.difficulty,
      systemMeta: {
        systemId: "mighty-blade-3e",
        kind: "attribute",
        attrKey: key,
        inapto: diceCount === 1,
        difficulty: opts?.difficulty,
      },
    };
  },

  planAttack(character, weaponId, target) {
    const data = readMBData(character);
    const { computed } = this.computeDerivedStats(character);
    const weapons = (computed.equippedWeapons as Array<{
      id: string;
      name: string;
      rollAttr: keyof MightyBladeAttributes;
      diceCount: number;
      inapto: boolean;
      attackFormula: string;
      baseDamage: number;
      damageType: string;
    }>) ?? [];

    const selected = weapons.find((w) => w.id === weaponId) ?? weapons[0];
    const targetDefense =
      typeof target?.computed?.defesa === "number"
        ? target.computed.defesa
        : typeof target?.computed?.bloqueio === "number"
          ? Math.max(Number(target.computed.bloqueio), Number(target.computed.esquiva ?? 0))
          : undefined;

    if (selected) {
      return {
        formula: selected.attackFormula,
        label: `Ataque · ${selected.name}${selected.inapto ? " (Inapto — FN)" : ""}`,
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
        damageType: selected.damageType,
        systemMeta: {
          systemId: "mighty-blade-3e",
          kind: "attack",
          weaponId: selected.id,
          weaponName: selected.name,
          inapto: selected.inapto,
          baseDamage: selected.baseDamage,
          damageType: selected.damageType,
          targetCharacterId: target?.id,
          targetDefense,
          targetName: target?.name,
        },
      };
    }

    // Unarmed attack fallback
    const mod = data.attributes.forca + Number(computed.attackDelta ?? 0);
    const baseDamage = Math.max(1, data.attributes.forca + 1);
    return {
      formula: `2d6${formatMod(mod)}`,
      label: "Ataque Desarmado",
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
      damageType: "Contusão",
      systemMeta: {
        systemId: "mighty-blade-3e",
        kind: "attack",
        baseDamage,
        damageType: "Contusão",
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
      },
    };
  },

  planAbility(character, abilityId, target) {
    const data = readMBData(character);
    const content = getMightyBladeContent();
    const ability =
      data.abilities.find((a) => a.id === abilityId || a.abilityId === abilityId) ??
      content.abilities.find((a) => a.id === abilityId);

    const auto = (ability?.automation ?? {}) as Record<string, unknown>;
    const attrKey = (auto.rollAttribute as keyof MightyBladeAttributes | undefined) ?? "forca";
    const attrVal = data.attributes[attrKey] ?? data.attributes.forca;
    const rollBonus = typeof auto.rollBonus === "number" ? auto.rollBonus : 0;
    const targetDefense =
      typeof target?.computed?.defesa === "number" ? target.computed.defesa : undefined;

    const damageFormula =
      typeof auto.damageFormula === "string"
        ? interpolateFormula(auto.damageFormula, { character, target })
        : undefined;
    const healFormula =
      typeof auto.healFormula === "string"
        ? interpolateFormula(auto.healFormula, { character, target })
        : undefined;

    return {
      formula: `2d6${formatMod(attrVal + rollBonus)}`,
      label: ability ? `Habilidade · ${ability.name}` : "Habilidade",
      difficulty: ability?.difficulty,
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
      manaCost: ability?.manaCost ?? 0,
      damageFormula,
      damageType: typeof auto.damageType === "string" ? auto.damageType : undefined,
      healFormula,
      appliesCondition: typeof auto.appliesCondition === "string" ? auto.appliesCondition : undefined,
      systemMeta: {
        systemId: "mighty-blade-3e",
        kind: "ability",
        abilityId: ability?.id ?? abilityId,
        manaCost: ability?.manaCost ?? 0,
        difficulty: ability?.difficulty,
        damageFormula,
        damageType: auto.damageType,
        healFormula,
        appliesCondition: auto.appliesCondition,
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
      },
    };
  },

  planSpell(character, spellId, target) {
    const data = readMBData(character);
    const { computed } = this.computeDerivedStats(character);
    const content = getMightyBladeContent();
    const spell =
      data.spells.find((s) => s.id === spellId || s.spellId === spellId) ??
      content.spells.find((s) => s.id === spellId);

    const auto = (spell?.automation ?? {}) as Record<string, unknown>;
    const castAttr =
      (auto.rollAttribute as keyof MightyBladeAttributes | undefined) ??
      (computed.spellcastingAttribute as keyof MightyBladeAttributes) ??
      "inteligencia";
    const attrVal = data.attributes[castAttr] ?? data.attributes.inteligencia;
    const blocked = Boolean(computed.cannotCastSpells);
    const targetDefense =
      auto.targetType === "single" || auto.targetType === "area"
        ? typeof target?.computed?.determinacao === "number"
          ? target.computed.determinacao
          : typeof target?.computed?.defesa === "number"
            ? target.computed.defesa
            : undefined
        : undefined;

    const damageFormula =
      typeof auto.damageFormula === "string"
        ? interpolateFormula(auto.damageFormula, { character, target })
        : undefined;
    const healFormula =
      typeof auto.healFormula === "string"
        ? interpolateFormula(auto.healFormula, { character, target })
        : undefined;

    return {
      formula: `2d6${formatMod(attrVal)}`,
      label: `Magia · ${spell?.name ?? spellId}${blocked ? " (Impedido por Condição!)" : ""}`,
      difficulty: spell?.difficulty ?? 10,
      targetCharacterId: target?.id,
      targetDefense,
      targetName: target?.name,
      manaCost: spell?.manaCost ?? 0,
      damageFormula,
      damageType: typeof auto.damageType === "string" ? auto.damageType : "Mágico",
      healFormula,
      appliesCondition: typeof auto.appliesCondition === "string" ? auto.appliesCondition : undefined,
      systemMeta: {
        systemId: "mighty-blade-3e",
        kind: "spell",
        spellId: spell?.id ?? spellId,
        manaCost: spell?.manaCost ?? 0,
        difficulty: spell?.difficulty ?? 10,
        damageFormula,
        damageType: auto.damageType ?? "Mágico",
        healFormula,
        appliesCondition: auto.appliesCondition,
        cannotCastSpells: blocked,
        targetCharacterId: target?.id,
        targetDefense,
        targetName: target?.name,
      },
    };
  },

  planInitiative(character) {
    const { computed } = this.computeDerivedStats(character);
    const initBonus = Number(computed.iniciativaBonus ?? 0);
    return {
      formula: `2d6${formatMod(initBonus)}`,
      label: "Iniciativa",
      systemMeta: {
        systemId: "mighty-blade-3e",
        kind: "initiative",
      },
    };
  },

  resolveRollOutcome(roll, _actor, target) {
    const meta = (roll.systemMeta ?? {}) as Record<string, unknown>;
    const activeDice = roll.dice.filter((d) => !d.dropped);
    const allD6 = activeDice.length > 0 && activeDice.every((d) => d.sides === 6);

    // Mighty Blade 3e rules.json:
    // - Critical Hit: all rolled dice show 6 (standard 6+6 on 2d6) -> autoSuccess + 2x damage
    // - Critical Failure: all rolled dice show 1 (1+1 on 2d6, or 1 on 1d6 when Inapto) -> autoFailure
    const isCritical = allD6 && activeDice.length >= 2 && activeDice.every((d) => d.value === 6);
    const isFumble = allD6 && activeDice.every((d) => d.value === 1);

    const targetDefense =
      typeof meta.targetDefense === "number"
        ? meta.targetDefense
        : typeof roll.outcome?.targetDefense === "number"
          ? roll.outcome.targetDefense
          : undefined;
    const difficulty =
      typeof meta.difficulty === "number"
        ? meta.difficulty
        : typeof roll.outcome?.difficulty === "number"
          ? roll.outcome.difficulty
          : undefined;
    const threshold = targetDefense ?? difficulty;
    const targetName =
      target?.name ?? (typeof meta.targetName === "string" ? meta.targetName : roll.outcome?.targetName);
    const targetId =
      target?.id ?? (typeof meta.targetCharacterId === "string" ? meta.targetCharacterId : undefined);

    let outcome: RollEvaluation["outcome"];
    if (isCritical) {
      outcome = {
        kind: "critical",
        badgeText: "CRÍTICO! (6+6 · Sucesso Automático · Dano ×2)",
        difficulty,
        targetDefense,
        targetName,
        margin: threshold !== undefined ? Math.max(0, roll.total - threshold) : undefined,
      };
    } else if (isFumble) {
      outcome = {
        kind: "fumble",
        badgeText: activeDice.length === 1 ? "FALHA CRÍTICA! (1 — Inapto)" : "FALHA CRÍTICA! (1+1)",
        difficulty,
        targetDefense,
        targetName,
      };
    } else if (threshold !== undefined) {
      const passed = roll.total >= threshold;
      const labelVs = targetDefense !== undefined ? `Defesa ${targetDefense}` : `Dif. ${difficulty}`;
      outcome = {
        kind: passed ? "success" : "failure",
        badgeText: passed
          ? `${targetDefense !== undefined ? "ACERTO" : "SUCESSO"} (${roll.total} vs ${labelVs})`
          : `${targetDefense !== undefined ? "ERROU" : "FALHA"} (${roll.total} vs ${labelVs})`,
        difficulty,
        targetDefense,
        targetName,
        margin: roll.total - threshold,
      };
    } else {
      outcome = {
        kind: "info",
        badgeText: `Resultado: ${roll.total}`,
      };
    }

    // Build 1-click interactive combat/spell action buttons for the Chat RollCard
    const actions: InteractiveAction[] = [];

    const manaCost = typeof meta.manaCost === "number" ? meta.manaCost : 0;
    if (manaCost > 0) {
      actions.push({
        id: `spend-pm-${roll.rollId}`,
        label: `Gastar ${manaCost} PM`,
        style: "mana",
        actionType: "spend_mana",
        payload: { resource: "pm", amount: manaCost },
      });
    }

    const succeeded = outcome.kind === "critical" || outcome.kind === "success" || outcome.kind === "info";

    // Fixed Mighty Blade attack damage (doubled on Critical!)
    if (succeeded && typeof meta.baseDamage === "number" && meta.baseDamage > 0) {
      const multiplier = isCritical ? mbRules.coreRollMechanic.criticalHit.damageMultiplier : 1;
      const finalDamage = meta.baseDamage * multiplier;
      const dmgType = typeof meta.damageType === "string" ? meta.damageType : "Físico";
      actions.push({
        id: `apply-dmg-${roll.rollId}`,
        label: `Aplicar ${finalDamage} de Dano${isCritical ? " (×2 Crítico)" : ""}${targetName ? ` em ${targetName}` : ""}`,
        style: "damage",
        actionType: "apply_damage",
        targetCharacterId: targetId,
        payload: { amount: finalDamage, damageType: dmgType, critical: isCritical },
      });
    }

    // Formula-based or fixed-number spell/ability damage (supports "6", "weapon + 6", "2d6 + 4")
    if (succeeded && typeof meta.damageFormula === "string" && meta.damageFormula.trim()) {
      const rawDmg = meta.damageFormula.trim();
      const multiplier = isCritical ? mbRules.coreRollMechanic.criticalHit.damageMultiplier : 1;
      const dmgType = typeof meta.damageType === "string" ? meta.damageType : "Mágico";
      let resolvedFixed: number | null = null;

      if (/^\d+$/.test(rawDmg)) {
        resolvedFixed = Number(rawDmg);
      } else {
        const weaponMatch = rawDmg.match(/^weapon(?:\s*\+\s*(\d+))?$/i);
        if (weaponMatch) {
          const primaryWeaponDmg =
            (
              (_actor?.computed?.equippedWeapons as Array<{ baseDamage?: number }> | undefined)?.[0]
                ?.baseDamage
            ) ?? 5;
          resolvedFixed = primaryWeaponDmg + Number(weaponMatch[1] ?? 0);
        }
      }

      if (resolvedFixed !== null && resolvedFixed > 0) {
        const finalDamage = resolvedFixed * multiplier;
        actions.push({
          id: `apply-dmg-${roll.rollId}`,
          label: `Aplicar ${finalDamage} de Dano${isCritical ? " (×2 Crítico)" : ""}${targetName ? ` em ${targetName}` : ""}`,
          style: "damage",
          actionType: "apply_damage",
          targetCharacterId: targetId,
          payload: { amount: finalDamage, damageType: dmgType, critical: isCritical },
        });
      } else {
        const formula = isCritical ? `(${rawDmg}) * 2` : rawDmg;
        actions.push({
          id: `roll-dmg-${roll.rollId}`,
          label: `Rolar Dano (${rawDmg}${isCritical ? " ×2" : ""})`,
          style: "damage",
          actionType: "roll_followup",
          targetCharacterId: targetId,
          payload: {
            formula: rawDmg,
            label: `Dano · ${roll.label}${isCritical ? " (Crítico ×2)" : ""}`,
            damageType: dmgType,
            criticalMultiplier: multiplier,
            displayFormula: formula,
          },
        });
      }
    }

    // Healing button (fixed number or dice formula)
    if (succeeded && typeof meta.healFormula === "string" && meta.healFormula.trim()) {
      const numericHeal = Number(meta.healFormula);
      if (Number.isFinite(numericHeal) && numericHeal > 0) {
        actions.push({
          id: `apply-heal-${roll.rollId}`,
          label: `Curar ${numericHeal} PV${targetName ? ` em ${targetName}` : ""}`,
          style: "heal",
          actionType: "apply_heal",
          targetCharacterId: targetId,
          payload: { amount: numericHeal },
        });
      } else {
        actions.push({
          id: `roll-heal-${roll.rollId}`,
          label: `Rolar Cura (${meta.healFormula})`,
          style: "heal",
          actionType: "roll_followup",
          targetCharacterId: targetId,
          payload: { formula: meta.healFormula, label: `Cura · ${roll.label}` },
        });
      }
    }

    // Condition button
    if (succeeded && typeof meta.appliesCondition === "string" && meta.appliesCondition) {
      const condDef = findCondition(meta.appliesCondition);
      actions.push({
        id: `apply-cond-${roll.rollId}`,
        label: `Aplicar ${condDef?.name ?? meta.appliesCondition}${targetName ? ` em ${targetName}` : ""}`,
        style: "condition",
        actionType: "apply_condition",
        targetCharacterId: targetId,
        payload: {
          conditionId: meta.appliesCondition,
          rounds: condDef?.defaultTurns,
        },
      });
    }

    return { outcome, actions };
  },

  evaluateRoll(roll, actor, target) {
    return this.resolveRollOutcome(roll, actor, target);
  },

  applyDamage(character, amount) {
    const dmg = Math.max(0, Math.floor(amount));
    const curPv = character.resources?.pv ?? { current: 60, max: 60 };
    const nextPv = curPv.current - dmg;
    const conditions = [...(character.conditions ?? [])];

    if (nextPv <= mbRules.combat.deathAndUnconsciousness.unconsciousAtPv) {
      for (const cid of ["inconsciente", "indefeso"]) {
        if (!conditions.some((c) => c.id === cid)) {
          const def = findCondition(cid);
          conditions.push({
            id: cid,
            name: def?.name ?? cid,
            icon: def?.icon ?? "moon",
          });
        }
      }
    }

    const nextChar: Character = {
      ...character,
      resources: { ...character.resources, pv: { ...curPv, current: nextPv } },
      conditions,
    };
    const { computed } = this.computeDerivedStats(nextChar);
    return {
      resources: nextChar.resources,
      conditions,
      computed,
    };
  },

  applyHealing(character, amount) {
    const heal = Math.max(0, Math.floor(amount));
    const curPv = character.resources?.pv ?? { current: 0, max: 60 };
    const nextPv = Math.min(curPv.max, Math.max(0, curPv.current) + heal);
    const conditions =
      nextPv > 0
        ? (character.conditions ?? []).filter((c) => c.id !== "inconsciente" && c.id !== "indefeso")
        : character.conditions ?? [];

    const nextChar: Character = {
      ...character,
      resources: { ...character.resources, pv: { ...curPv, current: nextPv } },
      conditions,
    };
    const { computed } = this.computeDerivedStats(nextChar);
    return {
      resources: nextChar.resources,
      conditions,
      computed,
    };
  },

  spendMana(character, amount) {
    const cost = Math.max(0, Math.floor(amount));
    const curPm = character.resources?.pm ?? { current: 0, max: 60 };
    if (curPm.current < cost) {
      return {
        error: `PM insuficiente: possui ${curPm.current} PM, necessário ${cost} PM.`,
      };
    }
    return {
      patch: {
        resources: {
          ...character.resources,
          pm: { ...curPm, current: curPm.current - cost },
        },
      },
    };
  },

  applyCondition(character, conditionId, rounds) {
    const def = findCondition(conditionId);
    const entry: ActiveCondition = {
      id: conditionId,
      name: def?.name ?? conditionId,
      icon: def?.icon ?? "alert-circle",
      roundsRemaining: rounds ?? def?.defaultTurns,
    };
    const nextConds = [...(character.conditions ?? []).filter((c) => c.id !== conditionId), entry];
    const nextChar: Character = { ...character, conditions: nextConds };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextConds, computed };
  },

  removeCondition(character, conditionId) {
    const nextConds = (character.conditions ?? []).filter((c) => c.id !== conditionId);
    const nextChar: Character = { ...character, conditions: nextConds };
    const { computed } = this.computeDerivedStats(nextChar);
    return { conditions: nextConds, computed };
  },

  levelUp(character, choices) {
    const data = readMBData(character);
    if (data.level >= mbRules.levelProgression.maxLevel) {
      return {};
    }
    const nextLevel = data.level + 1;
    const row = mbRules.levelProgression.table.find((r) => r.level === nextLevel);

    const nextAttrs: MightyBladeAttributes = { ...data.attributes };
    let pvBonus = data.pvBonus ?? 0;
    let pmBonus = data.pmBonus ?? 0;

    // Evolution points on levels 2, 3, 5, 6, 8, 9 (+10 PV / +10 PM / +5 each)
    if (row && row.evolutionPointsGained > 0) {
      const choiceId = String(choices.evolutionChoice ?? "pv5_pm5");
      const opt =
        mbRules.levelProgression.evolutionChoiceOptions.find((o) => o.id === choiceId) ??
        mbRules.levelProgression.evolutionChoiceOptions[2];
      pvBonus += opt.pv;
      pmBonus += opt.pm;
    }

    // Attribute point on levels 4, 7, 10
    if (row && row.attributePointsGained > 0) {
      const attrKey = String(choices.attributeChoice ?? "forca") as keyof MightyBladeAttributes;
      if (attrKey in nextAttrs) {
        nextAttrs[attrKey] += row.attributePointsGained;
      }
    }

    const nextData: MightyBladeSystemData = {
      ...data,
      level: nextLevel,
      attributes: nextAttrs,
      pvBonus,
      pmBonus,
    };

    const nextChar: Character = {
      ...character,
      subtitle: `${data.className} ${data.raceName} · Nível ${nextLevel}`,
      systemData: nextData as unknown as Record<string, unknown>,
    };

    const { computed, resourceMax } = this.computeDerivedStats(nextChar);
    const curPv = character.resources?.pv ?? { current: resourceMax.pv, max: resourceMax.pv };
    const curPm = character.resources?.pm ?? { current: resourceMax.pm, max: resourceMax.pm };
    const pvDelta = Math.max(0, resourceMax.pv - curPv.max);
    const pmDelta = Math.max(0, resourceMax.pm - curPm.max);

    return {
      subtitle: nextChar.subtitle,
      systemData: nextChar.systemData,
      resources: {
        ...character.resources,
        pv: { ...curPv, current: curPv.current + pvDelta, max: resourceMax.pv },
        pm: { ...curPm, current: curPm.current + pmDelta, max: resourceMax.pm },
      },
      computed,
    };
  },

  rest(character, kind) {
    const recovery =
      kind === "long"
        ? mbRules.combat.restAndRecovery.longRest
        : mbRules.combat.restAndRecovery.shortRest;
    const pv = character.resources?.pv ?? { current: 60, max: 60 };
    const pm = character.resources?.pm ?? { current: 60, max: 60 };
    const nextPv = Math.min(pv.max, Math.max(0, pv.current) + recovery.pvRecovered);
    const nextPm = Math.min(pm.max, Math.max(0, pm.current) + recovery.pmRecovered);
    const conditions =
      kind === "long"
        ? (character.conditions ?? []).filter((c) => c.id !== "exausto" && c.id !== "inconsciente" && c.id !== "indefeso")
        : character.conditions ?? [];
    const nextChar: Character = {
      ...character,
      resources: {
        ...character.resources,
        pv: { ...pv, current: nextPv },
        pm: { ...pm, current: nextPm },
      },
      conditions,
    };
    const { computed } = this.computeDerivedStats(nextChar);
    return {
      resources: nextChar.resources,
      conditions,
      computed,
    };
  },

  shortRest(character) {
    return this.rest(character, "short");
  },

  longRest(character) {
    return this.rest(character, "long");
  },

  getCompendium() {
    const content = getMightyBladeContent();
    return {
      races: mbRaces,
      classes: mbClasses,
      conditions: mbConditions,
      abilities: content.abilities,
      spells: content.spells,
      weapons: content.equipment.weapons,
      armor: content.equipment.armor,
      gear: content.equipment.gear,
      bestiary: content.bestiary,
    };
  },

  getCompendiumCategories(): CompendiumCategory[] {
    const content = getMightyBladeContent();
    return [
      { id: "races", label: "Raças", items: mbRaces as unknown as Record<string, unknown>[] },
      { id: "classes", label: "Classes", items: mbClasses as unknown as Record<string, unknown>[] },
      { id: "abilities", label: "Habilidades", items: content.abilities as unknown as Record<string, unknown>[] },
      { id: "spells", label: "Magias", items: content.spells as unknown as Record<string, unknown>[] },
      { id: "weapons", label: "Armas", items: content.equipment.weapons as unknown as Record<string, unknown>[] },
      { id: "armor", label: "Armaduras & Escudos", items: content.equipment.armor as unknown as Record<string, unknown>[] },
      { id: "gear", label: "Itens & Poções", items: content.equipment.gear as unknown as Record<string, unknown>[] },
      { id: "conditions", label: "Condições", items: mbConditions as unknown as Record<string, unknown>[] },
      { id: "bestiary", label: "Bestiário", items: content.bestiary as unknown as Record<string, unknown>[] },
    ];
  },

  createCharacterFromBestiary(creatureId: string) {
    const creature = getMightyBladeContent().bestiary.find((c) => c.id === creatureId);
    if (!creature) return null;

    const inventory: CharacterEquipmentEntry[] = (creature.attacks ?? []).map((atk, idx) => ({
      id: `nat-atk-${idx + 1}`,
      name: atk.name,
      category: "weapon",
      equipped: true,
      quantity: 1,
      fn: 0,
      damageAttribute: atk.rollAttr ?? "forca",
      damageBonus:
        typeof atk.damage === "number"
          ? Math.max(0, atk.damage - (creature.attributes[atk.rollAttr ?? "forca"] ?? 0))
          : 2,
      damageType: atk.damageType ?? "Corte",
      range: atk.range ?? "Corpo a corpo",
      description: atk.notes,
    }));

    const abilities: CharacterAbilityEntry[] = (creature.abilities ?? []).map((ab, idx) => ({
      id: `mob-ab-${idx + 1}`,
      name: ab.name,
      category: ab.manaCost ? "acao" : "suporte",
      manaCost: ab.manaCost ?? 0,
      description: ab.description,
    }));

    const systemData: MightyBladeSystemData = {
      raceId: "monstro",
      raceName: creature.category ?? "Criatura",
      classId: "bestiario",
      className: `ND ${creature.challengeLevel ?? 1}`,
      level: creature.challengeLevel ?? 1,
      xp: creature.xpReward ?? 0,
      attributes: creature.attributes,
      pvBonus: creature.pvMax - 60,
      pmBonus: creature.pmMax - 60,
      inventory,
      abilities,
      spells: [],
      notes: creature.description ?? "",
    };

    const portraitUrl = creature.portrait || "./assets/monsters/goblin-raider.svg";

    return {
      systemId: "mighty-blade-3e",
      kind: "monster",
      name: creature.name,
      subtitle: `${creature.category ?? "Monstro"} · Nível ${creature.challengeLevel ?? 1}`,
      portraitUrl,
      ownerUserId: null,
      controlledByUserIds: [],
      visibility: "all_players",
      resources: {
        pv: { current: creature.pvMax, max: creature.pvMax },
        pm: { current: creature.pmMax, max: creature.pmMax },
      },
      conditions: [],
      systemData: systemData as unknown as Record<string, unknown>,
      computed: {
        bloqueio: creature.bloqueio,
        esquiva: creature.esquiva,
        defesa: Math.max(creature.bloqueio, creature.esquiva),
        determinacao: creature.determinacao,
        deslocamento: creature.movement ?? 6,
        deslocamentoQuadrados: Math.max(1, Math.floor((creature.movement ?? 6) / 1.5)),
      },
    };
  },
};

export {
  mbRules,
  mbRaces,
  mbClasses,
  mbConditions,
  mbAbilities,
  mbSpells,
  mbEquipment,
  mbBestiary,
  findRace,
  findClass,
  findCondition,
  getMightyBladeContent,
} from "./compendium";
export { hydrateMightyBladeCompendium } from "./compendium";
