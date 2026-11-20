# 🧩 Criando Novos Sistemas de RPG no Mesa VTT

> **🇧🇷 Guia Prático para Desenvolvedores** · *English note: all code contracts, TypeScript interfaces, file paths, and examples below use the exact English identifiers from [`systems/types.ts`](../systems/types.ts), so international contributors can follow every step directly.*

O **Mesa VTT** foi construído com uma arquitetura **multisistema modular e zero-`eval`**: cada sistema de RPG vive em seu próprio diretório dentro de `systems/<system-id>/`, implementa a interface pura TypeScript `RpgSystemEngine` e pode carregar compêndios estruturados em `data/<system-id>/*.json`.

Este guia mostra passo a passo como criar, registrar, testar e integrar um novo sistema — usando **`systems/tagmar/` (`tagmar-3`)** como **implementação real de referência em produção**!

---

## 📁 1. Anatomia de um Sistema no Mesa VTT

Observe como os **3 sistemas embutidos** (`mighty-blade-3e`, `tagmar-3` e `generic-rpg`) e um novo sistema da comunidade se organizam no repositório:

```text
mesa-vtt/
├── data/
│   ├── embed.go                      # Embute JSONs estáticos no binário Go (MightyBladeFS, TagmarFS, ...)
│   ├── mighty-blade/                 # Compêndio Mighty Blade 3ª Edição (8 JSONs)
│   ├── tagmar/                       # Compêndio oficial Tagmar 3.0 + Expansões (8 JSONs + LICENSE.md)
│   └── <system-id>/                  # (Opcional) Compêndio JSON do seu sistema
│       ├── LICENSE.md                # Licença/atribuição do conteúdo de regras (se diferente da MIT)
│       ├── rules.json
│       ├── races.json
│       ├── classes.json / professions.json
│       ├── conditions.json
│       ├── skills.json / abilities.json
│       ├── spells.json
│       ├── equipment.json
│       └── bestiary.json
└── systems/
    ├── types.ts                      # Contratos compartilhados (SystemManifest, SystemSchema, RpgSystemEngine)
    ├── sandbox.ts                    # Interpretador AST zero-eval para fórmulas e macros
    ├── registry.ts                   # Registro central de sistemas ativos + aliases
    ├── systems.test.ts               # Suíte de testes unitários dos sistemas e do sandbox
    ├── mighty-blade-3e/              # Referência completa (2d6, assistente 5 passos, compêndio)
    ├── tagmar/                       # 👈 Referência real de tabela 1d20 colorida, RF/RM e fluxo EH→Absorção→EF!
    │   ├── manifest.json             # Metadados, licença CC BY-NC-SA 3.0 BR, dado padrão 1d20, tema
    │   ├── schema.json               # 6 atributos, EH/EF/Karma, DA/DP/Absorção/RF/RM/VB e abas
    │   ├── resolutionTable.ts        # Tabela de Resolução (-7..20+) e Matriz de Resistências (460 células)
    │   ├── compendium.ts             # Loader tipado + busca + aliases de condições para @data/tagmar/*
    │   └── engine.ts                 # Implementação completa de RpgSystemEngine + spawner do Bestiário
    ├── generic-rpg/                  # Sistema livre personalizável (ótimo modelo minimalista)
    └── <system-id>/                  # Seu novo sistema!
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
  "license": "MIT",
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
    { "id": "combat", "label": "Combate" },
    { "id": "skills", "label": "Habilidades" },
    { "id": "equipment", "label": "Equipamentos" },
    { "id": "bio", "label": "Notas" }
  ],
  "equipmentSlots": ["weapon", "armor", "shield", "gear", "consumable"]
}
```

### Passo 3 — Implemente `engine.ts` (`RpgSystemEngine`)

A interface `RpgSystemEngine` em [`systems/types.ts`](../systems/types.ts) divide a automação em **5 responsabilidades puras**:

