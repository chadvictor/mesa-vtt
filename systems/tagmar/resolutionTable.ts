/**
 * Mesa VTT — Tagmar 3.0 Official Resolution Table & Resistance Table Engine.
 * Pure TypeScript, zero-eval, backed directly by `data/tagmar/rules.json`.
 *
 * Implements:
 * - `resolveTagmarRoll(d20, column)`: Exact lookup across columns -7..20 plus the
 *   official Tagmar 3.0 `>20` overflow rule (subtract 20 repeatedly, +2 tiers per step).
 * - `resolveTagmarResistance(d20, fa, fd)`: Exact RF/RM target matrix (FD -2..20 × FA 1..20)
 *   with verified piecewise formula fallback outside matrix bounds.
 * - `computeWeaponDamage(weaponDamage, color, extraTiers)`: Authentic Tagmar 4-tier color
 *   damage (Verde 25% / Amarelo 50% / Laranja 75% / Vermelho 100%) + Azul Critical direct-to-EF!
 */

import rulesJson from "../../data/tagmar/rules.json";
import type { TagmarColorDamage, TagmarResolutionColor } from "../types";

export interface TagmarColorMeta {
  color: TagmarResolutionColor;
  label: string;
  shortLabel: string;
  hex: string;
  percent: number;
  multiplier: number;
  isSuccess: boolean;
  isCritical: boolean;
  isFumble: boolean;
  directToEf: boolean;
  officialBookColor: string;
}

export const TAGMAR_COLOR_ORDER: TagmarResolutionColor[] = [
  "erro_critico",
  "falha",
  "verde",
  "amarelo",
  "laranja",
  "vermelho",
  "azul",
];

const HIT_TIERS: Array<"verde" | "amarelo" | "laranja" | "vermelho" | "azul"> = [
  "verde",
  "amarelo",
  "laranja",
  "vermelho",
  "azul",
];

export const TAGMAR_COLOR_META: Record<TagmarResolutionColor, TagmarColorMeta> = {
  erro_critico: {
    color: "erro_critico",
    label: "Erro Crítico",
    shortLabel: "ERRO CRÍTICO",
    hex: "#991b1b",
    percent: 0,
    multiplier: 0,
    isSuccess: false,
    isCritical: false,
    isFumble: true,
    directToEf: false,
    officialBookColor: "Verde (Falha Crítica)",
  },
  falha: {
    color: "falha",
    label: "Falha",
    shortLabel: "FALHA",
    hex: "#64748b",
    percent: 0,
    multiplier: 0,
    isSuccess: false,
    isCritical: false,
    isFumble: false,
    directToEf: false,
    officialBookColor: "Branco (Rotineiro / Erro)",
  },
  verde: {
    color: "verde",
    label: "Verde (25%)",
    shortLabel: "VERDE · 25%",
    hex: "#22c55e",
    percent: 25,
    multiplier: 0.25,
    isSuccess: true,
    isCritical: false,
    isFumble: false,
    directToEf: false,
    officialBookColor: "Amarelo (Fácil / 25%)",
  },
  amarelo: {
    color: "amarelo",
    label: "Amarelo (50%)",
    shortLabel: "AMARELO · 50%",
    hex: "#eab308",
    percent: 50,
    multiplier: 0.5,
    isSuccess: true,
    isCritical: false,
    isFumble: false,
    directToEf: false,
    officialBookColor: "Laranja (Médio / 50%)",
  },
  laranja: {
    color: "laranja",
    label: "Laranja (75%)",
    shortLabel: "LARANJA · 75%",
    hex: "#f97316",
    percent: 75,
    multiplier: 0.75,
    isSuccess: true,
    isCritical: false,
    isFumble: false,
    directToEf: false,
    officialBookColor: "Vermelho (Difícil / 75%)",
  },
  vermelho: {
    color: "vermelho",
    label: "Vermelho (100%)",
    shortLabel: "VERMELHO · 100%",
    hex: "#ef4444",
    percent: 100,
    multiplier: 1.0,
    isSuccess: true,
    isCritical: false,
    isFumble: false,
    directToEf: false,
    officialBookColor: "Azul Claro (Muito Difícil / 100%)",
  },
  azul: {
    color: "azul",
    label: "Azul — Crítico! (125%)",
    shortLabel: "AZUL · CRÍTICO",
    hex: "#38bdf8",
    percent: 125,
    multiplier: 1.25,
    isSuccess: true,
    isCritical: true,
    isFumble: false,
    directToEf: true,
    officialBookColor: "Azul Escuro / Cinza (Absurdo / Crítico)",
  },
};

