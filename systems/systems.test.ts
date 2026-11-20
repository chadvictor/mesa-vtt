import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateExpression, interpolateFormula, runMacro, SandboxError } from "./sandbox";
import {
  getSystem,
  getSystemEngine,
  listSystemManifests,
  listSystems,
  registerSystem,
} from "./registry";
import { mightyBlade3eEngine } from "./mighty-blade-3e/engine";
import { genericRpgEngine } from "./generic-rpg/engine";
import {
  advanceStage,
  buildAttributeRoll,
  buildResistanceRoll,
  buildSkillRoll,
  buildSpellRoll,
  buildWeaponAttackRoll,
  computeWeaponDamage,
  getResistanceTarget,
  getSpecializationsForProfession,
  getSpellsByProfession,
  resolveTagmarResistance,
  resolveTagmarRoll,
  searchTagmarCompendium,
  spawnBestiaryMonster,
  spendKarma,
  tagmar3Engine,
  validateTagmarPointBuy,
} from "./tagmar/engine";
import type { Character, RollResult, TagmarSystemData } from "./types";

function makeHero(overrides: Partial<Character> = {}): Character {
  const created = mightyBlade3eEngine.createCharacterFromWizard({
    name: "Aldric",
    raceId: "humano",
    classId: "guerreiro",
    freeAttributePoints: { forca: 1 },
  });
  return {
    id: "char-aldric",
    campaignId: "camp-1",
    updatedAt: "2026-11-19T00:00:00Z",
    ...created,
    ...overrides,
  };
}

describe("Sandbox AST Expression & Macro Engine", () => {
  it("evaluates arithmetic, precedence, math helpers, and conditionals", () => {
    assert.equal(evaluateExpression("2 + 3 * 4"), 14);
    assert.equal(evaluateExpression("(2 + 3) * 4"), 20);
    assert.equal(evaluateExpression("floor(5 / 2) + max(3, 7) - min(2, 9)"), 7);
    assert.equal(evaluateExpression("clamp(25, 0, 10)"), 10);
    assert.equal(evaluateExpression("10 >= 8 ? 'acerto' : 'erro'"), "acerto");
    assert.equal(evaluateExpression("if(false, 1 / 0, 42)"), 42);
  });

  it("interpolates @variables and executes multi-statement VTT macros", () => {
    const hero = makeHero();
    const target = makeHero({
      id: "char-goblin",
      name: "Goblin",
      computed: { bloqueio: 11, esquiva: 10, defesa: 11 },
    });

    assert.equal(
      interpolateFormula("2d6 + @forca + 2", { character: hero, target }),
      "2d6 + 5 + 2"
    );
    assert.equal(
      evaluateExpression("@target.bloqueio", { character: hero, target }),
      11
    );

    const res = runMacro(
      `
      let bonus = @forca + 2;
      spendPM(10);
      say(\`Pelo aço de Drakon! (+\${bonus})\`);
      roll("2d6 + @forca + 2", "Golpe Poderoso", { difficulty: @target.bloqueio });
      `,
      { character: hero, target }
    );

    assert.equal(res.ok, true);
    assert.equal(res.commands.length, 3);
    assert.deepEqual(res.commands[0], { type: "spend", resource: "pm", amount: 10 });
    assert.deepEqual(res.commands[1], {
      type: "chat",
      kind: "ic",
      content: "Pelo aço de Drakon! (+7)",
    });
    assert.equal(res.commands[2].type, "roll");
    if (res.commands[2].type === "roll") {
      assert.equal(res.commands[2].formula, "2d6 + 5 + 2");
      assert.equal(res.commands[2].difficulty, 11);
    }
  });

  it("blocks prototype pollution, arbitrary functions, and division by zero", () => {
    assert.throws(() => evaluateExpression("char.__proto__"), SandboxError);
    assert.throws(() => evaluateExpression("char.constructor"), SandboxError);
    assert.throws(() => evaluateExpression('eval("1+1")'), SandboxError);
    assert.throws(() => evaluateExpression('fetch("https://evil.test")'), SandboxError);
    assert.throws(() => evaluateExpression("10 / 0"), SandboxError);

    const blocked = runMacro('constructor.constructor("return process")()', {});
    assert.equal(blocked.ok, false);
    assert.ok(blocked.error && blocked.error.length > 0);
  });
});

