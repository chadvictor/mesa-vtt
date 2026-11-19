# 🧩 Criando Novos Sistemas de RPG no Mesa VTT

> **🇧🇷 Guia Prático para Desenvolvedores** · *English note: all code contracts, TypeScript interfaces, file paths, and examples below use the exact English identifiers from [`systems/types.ts`](../systems/types.ts), so international contributors can follow every step directly.*

O **Mesa VTT** foi construído com uma arquitetura **multisistema modular e zero-`eval`**: cada sistema de RPG vive em seu próprio diretório dentro de `systems/<system-id>/`, implementa a interface pura TypeScript `RpgSystemEngine` e pode opcionalmente carregar compêndios estruturados em `data/<system-id>/*.json`.

Este guia mostra passo a passo como criar, registrar, testar e integrar um novo sistema — e termina com um **blueprint concreto pronto para começar a construir o [Tagmar](#-blueprint-prático-criando-o-sistema-tagmar)**, o próximo RPG brasileiro open source oficial do Mesa VTT!

---

## 📁 1. Anatomia de um Sistema no Mesa VTT

Observe como os sistemas embutidos (`mighty-blade-3e` e `generic-rpg`) e um novo sistema (ex.: `tagmar`) se organizam no repositório:

```text
mesa-vtt/
├── data/
│   ├── embed.go                      # Embute JSONs estáticos no binário Go (opcional por sistema)
│   ├── mighty-blade/                 # Compêndio oficial Mighty Blade 3ª Edição (8 JSONs)
│   └── <system-id>/                  # (Opcional) Compêndio JSON do seu sistema (ex.: data/tagmar/)
│       ├── rules.json
│       ├── races.json
│       ├── professions.json
│       ├── spells.json
│       ├── equipment.json
│       └── bestiary.json
└── systems/
    ├── types.ts                      # Contratos compartilhados (SystemManifest, SystemSchema, RpgSystemEngine)
    ├── sandbox.ts                    # Interpretador AST zero-eval para fórmulas e macros
    ├── registry.ts                   # Registro central de sistemas ativos
    ├── systems.test.ts               # Suíte de testes unitários dos sistemas e do sandbox
    ├── mighty-blade-3e/              # Sistema carro-chefe completo (2d6, assistente 5 passos, compêndio)
    ├── generic-rpg/                  # Sistema livre personalizável (ótimo modelo minimalista)
    └── <system-id>/                  # 👈 Seu novo sistema!
        ├── manifest.json             # Metadados, dado padrão, cores e flags
        ├── schema.json               # Atributos, barras de recursos, derivados e abas da ficha
        ├── compendium.ts             # (Opcional) Carregamento tipado de @data/<system-id>/*.json
        └── engine.ts                 # Implementação pura e determinística de RpgSystemEngine
```

> **Aliases configurados no Vite/TypeScript (`client/tsconfig.json`):**
> - `@systems/*` → `../systems/*`
> - `@data/*` → `../data/*`
>
> **Regra de ouro:** todo código em `systems/` deve ser **TypeScript puro e determinístico**, sem acesso a `window`, `document`, `fetch`, `Math.random()` (o servidor Go gera todos os dados via `crypto/rand`) ou `eval()`.

---

## 🛠️ 2. Passo a Passo: Construindo `systems/<system-id>/`

### Passo 1 — Crie `manifest.json` (`SystemManifest`)

Define a identidade do sistema no Lobby, no seletor de criação de campanha, na barra rápida de dados e no tema visual:

```json
{
  "id": "meu-sistema",
  "name": "Meu Sistema de RPG",
  "shortName": "Meu RPG",
  "version": "1.0.0",
  "author": "Seu Nome / Comunidade Mesa VTT",
  "description": "Resumo curto do sistema, mecânica principal de dados e automações incluídas.",
  "language": "pt-BR",
  "diceDefaults": {
    "coreFormula": "1d20",
    "quickDice": [20, 4, 6, 8, 10, 12, 100]
  },
  "theme": {
    "primary": "#1c1917",
    "accent": "#d97706",
    "badge": "v1.0 · Comunidade"
  },
  "supportsWizard": false
}
```

### Passo 2 — Crie `schema.json` (`SystemSchema`)

Descreve declarativamente os atributos, barras de recurso (usadas nas fichas, sidebar e tokens no mapa), atributos derivados e abas da ficha:

```json
{
  "attributes": [
    { "key": "forca", "label": "Força", "abbr": "FOR", "min": -5, "max": 20, "defaultValue": 0, "description": "Potência física." }
  ],
  "resources": [
    { "key": "pv", "label": "Pontos de Vida", "abbr": "PV", "color": "#22c55e" },
    { "key": "pm", "label": "Pontos de Mana", "abbr": "PM", "color": "#3b82f6" }
  ],
  "derivedStats": [
    { "key": "defesa", "label": "Defesa", "abbr": "DEF", "formulaHint": "10 + Agilidade + Armadura" }
  ],
  "sheetTabs": [
    { "id": "resumo", "label": "Resumo" },
    { "id": "combate", "label": "Combate" },
    { "id": "habilidades", "label": "Habilidades" },
    { "id": "inventario", "label": "Equipamentos" },
    { "id": "notas", "label": "Notas" }
  ],
  "equipmentSlots": ["weapon", "armor", "shield", "gear", "consumable"]
}
```

### Passo 3 — Implemente `engine.ts` (`RpgSystemEngine`)

A interface `RpgSystemEngine` em [`systems/types.ts`](../systems/types.ts) divide a automação em **5 responsabilidades puras**:

| Grupo | Métodos obrigatórios | Papel na mesa |
|---|---|---|
| **1. Estatísticas Derivadas** | `computeDerivedStats(character)` | Recalcula `computed` (defesas, resistências, deslocamento, carga) e `resourceMax` a partir de `character.systemData`, equipamentos equipados e `character.conditions`. |
| **2. Criação de Personagem** | `createCharacterFromWizard(input)` | Constrói um `Character` completo e pronto para salvar (via assistente guiado ou ficha inicial padrão). |
| **3. Planejamento de Rolagens** | `buildRollRequest(...)`, `planAttributeCheck(...)`, `planAttack(...)`, `planAbility(...)`, `planSpell(...)`, `planInitiative(...)` | Retorna um `RollPlan` (`formula`, `label`, `difficulty`, `targetDefense`, `manaCost`, `systemMeta`) que é enviado ao servidor Go via WebSocket `dice.roll`. |
| **4. Resolução de Resultados** | `resolveRollOutcome(roll, actor, target)` e alias `evaluateRoll(...)` | Recebe o `RollResult` sorteado pelo servidor (`crypto/rand`) e retorna `{ outcome, actions }`: selo de resultado (`critical` \| `fumble` \| `success` \| `failure` \| `info`) + botões clicáveis no chat (`InteractiveAction[]`: `apply_damage`, `apply_heal`, `spend_mana`, `apply_condition`, `roll_followup`). |
| **5. Mutadores de Estado & Compêndio** | `applyDamage`, `applyHealing`, `spendMana`, `applyCondition`, `removeCondition`, `levelUp`, `rest`, `shortRest`, `longRest`, `getCompendium`, `getCompendiumCategories`, `createCharacterFromBestiary?` | Retornam `Partial<Character>` puros prontos para `character.patch` — nunca mutam o objeto de entrada no lugar! |

> 💡 **Dica de referência:**
> - Para um sistema completo com compêndio extenso, consulte [`systems/mighty-blade-3e/engine.ts`](../systems/mighty-blade-3e/engine.ts).
> - Para uma implementação enxuta e fácil de copiar como esqueleto, consulte [`systems/generic-rpg/engine.ts`](../systems/generic-rpg/engine.ts).

### Passo 4 — Aproveite o Sandbox AST Zero-`eval` (`systems/sandbox.ts`)

Você não precisa escrever um parser de fórmulas do zero. Importe as funções seguras de [`systems/sandbox.ts`](../systems/sandbox.ts):

- `interpolateFormula(formula, ctx)` — substitui `@forca`, `@nivel`, `@target.defesa`, etc. em fórmulas de dados (ex.: `"1d20 + @agilidade + 2"` → `"1d20 + 4 + 2"`).
- `evaluateExpression(expr, ctx)` — avalia aritmética, ternários e helpers matemáticos (`floor`, `ceil`, `round`, `abs`, `min`, `max`, `clamp`, `num`, `str`, `upper`, `lower`).
- `runMacro(script, ctx)` — executa macros multi-linha dos jogadores retornando `MacroCommand[]` estruturados (`roll`, `rollAttack`, `rollAbility`, `rollSpell`, `spend`, `spendPM`, `spendPV`, `heal`, `damage`, `condition`, `say`, `ooc`, `emote`).

Limites de segurança já aplicados automaticamente pelo sandbox: máximo de `4096` caracteres, `500` nós AST, profundidade `32`, `200` passos de execução, `25` comandos por macro e bloqueio rígido de chaves perigosas (`__proto__`, `prototype`, `constructor`).

### Passo 5 — Checklist de Integração no Repositório

Depois de criar `systems/<system-id>/`, conecte o sistema nos seguintes pontos do Mesa VTT:

1. **Registro de Engines ([`systems/registry.ts`](../systems/registry.ts)):**
   Importe seu engine e adicione-o ao `Map` `engines` (ou use `registerSystem(engine)` para plugins dinâmicos).
2. **Backend Go — Lista de Sistemas ([`server/internal/api/router.go`](../server/internal/api/router.go)):**
   Adicione `"<system-id>"` ao slice `"systems"` retornado por `GET /api/v1/config`.
3. **Backend Go — Validação de Campanha ([`server/internal/api/campaign_handlers.go`](../server/internal/api/campaign_handlers.go)):**
   Inclua `"<system-id>"` na validação de `systemId` aceito ao criar novas campanhas.
4. **Backend Go — Compêndio via API *(opcional)* ([`data/embed.go`](../data/embed.go) e [`server/internal/api/content_handlers.go`](../server/internal/api/content_handlers.go)):**
   Se o sistema possuir JSONs em `data/<system-id>/`, adicione `//go:embed <system-id>/*.json` em `data/embed.go` e exponha a rota `/api/v1/compendium/<system-id>/<arquivo>`.
5. **Frontend — Lobby & Criação de Campanha:**
   - [`client/src/components/lobby/CreateCampaignModal.tsx`](../client/src/components/lobby/CreateCampaignModal.tsx) — adicione o card/opção do sistema.
   - [`client/src/components/lobby/CampaignLobby.tsx`](../client/src/components/lobby/CampaignLobby.tsx) — adicione o filtro de sistema.
   - [`client/src/components/dice/QuickDiceBar.tsx`](../client/src/components/dice/QuickDiceBar.tsx) — *(opcional)* destaque o dado principal do sistema (ex.: `1d20` para Tagmar).
6. **Frontend — Ficha & Assistente *(opcional)*:**
   O Mesa VTT já renderiza atributos, recursos e ações usando o `schema.json`. Se desejar um assistente guiado de criação ou abas especializadas (como a Tabela de Resolução interativa do Tagmar), adicione um componente dedicado em `client/src/components/characters/` e defina `"supportsWizard": true` no `manifest.json`.

### Passo 6 — Escreva Testes Unitários (`systems/systems.test.ts`)

Todo sistema novo deve incluir cobertura em [`systems/systems.test.ts`](../systems/systems.test.ts) validando:

- Cálculo de estatísticas derivadas e recursos máximos (incluindo impacto de condições e armaduras)
- `planAttributeCheck`, `planAttack`, `planSpell` e `planInitiative`
- `resolveRollOutcome` para críticos, falhas críticas, sucessos e botões de ação gerados
- Mutadores de dano, cura, gasto de recurso e descansos
- Interpolação de fórmulas e macros no sandbox

Execute com:

```bash
bun test systems/systems.test.ts
# ou: node --experimental-strip-types --test systems/systems.test.ts
```

---

## 🛡️ Blueprint Prático: Criando o Sistema `tagmar`

> 🇧🇷 **Próximo Sistema Brasileiro Open Source Oficial!**
> **Tagmar** (1991) foi o primeiro RPG de fantasia medieval criado no Brasil e hoje é mantido gratuitamente pela comunidade do **Projeto Tagmar** sob licença aberta (Creative Commons). Este blueprint já mapeia a espinha dorsal exata para trazermos Tagmar nativamente ao Mesa VTT em `systems/tagmar/`.

### Estrutura proposta para `tagmar`

```text
data/tagmar/
├── rules.json          # Tabela de Resolução (colunas -7 a 20), evolução e combate
├── races.json          # Humanos, Elfos Dourados, Elfos Florestais, Anões, Pequeninos, Meio-Elfos
├── professions.json    # Guerreiro, Ladino, Mago, Sacerdote, Rastreador, Bardo
├── skills.json         # Habilidades, grupos de habilidades e especializações
├── spells.json         # Magias por profissão e colégio elemental/divino
├── equipment.json      # Armas (com tabela de dano L/M/P), armaduras (absorção/defesa) e itens
└── bestiary.json       # Criaturas clássicas do mundo conhecido de Tagmar

systems/tagmar/
├── manifest.json       # Identidade e tema Tagmar
├── schema.json         # 6 atributos, EF/EH/Karma e derivados
├── resolutionTable.ts  # Tabela de Resolução 1d20 por colunas (Verde → Cinza + Crítico)
└── engine.ts           # Implementação de RpgSystemEngine
```

### 1. `systems/tagmar/manifest.json`

```json
{
  "id": "tagmar",
  "name": "Tagmar 3.0",
  "shortName": "Tagmar",
  "version": "0.1.0",
  "author": "Projeto Tagmar (Regras Abertas CC) · Automação Comunidade Mesa VTT",
  "description": "O clássico pioneiro RPG brasileiro de fantasia medieval, com automação da Tabela de Resolução 1d20 por colunas, Energia Física (EF), Energia Heroica (EH), Karma, profissões e magias.",
  "language": "pt-BR",
  "diceDefaults": {
    "coreFormula": "1d20",
    "quickDice": [20, 10, 6, 4, 8, 12, 100]
  },
  "theme": {
    "primary": "#1c1412",
    "accent": "#c2410c",
    "badge": "Tagmar · Em Desenvolvimento"
  },
  "supportsWizard": true
}
```

### 2. `systems/tagmar/schema.json`

```json
{
  "attributes": [
    { "key": "intelecto", "label": "Intelecto", "abbr": "INT", "min": -5, "max": 10, "defaultValue": 0, "description": "Raciocínio, conhecimento e habilidades mentais." },
    { "key": "aura", "label": "Aura", "abbr": "AUR", "min": -5, "max": 10, "defaultValue": 0, "description": "Força mística, Karma e resistência à magia." },
    { "key": "carisma", "label": "Carisma", "abbr": "CAR", "min": -5, "max": 10, "defaultValue": 0, "description": "Presença, liderança e persuasão." },
    { "key": "forca", "label": "Força", "abbr": "FOR", "min": -5, "max": 10, "defaultValue": 0, "description": "Potência muscular, ataque corpo a corpo e dano." },
    { "key": "fisico", "label": "Físico", "abbr": "FIS", "min": -5, "max": 10, "defaultValue": 0, "description": "Vigor, Energia Física (EF) e resistência física." },
    { "key": "agilidade", "label": "Agilidade", "abbr": "AGI", "min": -5, "max": 10, "defaultValue": 0, "description": "Reflexos, Defesa Ativa, iniciativa e ataques à distância." }
  ],
  "resources": [
    { "key": "eh", "label": "Energia Heroica", "abbr": "EH", "color": "#22c55e" },
    { "key": "ef", "label": "Energia Física", "abbr": "EF", "color": "#ef4444" },
    { "key": "karma", "label": "Karma", "abbr": "KRM", "color": "#8b5cf6" }
  ],
  "derivedStats": [
    { "key": "defesaAtiva", "label": "Defesa Ativa", "abbr": "DEF", "formulaHint": "Base da Armadura + Agilidade + Escudo" },
    { "key": "defesaPassiva", "label": "Defesa Passiva", "abbr": "PAS", "formulaHint": "Base da Armadura" },
    { "key": "absorcao", "label": "Absorção", "abbr": "ABS", "formulaHint": "Armadura + Bônus de Proteção" },
    { "key": "resistenciaFisica", "label": "Resist. Física", "abbr": "RF", "formulaHint": "Estágio + Físico" },
    { "key": "resistenciaMagia", "label": "Resist. Magia", "abbr": "RM", "formulaHint": "Estágio + Aura" },
    { "key": "velocidade", "label": "Velocidade Base", "abbr": "VB", "formulaHint": "Base da Raça + Agilidade", "unit": "m" }
  ],
  "sheetTabs": [
    { "id": "resumo", "label": "Resumo" },
    { "id": "combate", "label": "Combate" },
    { "id": "habilidades", "label": "Habilidades" },
    { "id": "magias", "label": "Magias" },
    { "id": "inventario", "label": "Equipamentos" },
    { "id": "notas", "label": "História & Notas" }
  ],
  "equipmentSlots": ["weapon", "armor", "shield", "gear", "consumable", "magic"]
}
```

### 3. `systems/tagmar/resolutionTable.ts` — Tabela de Resolução `1d20`

Em Tagmar, o jogador rola **`1d20` puro** e cruza o resultado com a **Coluna de Resolução** (total da habilidade/ataque + atributo + modificadores) para descobrir a **cor do resultado** (*Falha*, *Verde*, *Amarelo*, *Laranja*, *Vermelho*, *Azul*, *Cinza* ou *Crítico*).

Veja como isso se encaixa perfeitamente no contrato `RollEvaluation` do Mesa VTT:

```ts
export type TagmarResultColor =
  | "falha_critica"
  | "falha"
  | "verde"
  | "amarelo"
  | "laranja"
  | "vermelho"
  | "azul"
  | "cinza"
  | "critico";

export interface TagmarThresholdRow {
  /** Valor mínimo no 1d20 para atingir cada faixa de cor na coluna. */
  verde: number;
  amarelo: number;
  laranja: number;
  vermelho: number;
  azul: number;
  cinza: number;
}

/**
 * Amostra da Tabela de Resolução (colunas 1..10; expandir para -7..20 via data/tagmar/rules.json).
 * `99` indica faixa inatingível naquela coluna sem Crítico (20 natural).
 */
const SAMPLE_TABLE: Record<number, TagmarThresholdRow> = {
  1:  { verde: 15, amarelo: 19, laranja: 20, vermelho: 99, azul: 99, cinza: 99 },
  3:  { verde: 13, amarelo: 17, laranja: 19, vermelho: 20, azul: 99, cinza: 99 },
  5:  { verde: 11, amarelo: 15, laranja: 18, vermelho: 19, azul: 20, cinza: 99 },
  8:  { verde: 8,  amarelo: 12, laranja: 15, vermelho: 17, azul: 19, cinza: 20 },
  10: { verde: 6,  amarelo: 10, laranja: 13, vermelho: 16, azul: 18, cinza: 19 },
};

export function resolveTagmarColumn(column: number, d20: number): TagmarResultColor {
  if (d20 === 1) return "falha_critica";
  if (d20 === 20) return "critico";

  const clamped = Math.max(1, Math.min(10, Math.round(column)));
  const row = SAMPLE_TABLE[clamped] ?? SAMPLE_TABLE[5];

  if (d20 >= row.cinza) return "cinza";
  if (d20 >= row.azul) return "azul";
  if (d20 >= row.vermelho) return "vermelho";
  if (d20 >= row.laranja) return "laranja";
  if (d20 >= row.amarelo) return "amarelo";
  if (d20 >= row.verde) return "verde";
  return "falha";
}
```

### 4. Esqueleto de `systems/tagmar/engine.ts`

```ts
import manifestJson from "./manifest.json";
import schemaJson from "./schema.json";
import { resolveTagmarColumn, type TagmarResultColor } from "./resolutionTable";
import type {
  Character,
  InteractiveAction,
  RollEvaluation,
  RollPlan,
  RollResult,
  RpgSystemEngine,
  SystemManifest,
  SystemSchema,
} from "../types";

const COLOR_BADGES: Record<TagmarResultColor, string> = {
  falha_critica: "FALHA CRÍTICA (1 Natural)",
  falha: "FALHA",
  verde: "VERDE (Rotineiro)",
  amarelo: "AMARELO (Fácil)",
  laranja: "LARANJA (Médio)",
  vermelho: "VERMELHO (Difícil)",
  azul: "AZUL (Muito Difícil)",
  cinza: "CINZA (Absurdo)",
  critico: "CRÍTICO! (20 Natural)",
};

export const tagmarEngine: Partial<RpgSystemEngine> = {
  manifest: manifestJson as SystemManifest,
  schema: schemaJson as SystemSchema,

  planAttributeCheck(character: Character, attrKey: string, opts) {
    const attrs = (character.systemData?.attributes ?? {}) as Record<string, number>;
    const attrVal = Number(attrs[attrKey] ?? 0);
    const column = attrVal + (opts?.bonus ?? 0);

    // Em Tagmar, o dado lançado é 1d20 puro; a coluna vai em systemMeta!
    const plan: RollPlan = {
      formula: "1d20",
      label: opts?.label ?? `Teste de ${attrKey.toUpperCase()} (Col. ${column})`,
      difficulty: opts?.difficulty,
      systemMeta: { systemId: "tagmar", kind: "attribute", attrKey, column },
    };
    return plan;
  },

  resolveRollOutcome(roll: RollResult, _actor?: Character, target?: Character): RollEvaluation {
    const d20 = roll.dice.find((d) => d.sides === 20)?.value ?? roll.total;
    const column = Number(roll.systemMeta?.column ?? 5);
    const color = resolveTagmarColumn(column, d20);

    const actions: InteractiveAction[] = [];
    const baseDamage = Number(roll.systemMeta?.damagePercent ?? 0);
    if (target && baseDamage > 0 && color !== "falha" && color !== "falha_critica") {
      // Exemplo simplificado: calcula dano proporcional à cor (Verde 25% .. Crítico 100%+)
      const mult: Partial<Record<TagmarResultColor, number>> = {
        verde: 0.25, amarelo: 0.5, laranja: 0.75, vermelho: 1.0, azul: 1.0, cinza: 1.0, critico: 1.0,
      };
      const dmg = Math.max(1, Math.round(baseDamage * (mult[color] ?? 0.5)));
      actions.push({
        id: `tagmar-dmg-${roll.rollId}`,
        label: `Aplicar ${dmg} de Dano em ${target.name} (EH → EF)`,
        style: "damage",
        actionType: "apply_damage",
        targetCharacterId: target.id,
        payload: { amount: dmg, hitsPhysical: color === "azul" || color === "cinza" || color === "critico" },
      });
    }

    const kind =
      color === "critico" ? "critical" :
      color === "falha_critica" ? "fumble" :
      color === "falha" ? "failure" : "success";

    return {
      outcome: {
        kind,
        badgeText: `${COLOR_BADGES[color]} · Col. ${column} (d20 = ${d20})`,
      },
      actions,
    };
  },

  applyDamage(character: Character, amount: number) {
    // Regra clássica de Tagmar: dano normal reduz EH primeiro; excedente (ou crítico) atinge EF!
    const eh = character.resources.eh ?? { current: 20, max: 20 };
    const ef = character.resources.ef ?? { current: 14, max: 14 };
    const absorbByEh = Math.min(eh.current, Math.max(0, amount));
    const overflowToEf = Math.max(0, amount - absorbByEh);
    return {
      resources: {
        ...character.resources,
        eh: { ...eh, current: eh.current - absorbByEh },
        ef: { ...ef, current: Math.max(0, ef.current - overflowToEf) },
      },
    };
  },
};
```

### 5. Exemplo de Macro Tagmar no Sandbox Zero-`eval`

Qualquer jogador já pode criar macros assim usando [`systems/sandbox.ts`](../systems/sandbox.ts):

```js
// Magia: Chama de Ganis (custa 2 de Karma, rola 1d20 na Tabela de Resolução)
let coluna = 5 + @aura;
spend("karma", 2);
say(`Invoco a Chama de Ganis! (Coluna ${coluna})`);
roll("1d20", `Magia: Chama de Ganis (Col. ${coluna})`, { column: coluna });
```

### 6. Quer ajudar a lançar o Tagmar no Mesa VTT?

Se você ama Tagmar e quer liderar ou colaborar com o PR `system/tagmar`, este é o checklist completo:

- [ ] Estruturar a **Tabela de Resolução completa** (`colunas -7 a 20`) em `data/tagmar/rules.json` (seguindo os livros oficiais gratuitos do Projeto Tagmar)
- [ ] Estruturar `races.json`, `professions.json`, `skills.json`, `spells.json`, `equipment.json` e `bestiary.json` em `data/tagmar/` com os devidos créditos Creative Commons ao Projeto Tagmar
- [ ] Completar todos os métodos de `RpgSystemEngine` em `systems/tagmar/engine.ts` (incluindo tabela de dano L/M/P, dano direto em EF em sucessos críticos/azuis e recuperação de EH/EF/Karma)
- [ ] Registrar `tagmar` em `systems/registry.ts`, `server/internal/api/`, `CreateCampaignModal.tsx` e `CampaignLobby.tsx`
- [ ] Adicionar suíte completa de testes em `systems/systems.test.ts` (cobrindo todas as faixas de cor da Tabela de Resolução e absorção EH → EF)

Abra uma issue ou PR com a tag **`system/tagmar`** — vamos adorar revisar e construir juntos! 🎲🇧🇷