export interface TagmarResolutionRow {
  column: number;
  erroCritico: [number, number] | null;
  falha: [number, number] | null;
  verde: [number, number] | null;
  amarelo: [number, number] | null;
  laranja: [number, number] | null;
  vermelho: [number, number] | null;
  azul: [number, number] | null;
  hitChancePercent: number;
  avgDamagePercent: number;
}

export interface TagmarRollResolution {
  d20: number;
  column: number;
  effectiveColumn: number;
  overflowTiers: number;
  overflowSteps: number;
  baseColor: TagmarResolutionColor;
  color: TagmarResolutionColor;
  label: string;
  shortLabel: string;
  hex: string;
  percent: number;
  multiplier: number;
  damageTier: number;
  isSuccess: boolean;
  isCritical: boolean;
  isFumble: boolean;
  directToEf: boolean;
  officialBookColor: string;
}

export interface TagmarResistanceResolution {
  d20: number;
  fa: number;
  fd: number;
  target: number;
  resisted: boolean;
  isCritical: boolean;
  isFumble: boolean;
}

export interface TagmarComputedDamage {
  damage: number;
  directToEf: boolean;
  appliedColor: TagmarResolutionColor;
  extraBonusPercent: number;
}

const MIN_COL = rulesJson.resolutionTable.minColumn; // -7
const MAX_COL = rulesJson.resolutionTable.maxColumn; // 20
const OVERFLOW_STEP = rulesJson.resolutionTable.overflowRule.aboveMaxColumn.step; // 20
const OVERFLOW_TIERS_PER_STEP = rulesJson.resolutionTable.overflowRule.aboveMaxColumn.bonusDamageTiersPerStep; // 2

const resolutionColumns = rulesJson.resolutionTable.columns as unknown as TagmarResolutionRow[];
const byColumnMap = rulesJson.resolutionTable.byColumn as unknown as Record<
  string,
  {
    erroCritico: [number, number] | null;
    falha: [number, number] | null;
    verde: [number, number] | null;
    amarelo: [number, number] | null;
    laranja: [number, number] | null;
    vermelho: [number, number] | null;
    azul: [number, number] | null;
  }
>;
const resistanceMatrix = rulesJson.resistanceTable.matrix as unknown as Record<
  string,
  Record<string, number>
>;

function inRange(value: number, range: [number, number] | null | undefined): boolean {
  return Array.isArray(range) && value >= range[0] && value <= range[1];
}

/** Returns the raw Tagmar 3.0 Resolution Table row for a clamped column (-7..20). */
export function getResolutionRow(column: number): TagmarResolutionRow {
  const clamped = Math.max(MIN_COL, Math.min(MAX_COL, Math.trunc(column)));
  const found = resolutionColumns.find((r) => r.column === clamped);
  return found ?? resolutionColumns[0];
}

/** Returns all 28 official Tagmar 3.0 Resolution Table rows (-7..20) for UI display. */
export function getAllResolutionRows(): TagmarResolutionRow[] {
  return resolutionColumns;
}