| Grupo | Métodos obrigatórios | Papel na mesa |
|---|---|---|
| **1. Estatísticas Derivadas** | `computeDerivedStats(character)` | Recalcula `computed` (defesas, resistências, deslocamento, carga, armas equipadas) e `resourceMax` a partir de `character.systemData`, equipamentos e `character.conditions`. |
| **2. Criação de Personagem** | `createCharacterFromWizard(input)` | Constrói um `Character` completo e pronto para salvar (via assistente guiado ou ficha inicial padrão). |
| **3. Planejamento de Rolagens** | `buildRollRequest(...)`, `planAttributeCheck(...)`, `planAttack(...)`, `planAbility(...)`, `planSpell(...)`, `planInitiative(...)` | Retorna um `RollPlan` (`formula`, `label`, `difficulty`, `targetDefense`, `manaCost`, `karmaCost`, `systemMeta`, etc.) enviado ao servidor Go via WebSocket `dice.roll`. |
| **4. Resolução de Resultados** | `resolveRollOutcome(roll, actor, target)` e alias `evaluateRoll(...)` | Recebe o `RollResult` sorteado pelo servidor (`crypto/rand`) e retorna `{ outcome, actions }`: selo de resultado (`critical` \| `fumble` \| `success` \| `failure` \| `info`) + botões clicáveis no chat (`InteractiveAction[]`: `apply_damage`, `apply_heal`, `spend_mana`, `spend_karma`, `spend_resource`, `apply_condition`, `roll_followup`). |
| **5. Mutadores de Estado & Compêndio** | `applyDamage`, `applyHealing`, `spendMana`, `applyCondition`, `removeCondition`, `levelUp`, `rest`, `shortRest`, `longRest`, `getCompendium`, `getCompendiumCategories`, `createCharacterFromBestiary?` | Retornam `Partial<Character>` puros prontos para `character.patch` — nunca mutam o objeto de entrada no lugar! |

> 💡 **Dicas de referência no repositório:**
> - **Sistema complexo com mecânicas próprias de tabela e fluxo de dano em 3 camadas:** estude [`systems/tagmar/`](../systems/tagmar/) (`tagmar-3`).
> - **Sistema clássico `2d6` com carga e verificação de FN:** estude [`systems/mighty-blade-3e/`](../systems/mighty-blade-3e/).
> - **Esqueleto enxuto para copiar e começar rápido:** estude [`systems/generic-rpg/engine.ts`](../systems/generic-rpg/engine.ts).

### Passo 4 — Aproveite o Sandbox AST Zero-`eval` (`systems/sandbox.ts`)

Você não precisa escrever um parser de fórmulas do zero. Importe as funções seguras de [`systems/sandbox.ts`](../systems/sandbox.ts):

- `interpolateFormula(formula, ctx)` — substitui `@forca`, `@agilidade`, `@rf`, `@target.bloqueio`, etc. em fórmulas de dados (ex.: `"1d10 + @agilidade"` → `"1d10 + 3"`).
- `evaluateExpression(expr, ctx)` — avalia aritmética, ternários e helpers matemáticos (`floor`, `ceil`, `round`, `abs`, `min`, `max`, `clamp`, `num`, `str`, `upper`, `lower`).
- `runMacro(script, ctx)` — executa macros multi-linha dos jogadores retornando `MacroCommand[]` estruturados (`roll`, `rollAttack`, `rollAbility`, `rollSpell`, `spend`, `spendPM`, `spendPV`, `heal`, `damage`, `condition`, `say`, `ooc`, `emote`), incluindo objetos de metadados no 3º argumento de `roll(formula, label, opts)`.

Limites de segurança aplicados automaticamente: máximo de `4096` caracteres, `500` nós AST, profundidade `32`, `200` passos de execução, `25` comandos por macro e bloqueio rígido de chaves perigosas (`__proto__`, `prototype`, `constructor`).

### Passo 5 — Checklist de Integração no Repositório

Depois de criar `systems/<system-id>/`, conecte o sistema nos seguintes pontos do Mesa VTT:

