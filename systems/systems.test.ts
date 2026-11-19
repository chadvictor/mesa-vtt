import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateExpression, interpolateFormula, runMacro, SandboxError } from "./sandbox";
import { getSystemEngine, listSystemManifests, registerSystem } from "./registry";
import { mightyBlade3eEngine } from "./mighty-blade-3e/engine";
import { genericRpgEngine } from "./generic-rpg/engine";
import type { Character, RollResult } from "./types";

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
  it("lists built-in systems, resolves fallback, and supports custom registration", () => {
    const manifests = listSystemManifests();
    assert.ok(manifests.some((m) => m.id === "mighty-blade-3e"));
    assert.ok(manifests.some((m) => m.id === "generic-rpg"));
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