describe("Mighty Blade 3ª Edição Automation Engine", () => {
  it("builds a level 1 Humano Guerreiro with exact verified MB 3.5 stats", () => {
    const hero = makeHero();
    const sys = hero.systemData as { attributes: { forca: number; agilidade: number; inteligencia: number; vontade: number } };

    // Humano (3/3/3/3) + Guerreiro (+1 FOR, +1 AGI) + 1 livre em FOR = 5/4/3/3
    assert.deepEqual(sys.attributes, { forca: 5, agilidade: 4, inteligencia: 3, vontade: 3 });
    assert.equal(hero.resources.pv.max, 60);
    assert.equal(hero.resources.pm.max, 60);

    // Determinação = 8 + max(3, 3) = 11
    assert.equal(hero.computed.determinacao, 11);
    // Deslocamento = floor(4/2) + 5 = 7m -> floor(7 / 1.5) = 4 quadrados
    assert.equal(hero.computed.deslocamento, 7);
    assert.equal(hero.computed.deslocamentoQuadrados, 4);
    assert.equal(hero.computed.corrida, 14);
    // Esquiva = 5 + 4 = 9; Bloqueio = 5 + 5 + armadura(2) + escudo(2) = 14
    assert.equal(hero.computed.esquiva, 9);
    assert.equal(hero.computed.bloqueio, 14);
    assert.equal(hero.computed.defesa, 14);
    // Carga Básica = 5 * 7 = 35kg
    assert.equal(hero.computed.cargaBasica, 35);
    assert.equal(hero.computed.cargaPesada, 70);
    assert.equal(hero.computed.cargaMaxima, 105);
  });

  it("applies Small race base defense override (6) for Faen", () => {
    const faenCreated = mightyBlade3eEngine.createCharacterFromWizard({
      name: "Pip",
      raceId: "faen",
      classId: "patrulheiro",
    });
    // Faen AGI 4 + Patrulheiro AGI +1 = 5; baseDefenseOverride = 6 -> Esquiva = 11
    assert.equal(faenCreated.computed.esquiva, 11);
  });

  it("enforces FN (Força Necessária) Inapto rule -> 1d6 instead of 2d6", () => {
    const weakMage = mightyBlade3eEngine.createCharacterFromWizard({
      name: "Lyra",
      raceId: "elfo",
      classId: "feiticeiro",
    });
    const sys = weakMage.systemData as { inventory: Array<Record<string, unknown>> };
    sys.inventory.unshift({
      id: "heavy-axe",
      name: "Machado Colossal",
      category: "weapon",
      equipped: true,
      quantity: 1,
      fn: 5,
      damageBonus: 6,
      damageAttribute: "forca",
      damageType: "Corte",
    });

    const char: Character = {
      id: "char-lyra",
      campaignId: "camp-1",
      updatedAt: "2026-11-19T00:00:00Z",
      ...weakMage,
    };
    const plan = mightyBlade3eEngine.planAttack(char, "heavy-axe");
    assert.ok(plan.formula.startsWith("1d6"), `Expected 1d6 Inapto formula, got ${plan.formula}`);
    assert.equal(plan.systemMeta.inapto, true);
  });

  it("detects Mighty Blade Critical (6+6) with 2x damage action and Fumble (1+1)", () => {
    const hero = makeHero();
    const goblin = makeHero({
      id: "mob-goblin",
      name: "Goblin Saqueador",
      computed: { bloqueio: 10, esquiva: 10, defesa: 10 },
    });

    const plan = mightyBlade3eEngine.planAttack(hero, "", goblin);
    const baseDmg = Number(plan.systemMeta.baseDamage);
    assert.ok(baseDmg > 0);

    const critRoll: RollResult = {
      rollId: "r-crit",
      formula: plan.formula,
      label: plan.label,
      dice: [
        { sides: 6, value: 6 },
        { sides: 6, value: 6 },
      ],
      modifier: 6,
      total: 18,
      seed: 12345,
      systemMeta: plan.systemMeta,
    };
    const critEval = mightyBlade3eEngine.resolveRollOutcome(critRoll, hero, goblin);
    assert.equal(critEval.outcome.kind, "critical");
    const dmgBtn = critEval.actions.find((a) => a.actionType === "apply_damage");
    assert.ok(dmgBtn);
    assert.equal(dmgBtn.payload.amount, baseDmg * 2);

    const fumbleRoll: RollResult = {
      ...critRoll,
      rollId: "r-fumble",
      dice: [
        { sides: 6, value: 1 },
        { sides: 6, value: 1 },
      ],
      total: 8,
    };
    const fumbleEval = mightyBlade3eEngine.resolveRollOutcome(fumbleRoll, hero, goblin);
    assert.equal(fumbleEval.outcome.kind, "fumble");
    assert.equal(fumbleEval.actions.find((a) => a.actionType === "apply_damage"), undefined);
  });

  it("automates damage/unconscious/death, healing, mana spend, conditions, rest, and level up", () => {
    const hero = makeHero();

    // Damage to 0 PV -> Inconsciente + Indefeso
    const dmgPatch = mightyBlade3eEngine.applyDamage(hero, 60);
    assert.equal(dmgPatch.resources?.pv.current, 0);
    assert.ok(dmgPatch.conditions?.some((c) => c.id === "inconsciente"));
    assert.equal(dmgPatch.computed?.inconsciente, true);
    assert.equal(dmgPatch.computed?.morto, false);

    // Damage to -10 PV -> morto
    const lethalPatch = mightyBlade3eEngine.applyDamage(hero, 70);
    assert.equal(lethalPatch.resources?.pv.current, -10);
    assert.equal(lethalPatch.computed?.morto, true);

    // Healing clears inconsciente
    const downed: Character = { ...hero, ...dmgPatch };
    const healPatch = mightyBlade3eEngine.applyHealing(downed, 15);
    assert.equal(healPatch.resources?.pv.current, 15);
    assert.equal(healPatch.conditions?.some((c) => c.id === "inconsciente"), false);

    // Mana spend validation
    assert.ok(mightyBlade3eEngine.spendMana(hero, 999).error);
    const pmRes = mightyBlade3eEngine.spendMana(hero, 15);
    assert.equal(pmRes.patch?.resources?.pm.current, 45);

    // Condition modifiers (Caído: -2 Defesa)
    const beforeDef = Number(hero.computed.bloqueio);
    const condPatch = mightyBlade3eEngine.applyCondition(hero, "caido");
    assert.equal(condPatch.computed?.bloqueio, beforeDef - 2);

    // Short (+5) & Long (+30) rest
    const tired: Character = {
      ...hero,
      resources: { pv: { current: 20, max: 60 }, pm: { current: 10, max: 60 } },
    };
    assert.equal(mightyBlade3eEngine.shortRest(tired).resources?.pv.current, 25);
    assert.equal(mightyBlade3eEngine.longRest(tired).resources?.pv.current, 50);
    assert.equal(mightyBlade3eEngine.longRest(tired).resources?.pm.current, 40);

    // Level up 1 -> 2 (+10 PV evolution choice)
    const lvl2Patch = mightyBlade3eEngine.levelUp(hero, { evolutionChoice: "pv10" });
    assert.equal(lvl2Patch.resources?.pv.max, 70);
    assert.equal(lvl2Patch.resources?.pv.current, 70);
  });

  it("bundles full Mighty Blade 3e compendium and automates abilities, spells & bestiary", () => {
    const comp = mightyBlade3eEngine.getCompendium();
    assert.ok(comp.races.length >= 16);
    assert.ok(comp.classes.length >= 14);
    assert.ok(comp.conditions.length >= 18);
    assert.ok(comp.abilities.length >= 120);
    assert.ok(comp.spells.length >= 100);
    assert.ok(comp.weapons.length >= 30);
    assert.ok(comp.armor.length >= 15);
    assert.ok(comp.gear.length >= 40);
    assert.ok(comp.bestiary.length >= 35);

    // Real bestiary creature spawn (without needing manual hydration!)
    const mob = mightyBlade3eEngine.createCharacterFromBestiary?.("goblin-saqueador");
    assert.ok(mob);
    assert.equal(mob.kind, "monster");
    assert.equal(mob.name, "Goblin Saqueador");
    assert.equal(mob.resources.pv.max, 18);

    // Real ability ("ataque-poderoso": 10 PM, damageFormula: "weapon + 6")
    const hero = makeHero();
    const abPlan = mightyBlade3eEngine.planAbility(hero, "ataque-poderoso");
    assert.equal(abPlan.manaCost, 10);
    const abEval = mightyBlade3eEngine.resolveRollOutcome(
      {
        rollId: "ab-1",
        formula: abPlan.formula,
        label: abPlan.label,
        dice: [
          { sides: 6, value: 4 },
          { sides: 6, value: 5 },
        ],
        modifier: 5,
        total: 14,
        seed: 99,
        systemMeta: abPlan.systemMeta,
      },
      hero
    );
    assert.ok(abEval.actions.some((a) => a.actionType === "spend_mana" && a.payload.amount === 10));
    assert.ok(abEval.actions.some((a) => a.actionType === "apply_damage" && Number(a.payload.amount) > 6));

    // Real spell ("chama": 5 PM, Dif 8, damageFormula: "6")
    const spPlan = mightyBlade3eEngine.planSpell(hero, "chama");
    assert.equal(spPlan.manaCost, 5);
    assert.equal(spPlan.difficulty, 8);
    const spEval = mightyBlade3eEngine.resolveRollOutcome(
      {
        rollId: "sp-1",
        formula: spPlan.formula,
        label: spPlan.label,
        dice: [
          { sides: 6, value: 3 },
          { sides: 6, value: 4 },
        ],
        modifier: 3,
        total: 10,
        seed: 100,
        systemMeta: spPlan.systemMeta,
      },
      hero
    );
    assert.equal(spEval.outcome.kind, "success");
    assert.ok(spEval.actions.some((a) => a.actionType === "spend_mana" && a.payload.amount === 5));
    assert.ok(spEval.actions.some((a) => a.actionType === "apply_damage" && a.payload.amount === 6));
  });
});