1. **Registro de Engines ([`systems/registry.ts`](../systems/registry.ts)):**
   Importe seu engine, registre-o em `engines` e adicione aliases amigáveis em `SYSTEM_ALIASES` se necessário.
2. **Backend Go — Lista de Sistemas ([`server/internal/api/router.go`](../server/internal/api/router.go)):**
   Adicione `"<system-id>"` ao slice `"systems"` retornado por `GET /api/v1/config`.
3. **Backend Go — Validação de Campanha & Recursos Iniciais ([`server/internal/api/campaign_handlers.go`](../server/internal/api/campaign_handlers.go) e [`character_handlers.go`](../server/internal/api/character_handlers.go)):**
   Aceite `"<system-id>"` na criação de campanhas e inicialize as barras de recursos padrão para personagens criados via API.
4. **Backend Go — Compêndio via API *(opcional)* ([`data/embed.go`](../data/embed.go) e [`server/internal/api/content_handlers.go`](../server/internal/api/content_handlers.go)):**
   Adicione `//go:embed <system-id>/*.json` em `data/embed.go` e registre o `compendiumSpec` em `resolveCompendiumSpec()` para servir `/api/v1/compendium/<system-id>` e `/api/v1/compendium/<system-id>/{category}` (com suporte a sobrescrita via `DATA_DIR` em disco e fallback no binário embutido).
5. **Backend Go — Avaliação Autoritativa de Dados / Dano *(opcional)* ([`server/internal/dice/`](../server/internal/dice/) e [`server/internal/hub/room.go`](../server/internal/hub/room.go)):**
   Caso o sistema possua mecânicas autoritativas próprias no servidor (como a Tabela de Resolução `1d20` e o fluxo `EH → Absorção → EF` de Tagmar em `server/internal/dice/tagmar.go`), conecte-as no avaliador de dados e no `handleChatAction`.
6. **Frontend — Lobby, Ficha, Barra de Dados & Compêndio:**
   - [`client/src/components/lobby/CreateCampaignModal.tsx`](../client/src/components/lobby/CreateCampaignModal.tsx) e [`CampaignLobby.tsx`](../client/src/components/lobby/CampaignLobby.tsx)
   - [`client/src/components/dice/QuickDiceBar.tsx`](../client/src/components/dice/QuickDiceBar.tsx) e [`client/src/components/chat/RollCard.tsx`](../client/src/components/chat/RollCard.tsx)
   - Componentes dedicados opcionais em `client/src/components/characters/` (ficha & assistente) e `client/src/components/library/` (visualizador do compêndio).
7. **Licenciamento de Conteúdo ([`NOTICE.md`](../NOTICE.md) e `data/<system-id>/LICENSE.md`):**
   Se o conteúdo do compêndio usar uma licença aberta diferente da MIT (ex.: `CC BY-NC-SA`, `CC BY-SA`, `ORC`, `OGL`), documente claramente em `data/<system-id>/LICENSE.md` e em [`NOTICE.md`](../NOTICE.md).

### Passo 6 — Escreva Testes Unitários (`systems/systems.test.ts` + Go tests)

Todo sistema novo deve incluir cobertura em [`systems/systems.test.ts`](../systems/systems.test.ts) validando:

- Cálculo de estatísticas derivadas e recursos máximos (incluindo impacto de condições, armaduras e **zero-drift** em criaturas invocadas do bestiário)
- `planAttributeCheck`, `planAttack`, `planSpell` e `planInitiative`
- `resolveRollOutcome` para críticos, falhas críticas, sucessos e botões de ação gerados
- Mutadores de dano, cura, gasto de recurso, evolução e descansos
- Interpolação de fórmulas e macros no sandbox

Execute com:

```bash
bun test systems/systems.test.ts
go test -race -count=1 ./...
```

---

## 🛡️ 3. Estudo de Caso Real em Produção: `systems/tagmar/` (`tagmar-3`)

