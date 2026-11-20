# NOTICE — Licensing, Attribution & Third-Party RPG Content

**Mesa VTT** separates its open-source Virtual Tabletop software from third-party tabletop RPG rulebooks and compendium datasets bundled in `data/`.

---

## 1. Mesa VTT Software, Engine, UI, Server & Original SVG Art

- **Paths:** `server/`, `client/`, `systems/`, `docs/`, `Dockerfile`, `compose.yaml`, `client/public/assets/**/*.svg`
- **License:** **MIT License** (see [`LICENSE`](LICENSE))
- **Commercial use:** Permitted under the MIT License for the Mesa VTT software itself.

---

## 2. Tagmar 3.0 RPG Compendium & Rules Data (`data/tagmar/`)

- **Paths:** `data/tagmar/**` (`LICENSE.md`, `rules.json`, `races.json`, `professions.json`, `conditions.json`, `skills.json`, `spells.json`, `equipment.json`, `bestiary.json`)
- **Official Source:** **Projeto Tagmar** — <https://www.tagmar.com.br>
- **License:** **Creative Commons Atribuição-NãoComercial-CompartilhaIgual 3.0 Brasil (`CC BY-NC-SA 3.0 BR`)**
  - Legal deed: <https://creativecommons.org/licenses/by-nc-sa/3.0/br/>
  - Full directory notice: [`data/tagmar/LICENSE.md`](data/tagmar/LICENSE.md)
- **Attribution:**
  - Original creators of *Tagmar – RPG de Aventura Medieval* (1991): **Marcelo Rodrigues**, **Ygor Moraes Esteves da Silva**, **Julio Augusto Cezar Junior**, and **Leonardo Nahoum Pache de Faria**.
  - **Projeto Tagmar** team and community (<https://www.tagmar.com.br>) for *Tagmar 3.0*, *Tagmar 3 Edição Revisada*, *Livro de Magias*, *Livro das Ordens Sacerdotais*, *Livro das Criaturas*, *Livro de Equipamentos*, *Livro de Objetos Mágicos / Alquimia*, *Aventuras nas Terras Selvagens*, and official specializations.
- **Commercial Redistribution Notice:** Because `data/tagmar/` is governed by the NonCommercial (`NC`) and ShareAlike (`SA`) clauses of **CC BY-NC-SA 3.0 BR**, any commercial derivative or paid distribution of Mesa VTT **must remove or replace `data/tagmar/`** unless explicit written permission is obtained from the rights holders of Projeto Tagmar. Any non-commercial derivative of `data/tagmar/` must retain attribution and be shared under `CC BY-NC-SA 3.0 BR`.

---

## 3. Mighty Blade 3ª Edição RPG Compendium Data (`data/mighty-blade/`)

- **Paths:** `data/mighty-blade/**` (`rules.json`, `races.json`, `classes.json`, `conditions.json`, `abilities.json`, `spells.json`, `equipment.json`, `bestiary.json`)
- **Attribution:** **Mighty Blade 3ª Edição (3.5)** was created by **Tiago Junges** (with co-authors Domênico Gay and Luciano Abel) and published by **Coisinha Verde** as a free open-distribution Brazilian tabletop RPG.
- Mesa VTT is an independent community open-source project providing structured digital reference data and VTT automation in tribute to Mighty Blade 3ª Edição. All original Mighty Blade game text, trademarks, and copyrights remain the property of their respective creators.

---

## Summary Table

| Component | Path | License / Terms | Commercial Use |
| :--- | :--- | :--- | :--- |
| **Mesa VTT Software & Original SVG Art** | `server/`, `client/`, `systems/`, `client/public/assets/` | **MIT License** (`LICENSE`) | Permitted (MIT) |
| **Tagmar 3.0 + Expansions Data** | `data/tagmar/**` | **CC BY-NC-SA 3.0 BR** (`data/tagmar/LICENSE.md`) | **Not permitted** — remove/replace `data/tagmar/` in commercial builds |
| **Mighty Blade 3e Reference Data** | `data/mighty-blade/**` | Community tribute to free-distribution Brazilian RPG (Tiago Junges / Coisinha Verde) | Respect original creators' rights |