describe("Generic RPG Engine & Multisystem Registry", () => {
  it("lists built-in systems [mighty-blade-3e, tagmar-3, generic-rpg], resolves aliases & fallback, and supports custom registration", () => {
    const manifests = listSystemManifests();
    assert.deepEqual(
      manifests.slice(0, 3).map((m) => m.id),
      ["mighty-blade-3e", "tagmar-3", "generic-rpg"]
    );
    assert.equal(listSystems().length, manifests.length);
    assert.equal(getSystem("tagmar-3").manifest.id, "tagmar-3");
    assert.equal(getSystem("tagmar").manifest.id, "tagmar-3");
    assert.equal(getSystemEngine("unknown-system").manifest.id, "generic-rpg");

    const custom = { ...genericRpgEngine, manifest: { ...genericRpgEngine.manifest, id: "homebrew-test" } };
    registerSystem(custom);
    assert.equal(getSystemEngine("homebrew-test").manifest.id, "homebrew-test");
  });

  it("handles generic character creation and natural 20 criticals", () => {
    const draft = genericRpgEngine.createCharacterFromWizard({
      name: "Kael",
      archetype: "Explorador",
      hpMax: 40,
      mpMax: 25,
    });
    const char: Character = {
      id: "char-kael",
      campaignId: "camp-2",
      updatedAt: "2026-11-19T00:00:00Z",
      ...draft,
    };
    const plan = genericRpgEngine.planAttack(char, "act-ataque");
    assert.equal(plan.formula, "1d20 + 2");

    const nat20 = genericRpgEngine.resolveRollOutcome(
      {
        rollId: "g-1",
        formula: plan.formula,
        label: plan.label,
        dice: [{ sides: 20, value: 20 }],
        modifier: 2,
        total: 22,
        seed: 7,
        systemMeta: plan.systemMeta,
      },
      char
    );
    assert.equal(nat20.outcome.kind, "critical");
  });
});