O sistema **Tagmar 3.0 + Expansões** é a melhor referência viva de como integrar um RPG completo com regras ricas, tabelas próprias e compêndio extenso no Mesa VTT. Explore os arquivos reais em produção:

| Camada | Arquivos de Referência | O que observar |
|---|---|---|
| **Compêndio & Licença** | [`data/tagmar/`](../data/tagmar/) (`LICENSE.md` + 8 JSONs) | Estrutura padronizada com 15 raças, 42 profissões/especializações, 24 condições automatizadas, 66 habilidades + 37 técnicas, 187 magias, 148 equipamentos e 48 criaturas; separação clara da licença `CC BY-NC-SA 3.0 BR`. |
| **Tabelas Puras (TS)** | [`systems/tagmar/resolutionTable.ts`](../systems/tagmar/resolutionTable.ts) | Lookup exato das 28 colunas (`-7` a `20`), regra de *overflow* `>20` (`-20` + `+2` faixas mantendo Erro Crítico no `1`) e matriz `RF/RM` de `460` células. |
| **Engine & Bestiário (TS)** | [`systems/tagmar/engine.ts`](../systems/tagmar/engine.ts) & [`compendium.ts`](../systems/tagmar/compendium.ts) | Compra progressiva de atributos, dano `EH → Absorção → EF`, bypass de Crítico Azul direto na `EF`, evolução de Estágio `1–20` com Especialização no Estágio 5, aliases de condições e `spawnBestiaryMonster()` com invariante de **zero-drift** nas 48 criaturas. |
| **Servidor Autoritativo (Go)** | [`server/internal/dice/tagmar.go`](../server/internal/dice/tagmar.go), [`server/internal/hub/room.go`](../server/internal/hub/room.go), [`server/internal/seed/seed_tagmar.go`](../server/internal/seed/seed_tagmar.go) | Avaliação server-side autoritativa (`crypto/rand`) lendo o mesmo `data/tagmar/rules.json` embutido, sincronização de tokens (`HP=EH`, `MP=EF`), campanha demo `TAGMAR` e suíte de testes E2E em [`server/internal/api/tagmar_test.go`](../server/internal/api/tagmar_test.go). |
| **Interface Dedicada (React)** | [`TagmarWizard.tsx`](../client/src/components/characters/TagmarWizard.tsx), [`TagmarSheetContent.tsx`](../client/src/components/characters/TagmarSheetContent.tsx), [`TagmarCompendiumView.tsx`](../client/src/components/library/TagmarCompendiumView.tsx), [`RollCard.tsx`](../client/src/components/chat/RollCard.tsx) | Assistente de criação em 5 passos, ficha mobile-first com 1 toque para atributos/armas/magias/RF/RM, consulta interativa da Tabela de Resolução e banners coloridos no chat. |

### Exemplo real de Macro Tagmar no Sandbox Zero-`eval`

```js
// Teste na Tabela de Resolução Tagmar 3.0 usando Agilidade + 2
roll("1d20", "Teste na Tabela de Resolução", { tagmarColumn: @agilidade + 2 });

// Teste de Resistência à Magia (RM) contra Força de Ataque 6
roll("1d20", "Resistência à Magia (RM vs FA 6)", {
  tagmarResistance: { kind: "rm", fa: 6, fd: @rm }
});
```

---

## 🚀 4. Próximos Sistemas para a Comunidade Construir

Seguindo exatamente o mesmo padrão de `systems/mighty-blade-3e/` e `systems/tagmar/`, contribuições são super bem-vindas para:

- **Old Dragon 2e** (`systems/old-dragon-2e/`)
- **3D&T** (`systems/3det/`)
- **D&D 5e SRD / Pathfinder 2e (ORC)** (`systems/srd-5e/`, `systems/pf2e/`)
- **Sistemas `d100` investigativos & RPGs narrativos (PbtA / FitD)**

Abra uma issue ou PR com a tag **`system/<seu-sistema>`** — vamos adorar revisar e construir juntos! 🎲🇧🇷