/**
 * Resolves a Tagmar 3.0 `1d20` roll on the official Tabela de Resolução.
 * Supports:
 * - Columns `< -7`: clamped to `-7` (30% minimum hit chance).
 * - Columns `-7..20`: exact direct lookup.
 * - Columns `> 20`: official Tagmar overflow rule — subtracts 20 repeatedly until `1..20`,
 *   adding `+2` color tiers (`+50%`) per 20 subtracted (without overriding Erro Crítico on nat 1!).
 */
export function resolveTagmarRoll(d20Input: number, columnInput: number): TagmarRollResolution {
  const d20 = Math.max(1, Math.min(20, Math.round(d20Input)));
  const rawCol = Math.trunc(columnInput);

  let effectiveColumn = rawCol;
  let overflowSteps = 0;

  if (effectiveColumn < MIN_COL) {
    effectiveColumn = MIN_COL;
  } else if (effectiveColumn > MAX_COL) {
    while (effectiveColumn > MAX_COL) {
      effectiveColumn -= OVERFLOW_STEP;
      overflowSteps += 1;
    }
    if (effectiveColumn < 1) {
      effectiveColumn = 1;
    }
  }

  const overflowTiers = overflowSteps * OVERFLOW_TIERS_PER_STEP;
  const row = byColumnMap[String(effectiveColumn)] ?? byColumnMap[String(MIN_COL)];

  let baseColor: TagmarResolutionColor = "falha";
  if (inRange(d20, row.erroCritico)) {
    baseColor = "erro_critico";
  } else if (inRange(d20, row.falha)) {
    baseColor = "falha";
  } else if (inRange(d20, row.verde)) {
    baseColor = "verde";
  } else if (inRange(d20, row.amarelo)) {
    baseColor = "amarelo";
  } else if (inRange(d20, row.laranja)) {
    baseColor = "laranja";
  } else if (inRange(d20, row.vermelho)) {
    baseColor = "vermelho";
  } else if (inRange(d20, row.azul)) {
    baseColor = "azul";
  }

  // Apply official Tagmar >20 column overflow (+2 tiers / +50% per 20 columns above 20).
  // Natural Erro Crítico (1) still fumbles; misses/hits promote smoothly up to Azul (Crítico).
  let finalColor: TagmarResolutionColor = baseColor;
  let excessOverflowTiers = 0;

  if (overflowTiers > 0 && baseColor !== "erro_critico") {
    if (baseColor === "falha") {
      // On >20 overflow, a plain miss becomes at least a promoted hit tier
      const idx = Math.min(HIT_TIERS.length - 1, overflowTiers - 1);
      finalColor = HIT_TIERS[idx];
      excessOverflowTiers = Math.max(0, overflowTiers - 1 - (HIT_TIERS.length - 1));
    } else {
      const baseIdx = HIT_TIERS.indexOf(baseColor);
      const promotedIdx = baseIdx + overflowTiers;
      if (promotedIdx >= HIT_TIERS.length) {
        finalColor = "azul";
        excessOverflowTiers = promotedIdx - (HIT_TIERS.length - 1);
      } else {
        finalColor = HIT_TIERS[promotedIdx];
      }
    }
  }

  const meta = TAGMAR_COLOR_META[finalColor];
  const extraPercent = excessOverflowTiers * 25;
  const finalPercent = meta.percent > 0 ? meta.percent + extraPercent : 0;
  const damageTier =
    finalColor === "erro_critico" || finalColor === "falha"
      ? 0
      : HIT_TIERS.indexOf(finalColor) + 1 + excessOverflowTiers;

  return {
    d20,
    column: rawCol,
    effectiveColumn,
    overflowTiers,
    overflowSteps,
    baseColor,
    color: finalColor,
    label: extraPercent > 0 ? `${meta.label} (+${extraPercent}%)` : meta.label,
    shortLabel: meta.shortLabel,
    hex: meta.hex,
    percent: finalPercent,
    multiplier: finalPercent / 100,
    damageTier,
    isSuccess: meta.isSuccess,
    isCritical: meta.isCritical,
    isFumble: meta.isFumble,
    directToEf: meta.directToEf,
    officialBookColor: meta.officialBookColor,
  };
}