function makeTagmarHero(input: Record<string, unknown> = {}): Character {
  const created = tagmar3Engine.createCharacterFromWizard({
    name: "Kael de Verrogar",
    raceId: "humano",
    professionId: "guerreiro",
    attributeAllocations: { forca: 3, fisico: 2, agilidade: 2, carisma: 1 },
    ...input,
  });
  return {
    id: "char-tagmar-hero",
    campaignId: "camp-tagmar",
    updatedAt: "2026-11-19T00:00:00Z",
    ...created,
  };
}

describe("Tagmar 3.0 Automation Engine, Resolution Table & Compendium", () => {
  it("resolves official Tabela de Resolução across columns -7, 0, 10, 20 and >20 overflow (col 24)", () => {
    // Col -7 (30% hit chance: 1-2 erro_critico, 3-14 falha, 15-16 verde, 17-18 amarelo, 19 laranja, 20 azul)
    assert.equal(resolveTagmarRoll(1, -7).color, "erro_critico");
    assert.equal(resolveTagmarRoll(2, -7).color, "erro_critico");
    assert.equal(resolveTagmarRoll(14, -7).color, "falha");
    assert.equal(resolveTagmarRoll(15, -7).color, "verde");
    assert.equal(resolveTagmarRoll(17, -7).color, "amarelo");
    assert.equal(resolveTagmarRoll(19, -7).color, "laranja");
    const colNeg7Crit = resolveTagmarRoll(20, -7);
    assert.equal(colNeg7Crit.color, "azul");
    assert.equal(colNeg7Crit.isCritical, true);
    assert.equal(colNeg7Crit.directToEf, true);
    // Clamping below -7
    assert.equal(resolveTagmarRoll(15, -15).effectiveColumn, -7);
    assert.equal(resolveTagmarRoll(15, -15).color, "verde");

    // Col 0
    assert.equal(resolveTagmarRoll(1, 0).color, "erro_critico");
    assert.equal(resolveTagmarRoll(11, 0).color, "falha");
    assert.equal(resolveTagmarRoll(12, 0).color, "verde");
    assert.equal(resolveTagmarRoll(14, 0).color, "amarelo");
    assert.equal(resolveTagmarRoll(16, 0).color, "laranja");
    assert.equal(resolveTagmarRoll(18, 0).color, "vermelho");
    assert.equal(resolveTagmarRoll(20, 0).color, "azul");

    // Col 10
    assert.equal(resolveTagmarRoll(6, 10).color, "falha");
    assert.equal(resolveTagmarRoll(7, 10).color, "verde");
    assert.equal(resolveTagmarRoll(10, 10).color, "amarelo");
    assert.equal(resolveTagmarRoll(14, 10).color, "laranja");
    assert.equal(resolveTagmarRoll(17, 10).color, "vermelho");
    assert.equal(resolveTagmarRoll(20, 10).color, "azul");

    // Col 20 (95% hit chance: 1 erro_critico, no falha, 2-3 verde, 18-20 azul)
    assert.equal(resolveTagmarRoll(1, 20).color, "erro_critico");
    assert.equal(resolveTagmarRoll(2, 20).color, "verde");
    assert.equal(resolveTagmarRoll(5, 20).color, "amarelo");
    assert.equal(resolveTagmarRoll(10, 20).color, "laranja");
    assert.equal(resolveTagmarRoll(15, 20).color, "vermelho");
    assert.equal(resolveTagmarRoll(18, 20).color, "azul");

    // Col 24 overflow (>20 rule: 24 - 20 = col 4, +2 tiers!)
    // On col 4: d20=10 is verde -> +2 tiers = laranja; d20=15 is laranja -> +2 tiers = azul!
    // Natural 1 stays erro_critico!
    const ovFumble = resolveTagmarRoll(1, 24);
    assert.equal(ovFumble.effectiveColumn, 4);
    assert.equal(ovFumble.overflowTiers, 2);
    assert.equal(ovFumble.color, "erro_critico");

    const ovGreen = resolveTagmarRoll(10, 24);
    assert.equal(ovGreen.effectiveColumn, 4);
    assert.equal(ovGreen.baseColor, "verde");
    assert.equal(ovGreen.color, "laranja");

    const ovCrit = resolveTagmarRoll(15, 24);
    assert.equal(ovCrit.baseColor, "laranja");
    assert.equal(ovCrit.color, "azul");
    assert.equal(ovCrit.directToEf, true);

    // Weapon color-coded damage computation
    const swordDmg = { verde: 4, amarelo: 8, laranja: 12, vermelho: 16, azul: 20 };
    assert.deepEqual(computeWeaponDamage(swordDmg, "falha"), {
      damage: 0,
      directToEf: false,
      appliedColor: "falha",
      extraBonusPercent: 0,
    });
    assert.equal(computeWeaponDamage(swordDmg, "verde").damage, 4);
    assert.equal(computeWeaponDamage(swordDmg, "amarelo").damage, 8);
    assert.equal(computeWeaponDamage(swordDmg, "laranja").damage, 12);
    assert.equal(computeWeaponDamage(swordDmg, "vermelho").damage, 16);
    const critDmg = computeWeaponDamage(swordDmg, "azul");
    assert.equal(critDmg.damage, 20);
    assert.equal(critDmg.directToEf, true);
  });

  it("resolves official Tabela de Resistências (RF / RM) with exact verified targets", () => {
    // Verified tagmar.com.br matrix cells
    assert.equal(getResistanceTarget(1, -2), 14);
    assert.equal(getResistanceTarget(1, 1), 11);
    assert.equal(getResistanceTarget(1, 5), 7);
    assert.equal(getResistanceTarget(20, 8), 19);
    assert.equal(getResistanceTarget(20, 6), 20);

    // Success / Failure / Nat 1 / Nat 20
    assert.equal(resolveTagmarResistance(11, 5, 5).resisted, true);
    assert.equal(resolveTagmarResistance(10, 5, 5).resisted, false);
    assert.equal(resolveTagmarResistance(1, 1, 20).resisted, false);
    assert.equal(resolveTagmarResistance(1, 1, 20).isFumble, true);
    assert.equal(resolveTagmarResistance(20, 20, -2).resisted, true);
    assert.equal(resolveTagmarResistance(20, 20, -2).isCritical, true);
  });

  it("creates Stage-1 heroes with exact EF, EH, Karma, DA/DP/Absorção, RF/RM/VB & point-buy validation", () => {
    // Point-buy validation: Humano has 16 pts budget (15 + 1)
    const validHuman = validateTagmarPointBuy("humano", {
      intelecto: 0,
      aura: 0,
      carisma: 1, // cost 1
      forca: 3,   // cost 1+2+3 = 6
      fisico: 2,  // cost 1+2 = 3
      agilidade: 2, // cost 1+2 = 3 -> total 13 <= 16
    });
    assert.equal(validHuman.valid, true);
    assert.equal(validHuman.spent, 13);
    assert.equal(validHuman.budget, 16);

    const overBudget = validateTagmarPointBuy("anao", {
      intelecto: 4,
      aura: 4,
      carisma: 0,
      forca: 3,
      fisico: 4,
      agilidade: -1,
    });
    assert.equal(overBudget.valid, false);

    // Humano Guerreiro (FOR 3, FIS 2, AGI 2, CAR 1)
    const warrior = makeTagmarHero();
    const wData = warrior.systemData as unknown as TagmarSystemData;
    assert.equal(warrior.systemId, "tagmar-3");
    // EF = 15 (Humano) + 3 (FOR) + 2 (FIS) = 20
    assert.equal(warrior.resources.ef.max, 20);
    // EH = 18 (Guerreiro) + 2 (FIS) = 20
    assert.equal(warrior.resources.eh.max, 20);
    // Non-mystic Karma = 0
    assert.equal(warrior.resources.karma.max, 0);
    // RF = 1 + 2 = 3; RM = 1 + 0 = 1; VB = 20 + 2 = 22
    assert.equal(warrior.computed.rf, 3);
    assert.equal(warrior.computed.rm, 1);
    assert.equal(warrior.computed.vb, 22);
    // Has starter armor/shield/helmet giving positive Absorção & DA/DP
    assert.ok(Number(warrior.computed.absorcao) > 0);
    assert.equal(warrior.resources.ef.temp, warrior.computed.absorcao);
    assert.equal(wData.money.mp, 1);

    // Elfa Dourada Maga Elemental: AUR base +2 + 2 = 4 -> Karma = (4 + 1) * (1 + 1) = 10!
    const mage = makeTagmarHero({
      name: "Aelindra",
      raceId: "elfo-dourado",
      professionId: "mago",
      attributeAllocations: { aura: 2, intelecto: 2 },
    });
    const mData = mage.systemData as unknown as TagmarSystemData;
    assert.equal(mData.attributes.aura, 4);
    assert.equal(mData.attributes.intelecto, 3);
    assert.equal(mage.resources.karma.max, 10);
    assert.equal(mage.resources.karma.current, 10);
    // Elfo Dourado EF = 13 + (-1 FOR) + (-1 FIS) = 11; Mago EH = 6 + (-1 FIS) = 5
    assert.equal(mage.resources.ef.max, 11);
    assert.equal(mage.resources.eh.max, 5);
    // Elfo Dourado racial RM bonus (+1): RM = 1 (stage) + 4 (AUR) + 1 (racial) = 6
    assert.equal(mage.computed.rm, 6);
  });

  it("enforces authentic Tagmar EH -> Absorção -> EF damage pipeline and Critical direct-to-EF bypass", () => {
    const hero = makeTagmarHero();
    // Hero starts with EH=20, EF=20, Absorção (ef.temp) = 16 (Couro Rígido 12 + Rodela 2 + Elmo Aberto 2)
    const startAbs = Number(hero.computed.absorcao);
    assert.ok(startAbs >= 12);

    // 1. Normal damage <= EH only drains EH
    const hit1 = tagmar3Engine.applyDamage(hero, 12);
    assert.equal(hit1.resources?.eh.current, 8);
    assert.equal(hit1.resources?.ef.current, 20);
    assert.equal(hit1.resources?.ef.temp, startAbs);

    // 2. Normal damage overflowing EH drains Absorção before EF
    const after1: Character = { ...hero, ...hit1 };
    const hit2 = tagmar3Engine.applyDamage(after1, 8 + startAbs + 5);
    assert.equal(hit2.resources?.eh.current, 0);
    assert.equal(hit2.resources?.ef.temp, 0);
    assert.equal(hit2.resources?.ef.current, 15);
    assert.equal(hit2.computed?.inconsciente, false);

    // 3. Critical Hit (directToEf: true) bypasses EH & Absorção straight into EF!
    const critHit = tagmar3Engine.applyDamage(hero, 20, { directToEf: true });
    assert.equal(critHit.resources?.eh.current, 20); // EH untouched!
    assert.equal(critHit.resources?.ef.temp, startAbs); // Normal absorption bypassed!
    assert.equal(critHit.resources?.ef.current, 0);
    assert.equal(critHit.computed?.inconsciente, true);
    assert.equal(critHit.computed?.morto, false);
    assert.ok(critHit.conditions?.some((c) => c.id === "inconsciente"));

    // 4. Lethal damage down to EF <= -15 triggers Agonizando + Morto
    const downed: Character = { ...hero, ...critHit };
    const lethal = tagmar3Engine.applyDamage(downed, 15, { directToEf: true });
    assert.equal(lethal.resources?.ef.current, -15);
    assert.equal(lethal.computed?.morto, true);
    assert.ok(lethal.conditions?.some((c) => c.id === "agonizando"));

    // 5. Healing restores EF first and clears Inconsciente/Agonizando once EF > 0
    const healed = tagmar3Engine.applyHealing(downed, 10);
    assert.equal(healed.resources?.ef.current, 10);
    assert.equal(healed.conditions?.some((c) => c.id === "inconsciente"), false);
  });

  it("handles Karma spending, Rest, Conditions, Stage 1->5 Specialization, and Roll Evaluation", () => {
    const mage = makeTagmarHero({
      name: "Aelindra",
      raceId: "elfo-dourado",
      professionId: "mago",
      attributeAllocations: { aura: 2, intelecto: 2 },
      selectedSpellIds: ["bola-de-fogo", "curas-fisicas"],
    });

    // Karma spend & insufficient error
    assert.ok(spendKarma(mage, 99).error);
    const kRes = spendKarma(mage, 4);
    assert.equal(kRes.patch?.resources?.karma.current, 6);

    // Short rest (+2 EH, +1 Karma) & Long rest (full Karma, +16 EH, +1 EF if >0, repairs Absorção)
    const tiredMage: Character = {
      ...mage,
      resources: {
        eh: { current: 1, max: 5 },
        ef: { current: 8, max: 11, temp: 0 },
        karma: { current: 2, max: 10 },
      },
    };
    const shortPatch = tagmar3Engine.shortRest(tiredMage);
    assert.equal(shortPatch.resources?.eh.current, 3);
    assert.equal(shortPatch.resources?.karma.current, 3);

    const longPatch = tagmar3Engine.longRest(tiredMage);
    assert.equal(longPatch.resources?.eh.current, 5);
    assert.equal(longPatch.resources?.ef.current, 9);
    assert.equal(longPatch.resources?.karma.current, 10);

    // Condition: Cego (-10 columnShift, -4 DA, usesPassiveDefense)
    const cegoPatch = tagmar3Engine.applyCondition(mage, "cego");
    assert.equal(cegoPatch.computed?.conditionColumnShift, -10);
    assert.equal(cegoPatch.computed?.usesPassiveDefense, true);

    // Advance Stage 1 -> 5 and unlock Colégio Elemental specialization
    let evolving = mage;
    for (let s = 2; s <= 5; s++) {
      const patch = advanceStage(evolving, {
        ehRoll: 8,
        specializationId: s === 5 ? "colegio-elemental" : undefined,
      });
      evolving = { ...evolving, ...patch };
    }
    const evData = evolving.systemData as unknown as TagmarSystemData;
    assert.equal(evData.stage, 5);
    assert.equal(evData.specializationId, "colegio-elemental");
    // Stage 5 Karma = (4 + 1) * (5 + 1) = 30!
    assert.equal(evolving.resources.karma.max, 30);
    assert.ok(evolving.resources.eh.max > mage.resources.eh.max);

    // Roll plans & evaluation: Weapon Attack (Azul Critical -> Direct to EF button!), Spell (Bola de Fogo), Resistance (RM)
    const warrior = makeTagmarHero();
    const goblinDraft = spawnBestiaryMonster("goblin-comum");
    assert.ok(goblinDraft);
    const goblin: Character = {
      id: "mob-goblin",
      campaignId: "camp-tagmar",
      updatedAt: "2026-11-19T00:00:00Z",
      ...goblinDraft,
    };

    const atkPlan = buildWeaponAttackRoll(warrior, "", goblin);
    assert.equal(atkPlan.formula, "1d20");
    assert.equal(typeof atkPlan.tagmarColumn, "number");

    const atkCritEval = tagmar3Engine.resolveRollOutcome(
      {
        rollId: "tg-atk-1",
        formula: "1d20",
        label: atkPlan.label,
        dice: [{ sides: 20, value: 20 }],
        modifier: 0,
        total: 20,
        seed: 42,
        tagmarColumn: atkPlan.tagmarColumn,
        systemMeta: atkPlan.systemMeta,
      },
      warrior,
      goblin
    );
    assert.equal(atkCritEval.outcome.kind, "critical");
    const critDmgBtn = atkCritEval.actions.find((a) => a.actionType === "apply_damage");
    assert.ok(critDmgBtn);
    assert.equal(critDmgBtn.payload.directToEf, true);

    const spellPlan = buildSpellRoll(mage, "bola-de-fogo", goblin);
    assert.equal(spellPlan.karmaCost, 4);
    const spellEval = tagmar3Engine.resolveRollOutcome(
      {
        rollId: "tg-sp-1",
        formula: "1d20",
        label: spellPlan.label,
        dice: [{ sides: 20, value: 16 }],
        modifier: 0,
        total: 16,
        seed: 77,
        tagmarColumn: spellPlan.tagmarColumn,
        systemMeta: spellPlan.systemMeta,
      },
      mage,
      goblin
    );
    assert.ok(spellEval.actions.some((a) => a.actionType === "spend_mana" && a.payload.resource === "karma" && a.payload.amount === 4));
    assert.ok(spellEval.actions.some((a) => a.actionType === "apply_damage"));
    assert.ok(spellEval.actions.some((a) => a.actionType === "roll_followup"));
    // Bola de Fogo applies "queimando" alias -> resolves to canonical "em-chamas" condition!
    const burnBtn = spellEval.actions.find((a) => a.actionType === "apply_condition");
    assert.ok(burnBtn);
    assert.equal(burnBtn.payload.conditionId, "em-chamas");

    // Explicit unarmed strike on armed hero must NOT fall back to equipped sword
    const unarmedPlan = buildWeaponAttackRoll(warrior, "__unarmed__", goblin);
    assert.equal(unarmedPlan.systemMeta.weaponName, "Ataque Desarmado");

    const resPlan = buildResistanceRoll(mage, "rm", 10);
    assert.equal(resPlan.tagmarResistance?.kind, "rm");
    const resEval = tagmar3Engine.resolveRollOutcome(
      {
        rollId: "tg-res-1",
        formula: "1d20",
        label: resPlan.label,
        dice: [{ sides: 20, value: 18 }],
        modifier: 0,
        total: 18,
        seed: 88,
        tagmarResistance: {
          kind: "rm",
          fa: 10,
          fd: Number(mage.computed.rm),
          target: resPlan.difficulty ?? 15,
          resisted: true,
        },
        systemMeta: resPlan.systemMeta,
      },
      mage
    );
    assert.equal(resEval.outcome.kind, "success");

    // Attribute, Skill & Initiative plans
    assert.equal(buildAttributeRoll(warrior, "forca").formula, "1d20");
    assert.equal(buildSkillRoll(warrior, "aplicar-esforco").formula, "1d20");
    assert.ok(tagmar3Engine.planInitiative(warrior).formula.startsWith("1d10"));
  });

  it("exposes all 8 Tagmar 3.0 compendium datasets, search helpers, and Livro das Criaturas bestiary spawner", () => {
    const comp = tagmar3Engine.getCompendium();
    assert.equal(comp.races.length, 15);
    assert.equal(comp.professions.length, 42);
    assert.equal(comp.conditions.length, 24);
    assert.equal(comp.skills.length, 66);
    assert.equal(comp.combatTechniques.length, 37);
    assert.equal(comp.spells.length, 187);
    assert.equal(comp.weapons.length, 52);
    assert.equal(comp.armor.length, 28);
    assert.equal(comp.gear.length, 68);
    assert.equal(comp.bestiary.length, 48);

    assert.equal(tagmar3Engine.getCompendiumCategories().length, 10);
    assert.ok(getSpecializationsForProfession("sacerdote").length >= 13);
    assert.ok(getSpellsByProfession("mago", "Elemental").length >= 5);
    assert.ok(searchTagmarCompendium("dragao").bestiary.length >= 1);

    const goblin = tagmar3Engine.createCharacterFromBestiary?.("goblin-comum");
    assert.ok(goblin);
    assert.equal(goblin.systemId, "tagmar-3");
    assert.equal(goblin.kind, "monster");
    assert.equal(goblin.name, "Goblin Comum");
    assert.equal(goblin.resources.ef.max, 9);
    assert.equal(goblin.resources.eh.max, 8);
    assert.equal(goblin.computed.defesaAtiva, 4);

    // Zero-drift invariant across ALL 48 spawned bestiary creatures when recomputed by sheets/combat
    for (const mob of comp.bestiary) {
      const draft = spawnBestiaryMonster(mob.id);
      assert.ok(draft, `spawnBestiaryMonster failed for ${mob.id}`);
      const full: Character = {
        id: `mob-${mob.id}`,
        campaignId: "camp-tagmar",
        updatedAt: "2026-11-19T00:00:00Z",
        ...draft,
      };
      const recomputed = tagmar3Engine.computeDerivedStats(full);
      assert.equal(recomputed.resourceMax.eh, mob.ehMax, `${mob.id} ehMax drift`);
      assert.equal(recomputed.resourceMax.ef, mob.efMax, `${mob.id} efMax drift`);
      assert.equal(recomputed.resourceMax.karma, mob.karmaMax, `${mob.id} karmaMax drift`);
      assert.equal(recomputed.computed.defesaAtiva, mob.defesaAtiva, `${mob.id} DA drift`);
      assert.equal(recomputed.computed.defesaPassiva, mob.defesaPassiva, `${mob.id} DP drift`);
      assert.equal(recomputed.computed.absorcao, mob.absorcao, `${mob.id} Absorção drift`);
      assert.equal(recomputed.computed.rf, mob.rf, `${mob.id} RF drift`);
      assert.equal(recomputed.computed.rm, mob.rm, `${mob.id} RM drift`);
      assert.equal(recomputed.computed.vb, mob.vb, `${mob.id} VB drift`);
      const weapons = recomputed.computed.equippedWeapons as Array<{ column: number }>;
      if (mob.attacks.length > 0) {
        assert.equal(weapons[0]?.column, mob.attacks[0].column, `${mob.id} attack[0] column drift`);
      }
    }

    // Every spell appliesCondition must resolve to a canonical Tagmar condition
    for (const sp of comp.spells) {
      if (sp.automation?.appliesCondition) {
        const applied = tagmar3Engine.applyCondition(
          { id: "c-test", campaignId: "camp", updatedAt: "", ...goblin },
          sp.automation.appliesCondition
        );
        const added = applied.conditions?.[0];
        assert.ok(added, `condition failed for spell ${sp.id}`);
        assert.ok(
          comp.conditions.some((c) => c.id === added.id),
          `spell ${sp.id} appliesCondition=${sp.automation.appliesCondition} did not resolve to canonical condition (got ${added.id})`
        );
      }
    }
  });
});
