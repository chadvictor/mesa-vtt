# Licença e Créditos — Tagmar 3.0 RPG (`data/tagmar/`)

## 1. Licença Oficial do Projeto Tagmar

Todo o conteúdo de regras, tabelas de resolução e resistência, raças, profissões, especializações, condições, habilidades, técnicas de combate, magias, equipamentos, itens mágicos e bestiário contido neste diretório (`data/tagmar/`) é derivado do sistema de RPG brasileiro **Tagmar (Tagmar 3.0 e expansões oficiais)**, mantido pelo **Projeto Tagmar** e disponibilizado gratuitamente em:

- **Portal Oficial:** <https://www.tagmar.com.br>
- **Licença Oficial Aplicada:** **Creative Commons Atribuição-NãoComercial-CompartilhaIgual 3.0 Brasil (`CC BY-NC-SA 3.0 BR`)**
- **Texto Legal / Resumo da Licença:** <https://creativecommons.org/licenses/by-nc-sa/3.0/br/>

### Condições Obrigatórias da Licença (`CC BY-NC-SA 3.0 BR`)

Ao utilizar, redistribuir ou adaptar os arquivos presentes em `data/tagmar/`, você deve respeitar integralmente os três pilares da licença adotada pelo Projeto Tagmar:

1. **Atribuição (`BY`):** É obrigatório atribuir o devido crédito aos autores originais de Tagmar e ao Projeto Tagmar, indicando a licença e se alterações foram feitas.
2. **Uso Não-Comercial (`NC`):** Este conteúdo **não pode ser utilizado para fins comerciais** nem vendido em formato digital sob nenhuma hipótese. Todo material digital baseado em Tagmar deve permanecer 100% gratuito.
   - *Exceção de Impressão sob Demanda do Projeto Tagmar:* Conforme política publicada em `tagmar.com.br`, é permitida a cobrança exclusiva pelos custos diretos de impressão, encadernamento e envio de exemplares físicos solicitados por pessoa física para uso próprio, permanecendo estritamente vedada a impressão para revenda comercial em massa ou qualquer cobrança por arquivos digitais.
3. **CompartilhaIgual (`SA`):** Qualquer obra derivada, suplemento, adaptação ou compêndio criado a partir dos arquivos em `data/tagmar/` deve ser distribuído sob a **mesma licença (`CC BY-NC-SA 3.0 BR`)**.

---

## 2. Créditos Oficiais

### Autores Originais (*Tagmar – RPG de Aventura Medieval*, 1991)
- **Marcelo Rodrigues**
- **Ygor Moraes Esteves da Silva**
- **Julio Augusto Cezar Junior**
- **Leonardo Nahoum Pache de Faria**

### Projeto Tagmar (Tagmar 2.0, Tagmar 3.0, Edição Revisada e Expansões)
- **Equipe e Comunidade do Projeto Tagmar** — <https://www.tagmar.com.br>
- Obras oficiais de referência utilizadas na estruturação deste compêndio digital:
  - *Livro de Regras — Tagmar 3.0* (e *Tagmar 3 Edição Revisada*)
  - *Livro de Magias — Tagmar 3.0*
  - *Livro das Ordens Sacerdotais*
  - *Livro das Criaturas*
  - *Livro de Equipamentos* e *Livro de Objetos Mágicos / Alquimia*
  - *Aventuras nas Terras Selvagens* (expansão oficial de ambientação e raças)
  - *Guia de Especializações / Guia de Criação*

---

## 3. Separação de Licenças no Mesa VTT

O projeto **Mesa VTT** adota separação estrita entre o código-fonte do software e os dados de sistemas de RPG de terceiros:

| Escopo | Caminho no Repositório | Licença | Uso Comercial |
| :--- | :--- | :--- | :--- |
| **Engine, Servidor Go, Cliente Web/Mobile e Infraestrutura do Mesa VTT** | `server/`, `client/`, `systems/` (código-fonte) | **MIT License** | Permitido conforme termos da licença MIT |
| **Compêndio e Dados de Regras do Tagmar 3.0** | `data/tagmar/` (`LICENSE.md`, `rules.json`, `races.json`, `professions.json`, `conditions.json`, `skills.json`, `spells.json`, `equipment.json`, `bestiary.json`) | **CC BY-NC-SA 3.0 BR** | **Não permitido** (cláusula `NC` do Projeto Tagmar) |

> **Aviso para redistribuição comercial do Mesa VTT:** Caso deseje utilizar o código-fonte MIT do Mesa VTT em um produto comercial ou serviço pago, você **deve remover ou substituir integralmente** o diretório `data/tagmar/` (a menos que obtenha autorização expressa dos detentores dos direitos do Projeto Tagmar).

---

## 4. Arquivos Cobertos por Esta Licença (`data/tagmar/`)

- `LICENSE.md` — Este aviso de licença e créditos oficiais.
- `rules.json` — Regras centrais de Tagmar 3.0, atributos, Tabela de Resolução (`-7` a `20`), Tabela de Resistências (`RF`/`RM`), fórmulas derivadas, evolução de estágios (`1` a `20`), cura, descanso e efeitos críticos.
- `races.json` — Raças jogáveis do *Livro de Regras 3.0*, *Aventuras nas Terras Selvagens* e expansões.
- `professions.json` — As 6 profissões básicas e especializações oficiais (Academias, Guildas, Colégios, Trilhas, Confrarias e Ordens Sacerdotais).
- `conditions.json` — Condições de combate, magia, ambiente e ferimentos com modificadores automatizados.
- `skills.json` — Habilidades e Técnicas de Combate.
- `spells.json` — Magias dos Colégios, Ordens Sacerdotais, Trilhas e Confrarias.
- `equipment.json` — Armas (dano por cor 25%/50%/75%/100%), armaduras, escudos, elmos, itens de aventura, alquimia e objetos mágicos.
- `bestiary.json` — Criaturas e adversários do *Livro das Criaturas*.