/**
 * Looks up (or computes via verified Tagmar 3.0 formula outside bounds) the minimum `1d20`
 * roll required to resist an effect of Force of Attack (`fa`) with Force of Defense (`fd`).
 */
export function getResistanceTarget(faInput: number, fdInput: number): number {
  const fa = Math.trunc(faInput);
  const fd = Math.trunc(fdInput);

  const row = resistanceMatrix[String(fd)];
  if (row && typeof row[String(fa)] === "number") {
    return row[String(fa)];
  }

  // Exact verified Tagmar 3.0 piecewise formula (matches 100% of 460 matrix cells)
  const d = fa - fd;
  let target: number;
  if (d >= -4 && d <= 4) {
    target = 11 + d;
  } else if (d > 4) {
    target = 15 + Math.floor((d - 4) / 2);
  } else {
    target = 7 - Math.floor((-d - 4) / 2);
  }
  return Math.max(2, Math.min(20, target));
}

/**
 * Resolves a Tagmar 3.0 Resistance roll (`RF` or `RM`):
 * `1d20 >= target` succeeds; natural `1` always fails; natural `20` always resists.
 */
export function resolveTagmarResistance(
  d20Input: number,
  faInput: number,
  fdInput: number
): TagmarResistanceResolution {
  const d20 = Math.max(1, Math.min(20, Math.round(d20Input)));
  const fa = Math.trunc(faInput);
  const fd = Math.trunc(fdInput);
  const target = getResistanceTarget(fa, fd);

  const isFumble = d20 === 1;
  const isCritical = d20 === 20;
  const resisted = isCritical ? true : isFumble ? false : d20 >= target;

  return {
    d20,
    fa,
    fd,
    target,
    resisted,
    isCritical,
    isFumble,
  };
}

/**
 * Computes exact weapon or spell color-coded damage from a Tagmar 4/5-tier damage table
 * (`verde` 25%, `amarelo` 50%, `laranja` 75%, `vermelho` 100%, `azul` Crítico / 125% direct to EF).
 */
export function computeWeaponDamage(
  weaponDamage: TagmarColorDamage,
  color: TagmarResolutionColor,
  extraTiers = 0
): TagmarComputedDamage {
  if (color === "erro_critico" || color === "falha") {
    return { damage: 0, directToEf: false, appliedColor: color, extraBonusPercent: 0 };
  }

  const baseIdx = HIT_TIERS.indexOf(color);
  const promotedIdx = baseIdx + Math.max(0, Math.trunc(extraTiers));
  const clampedIdx = Math.min(HIT_TIERS.length - 1, promotedIdx);
  const excessTiers = Math.max(0, promotedIdx - (HIT_TIERS.length - 1));
  const appliedColor = HIT_TIERS[clampedIdx];

  let baseDamage: number;
  switch (appliedColor) {
    case "verde":
      baseDamage = weaponDamage.verde;
      break;
    case "amarelo":
      baseDamage = weaponDamage.amarelo;
      break;
    case "laranja":
      baseDamage = weaponDamage.laranja;
      break;
    case "vermelho":
      baseDamage = weaponDamage.vermelho;
      break;
    case "azul":
      baseDamage =
        typeof weaponDamage.azul === "number" && weaponDamage.azul > 0
          ? weaponDamage.azul
          : Math.max(weaponDamage.vermelho + 1, Math.round(weaponDamage.vermelho * 1.25));
      break;
  }

  const stepUnit = Math.max(1, Math.round(weaponDamage.vermelho * 0.25));
  const finalDamage = Math.max(0, Math.round(baseDamage + excessTiers * stepUnit));

  return {
    damage: finalDamage,
    directToEf: appliedColor === "azul",
    appliedColor,
    extraBonusPercent: excessTiers * 25,
  };
}

export { resistanceMatrix as tagmarResistanceMatrix };
