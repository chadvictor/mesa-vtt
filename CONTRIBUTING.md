# 🤝 Contribuindo com o Mesa VTT

> **🇧🇷 Português (Brasil)** · [🇺🇸 English Contributor Summary](#-english-contributor-summary)

Obrigado pelo interesse em construir o **Mesa VTT**! Este projeto existe para que qualquer grupo possa jogar RPG de mesa online — **no celular ou no computador**, de graça, em código aberto e com respeito especial aos sistemas nacionais e independentes.

Toda contribuição conta: código (Go, TypeScript, React, Three.js, WebRTC), novos sistemas de RPG, mapas táticos em SVG, tokens, traduções, testes e relatos de bugs.

---

## 📋 Índice

1. [Ambiente de Desenvolvimento Local](#-1-ambiente-de-desenvolvimento-local)
2. [Testes e Verificações Obrigatórias](#-2-testes-e-verificações-obrigatórias)
3. [Invariantes de Segurança e Arquitetura (Invioláveis)](#-3-invariantes-de-segurança-e-arquitetura-invioláveis)
4. [Padrões de Pull Request e Código](#-4-padrões-de-pull-request-e-código)
5. [Como Contribuir por Área (Sistemas, Mapas, Traduções)](#-5-como-contribuir-por-área)
6. [English Contributor Summary](#-english-contributor-summary)

---

## 💻 1. Ambiente de Desenvolvimento Local

### Pré-requisitos

- **Go `1.26+`** (backend autoritativo HTTP/WebSocket + engine de dados `crypto/rand`)
- **Node.js `22+`** e `npm` (cliente React 19 + TypeScript + Vite + Three.js)
- **Bun** *(opcional, recomendado para rodar `systems/systems.test.ts` instantaneamente; também é possível usar Node 22 com `--experimental-strip-types`)*
- **Docker** *(opcional, para testar o build multi-stage ou PostgreSQL via `compose.yaml`)*

### Subindo o projeto em 2 terminais

```bash
git clone https://github.com/chadvictor/mesa-vtt.git
cd mesa-vtt
```

**Terminal 1 — Servidor Go (`:8094`, zero-config com JSON FileStore + campanha demo `DRAKON`):**

```bash
LISTEN_ADDRESS=:8094 go run ./server/cmd/server
```

**Terminal 2 — Cliente React + Vite (`:3104`, com proxy `/api` e `/ws` → `:8094`):**

```bash
cd client
npm install
npm run dev
```

Abra `http://localhost:3104` no navegador. Para testar no celular na mesma rede Wi-Fi, rode `npm run dev -- --host` (lembre-se de que o microfone WebRTC em celulares exige HTTPS fora de `localhost`).

---

## ✅ 2. Testes e Verificações Obrigatórias

Antes de abrir um Pull Request, garanta que toda a suíte de CI passa localmente sem erros nem warnings:

```bash
# 1. Testes Go com detector de race conditions + análise estática
go test -race -count=1 ./...
go vet ./...

# 2. Testes da engine multisistema e do sandbox AST zero-eval
bun test systems/systems.test.ts
# (Alternativa sem Bun, usando Node 22+:)
# node --experimental-strip-types --test systems/systems.test.ts

# 3. Typecheck estrito e build de produção do frontend
cd client && npm run build
```

Se você alterou o `Dockerfile` ou o `compose.yaml`, valide também:

```bash
docker build -t mesa-vtt:dev .
```

---

## 🔒 3. Invariantes de Segurança e Arquitetura (Invioláveis)

O Mesa VTT mantém **5 invariantes não negociáveis**. Pull Requests que violem qualquer uma delas não serão aceitos até serem corrigidos:

1. **Segurança de Visibilidade no Nível de Rede (*Wire-Level Visibility*):**
   - Pastas, documentos e cenas `gm_only`, tokens na camada `layer: "gm"`, combatentes ocultos (`hidden: true`), rolagens secretas e sussurros **DEVEM ser filtrados no servidor Go** (`model.CanView`) antes da serialização JSON/WebSocket.
   - **Nunca** implemente segredos apenas escondendo elementos com CSS ou `if (role === 'gm')` no frontend. Um jogador inspecionando a aba *Network* do navegador jamais pode receber dados secretos do Mestre.
2. **Dados Autoritativos no Servidor (`crypto/rand`):**
   - Toda rolagem oficial passa pelo backend Go (`server/internal/dice/`). O cliente envia apenas o plano de rolagem (`RollPlan`) e reproduz a física 3D do Three.js de forma determinística até as faces exatas devolvidas pelo servidor.
3. **Zero-`eval` e Compatibilidade com CSP Estrito (`script-src 'self'`):**
   - **É proibido** usar `eval()`, `new Function()`, injeção insegura de HTML em handouts Markdown ou execução arbitrária de JavaScript vindo de campanhas/usuários.
   - Fórmulas e macros de usuários devem **sempre** rodar dentro do interpretador AST seguro em [`systems/sandbox.ts`](systems/sandbox.ts), respeitando os limites de tamanho, nós AST, profundidade, passos e bloqueio de *prototype pollution* (`__proto__`, `constructor`, `prototype`).
4. **Voz WebRTC Persistente Mobile-First:**
   - Conexões `RTCPeerConnection` e elementos `<audio>` vivem na raiz de `TableShell` — nunca dentro de abas que desmontam quando o usuário troca entre Chat, Mapa, Fichas e Biblioteca no celular.
5. **Ergonomia Mobile & Acessibilidade:**
   - Alvos de toque com no mínimo `44×44px` em telas pequenas, gestos de *pinch-to-zoom* preservados no mapa tático e respeito automático a `prefers-reduced-motion` nas animações 3D.

---

## 📬 4. Padrões de Pull Request e Código

- **Branches:** crie branches descritivas a partir de `main`:
  - `feat/<nome>` — nova funcionalidade
  - `fix/<nome>` — correção de bug
  - `system/<system-id>` — novo sistema de RPG (ex.: `system/tagmar`)
  - `docs/<tema>` — documentação e traduções
  - `art/<nome>` — novos mapas SVG, retratos ou tokens
- **Commits:** prefira [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- **Qualidade de código:**
  - **Go:** formate com `gofmt`, mantenha handlers limpos, valide permissões de membro/Mestre no servidor e escreva testes em `*_test.go`.
  - **TypeScript / React:** mantenha tipagem estrita (evite `any`), siga os contratos compartilhados em [`systems/types.ts`](systems/types.ts) e mantenha funções de engine puras e determinísticas.
- **Descrição do PR:** explique o *porquê* da mudança, como testar e inclua **prints ou vídeos curtos (Desktop + Mobile)** sempre que houver alteração visual.

---

## 🌟 5. Como Contribuir por Área

### 🎲 Submetendo um Novo Sistema de RPG

O Mesa VTT foi projetado desde o início para ser multisistema — e nosso próximo grande marco oficial é **Tagmar**!

1. Leia o guia completo em **[`docs/CREATING_SYSTEMS.md`](docs/CREATING_SYSTEMS.md)** (que já inclui um blueprint prático de **Tagmar**).
2. Crie o módulo em `systems/<system-id>/` (`manifest.json`, `schema.json`, `engine.ts`) e, se aplicável, o compêndio estruturado em `data/<system-id>/*.json`.
3. **Respeito a Direitos Autorais (Obrigatório):** só aceitamos compêndios baseados em **SRDs oficiais**, licenças abertas (**Creative Commons**, **ORC**, **MIT**), sistemas de **distribuição gratuita oficial** (como Mighty Blade e Tagmar) ou material autoral com permissão explícita. Nunca submeta textos copiados de livros pagos/proprietários sem licença; para sistemas fechados, implemente apenas as **mecânicas e a estrutura da ficha** (sem o texto protegido do livro).
4. Inclua testes unitários completos em `systems/systems.test.ts` (atributos derivados, cálculo de defesa/recursos, avaliação de rolagens e mutadores de dano/cura/descanso).

### 🗺️ Submetendo Mapas Táticos, Retratos e Tokens

Adoramos expandir a biblioteca gratuita embutida em `client/public/assets/`!

- **Formato preferido:** **SVG vetorial otimizado** (leve, carrega instantaneamente em 4G e mantém nitidez perfeita no *pinch-to-zoom*).
- **Dimensões padrão para mapas:** `1920×1440` alinhado a uma grade `24×18` (`80px` por quadrado), salvo em `client/public/assets/maps/<id>.svg`.
- **Retratos e monstros:** proporção quadrada (`1:1`), salvos em `client/public/assets/portraits/` ou `client/public/assets/monsters/`.
- **Registro:** adicione a entrada correspondente em [`client/public/assets/manifest.json`](client/public/assets/manifest.json).
- **Licença da arte:** toda arte submetida deve ser **autoral** (licenciada sob MIT/CC0/CC-BY junto ao projeto) ou de domínio público / CC0 comprovado. Informe a autoria no PR.

### 🌍 Submetendo Traduções e Documentação

- Documentação em novos idiomas: crie `README.<codigo>.md` (ex.: `README.es.md`) e adicione o link no seletor de idiomas no topo dos READMEs.
- Tradução de interface e compêndios: abra uma issue ou PR propondo strings localizadas mantendo PT-BR e EN como idiomas de referência.
- Melhorias em guias (`docs/ARCHITECTURE.md`, `docs/CREATING_SYSTEMS.md`, exemplos de macros) são sempre bem-vindas.

### 🐛 Reportando Bugs

Ao abrir uma Issue, inclua:
- Ambiente (Desktop ou Celular, SO e navegador — ex.: iOS Safari 18, Android Chrome, macOS Firefox)
- Como reproduzir passo a passo (informe se ocorreu na campanha `DRAKON` ou em campanha própria)
- Logs relevantes do console do navegador ou do servidor Go (sem incluir senhas ou segredos!)

---

## 🇺🇸 English Contributor Summary

Welcome to **Mesa VTT**! We welcome pull requests for Go backend features, React 19 / Three.js / WebRTC frontend work, new RPG system modules, original SVG battlemaps/tokens, translations, and bug fixes.

### Quick Local Dev Setup

```bash
git clone https://github.com/chadvictor/mesa-vtt.git
cd mesa-vtt

# Terminal 1 — Authoritative Go 1.26 server (:8094, auto-seeds demo campaign DRAKON)
LISTEN_ADDRESS=:8094 go run ./server/cmd/server

# Terminal 2 — React 19 + Vite client (:3104, proxies /api & /ws -> :8094)
cd client && npm install && npm run dev
```

### Required Checks Before Opening a PR

```bash
go test -race -count=1 ./...
go vet ./...
bun test systems/systems.test.ts        # or: node --experimental-strip-types --test systems/systems.test.ts
cd client && npm run build              # runs tsc --noEmit && vite build
```

### Non-Negotiable Security & Architecture Invariants

1. **Wire-Level Visibility:** All `gm_only` folders/documents/scenes, `layer: "gm"` tokens, hidden combatants, secret rolls, and private whispers MUST be filtered on the Go server (`model.CanView`) prior to JSON/WebSocket serialization. Never rely on client-side hiding.
2. **Authoritative Server Dice:** All rolls are generated via `crypto/rand` on the Go server; the client animates 3D Three.js dice deterministically onto those exact server faces.
3. **Strict Zero-`eval` CSP (`script-src 'self'`):** Never add `eval`, `new Function`, or unsanitized HTML rendering. User macros and formulas must execute strictly inside the pure-TypeScript AST sandbox (`systems/sandbox.ts`).
4. **Persistent Mobile-First Voice:** WebRTC audio state and `<audio>` sinks remain mounted at `TableShell` root so tab switching on phones never interrupts voice.
5. **Copyright & Licensing:** Only submit original, SRD, Creative Commons, or officially free-distribution RPG datasets and original/CC0/MIT artwork.

### Key Links

- **Adding a new RPG system (with a full Tagmar starter blueprint):** [`docs/CREATING_SYSTEMS.md`](docs/CREATING_SYSTEMS.md)
- **Architecture & Wire Protocol:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **License:** [MIT](LICENSE)
