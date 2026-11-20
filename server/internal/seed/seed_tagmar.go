package seed

import (
	"context"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

const (
	TagmarCampaignID    = "camp_tagmar_01"
	TagmarInviteCode    = "TAGMAR"
	TagmarGMUserID      = "seed_gm_tagmar"
	TagmarVoiceMainID   = "vc_tagmar_main"
	TagmarVoicePrivID   = "vc_tagmar_whisper"
	TagmarSceneFortress = "scene_tagmar_verrogar"
	TagmarSceneForest   = "scene_tagmar_forest"
)

func seedTagmarCampaign(ctx context.Context, st store.Store) error {
	now := time.Now().UTC()

	campaign := model.Campaign{
		ID:            TagmarCampaignID,
		Name:          "Crônicas de Tagmar — Fronteira de Verrogar",
		Description:   "Aventura introdutória oficial de Tagmar 3.0 + Expansões no Mundo Conhecido: saqueadores orcs e lobos das neves ameaçam a Fronteira de Verrogar enquanto a guarnição convoca heróis ao pátio da fortaleza.",
		SystemID:      "tagmar-3",
		CoverURL:      "./assets/maps/castle-courtyard.svg",
		InviteCode:    TagmarInviteCode,
		Privacy:       "public",
		OwnerUserID:   TagmarGMUserID,
		ActiveSceneID: strPtr(TagmarSceneFortress),
		Combat: model.CombatState{
			Active:     false,
			Round:      1,
			TurnIndex:  0,
			Combatants: []model.Combatant{},
		},
		Settings: model.CampaignSettings{
			AllowPlayerDice3D:     true,
			DefaultVoiceChannelID: TagmarVoiceMainID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := st.CreateCampaign(ctx, campaign); err != nil {
		return err
	}

	// Seed GM member
	if err := st.UpsertMember(ctx, model.CampaignMember{
		CampaignID:  TagmarCampaignID,
		UserID:      TagmarGMUserID,
		DisplayName: "Mestre de Tagmar",
		AvatarURL:   "./assets/portraits/gm-avatar.svg",
		Role:        model.RoleGM,
		JoinedAt:    now,
	}); err != nil {
		return err
	}

	// Voice channels
	voiceChannels := []model.VoiceChannel{
		{
			ID:               TagmarVoiceMainID,
			CampaignID:       TagmarCampaignID,
			Name:             "Mesa Principal",
			IsDefault:        true,
			LockedForPlayers: false,
		},
		{
			ID:               TagmarVoicePrivID,
			CampaignID:       TagmarCampaignID,
			Name:             "Sussurro do Mestre",
			IsDefault:        false,
			LockedForPlayers: false,
		},
	}
	for _, vc := range voiceChannels {
		if err := st.UpsertVoiceChannel(ctx, vc); err != nil {
			return err
		}
	}

	// Tagmar 3.0 Stage 1 Heroes & NPCs/Monsters (exact TagmarSystemData contract)
	characters := []model.Character{
		{
			ID:                  "char_kael",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindPC,
			Name:                "Kael de Verrogar",
			Subtitle:            "Guerreiro Humano · Estágio 1",
			PortraitURL:         "./assets/portraits/human-warrior.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 20, Max: 20},
				"ef":    {Current: 20, Max: 20, Temp: 18},
				"karma": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":             "humano",
				"raceName":           "Humano",
				"professionId":       "guerreiro",
				"professionName":     "Guerreiro",
				"specializationId":   nil,
				"specializationName": nil,
				"stage":              1,
				"xp":                 0,
				"attributes": map[string]any{
					"intelecto": 1,
					"aura":      0,
					"carisma":   0,
					"forca":     3,
					"fisico":    2,
					"agilidade": 3,
				},
				"skills": []map[string]any{
					{"id": "sk_kael_1", "skillId": "aplicar-esforco", "name": "Aplicar Esforço", "group": "Manobra", "attribute": "forca", "level": 3, "specialized": true},
					{"id": "sk_kael_2", "skillId": "corrida", "name": "Corrida", "group": "Manobra", "attribute": "fisico", "level": 2},
					{"id": "sk_kael_3", "skillId": "montar-animais", "name": "Montar Animais", "group": "Manobra", "attribute": "agilidade", "level": 2},
					{"id": "sk_kael_4", "skillId": "primeiros-socorros", "name": "Primeiros Socorros", "group": "Geral", "attribute": "intelecto", "level": 2},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_kael_1", "techniqueId": "corte-medio-espadas", "name": "Armas de Corte Médio — Espadas (CmE)", "category": "melee", "attribute": "agilidade", "level": 4},
					{"id": "ct_kael_2", "techniqueId": "uso-de-escudo", "name": "Uso de Escudo", "category": "defense", "attribute": "forca", "level": 3},
					{"id": "ct_kael_3", "techniqueId": "aparar", "name": "Aparar", "category": "defense", "attribute": "agilidade", "level": 2},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_kael_sword", "itemId": "espada-longa", "name": "Espada Longa", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Corte Médio — Espadas",
						"damage":      map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
						"damageType":  "Corte", "hands": 1, "minFor": 0, "columnBonus": 1, "range": "Corpo a Corpo", "weight": 1.8,
						"description": "Espada forjada nas oficinas militares de Verrogar.",
					},
					{
						"id": "inv_kael_armor", "itemId": "couro-rigido", "name": "Armadura de Couro Rígido", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "L", "absorcao": 12, "defActiveBonus": 2, "defPassiveBonus": 2, "agilityPenalty": -1, "weight": 6.0,
					},
					{
						"id": "inv_kael_shield", "itemId": "paves-pequeno", "name": "Pavês Pequeno (Escudo Médio)", "category": "shield", "slot": "shield",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 4, "defActiveBonus": 2, "defPassiveBonus": 0, "agilityPenalty": 0, "weight": 3.5,
					},
					{
						"id": "inv_kael_helm", "itemId": "elmo-aberto", "name": "Elmo Aberto de Metal", "category": "helmet", "slot": "helmet",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 2, "defActiveBonus": 2, "defPassiveBonus": 1, "agilityPenalty": 0, "weight": 1.5,
					},
					{
						"id": "inv_kael_potion", "itemId": "pocao-cura-fisica-menor", "name": "Poção de Cura Física Menor", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.3,
						"effect":      map[string]any{"healEf": 6},
						"description": "Restaura 6 pontos de Energia Física (EF).",
					},
					{
						"id": "inv_kael_herb", "itemId": "raiz-de-lena", "name": "Raiz de Lena (Restauradora)", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.1,
						"effect":      map[string]any{"healEh": 10},
						"description": "Erva aromática de Tagmar que restaura 10 pontos de EH.",
					},
				},
				"money":         map[string]any{"mo": 0, "mp": 1, "mc": 5},
				"languages":     []string{"Malês"},
				"notes":         "Jovem soldado da guarnição fronteiriça de Verrogar determinado a proteger as caravanas do norte.",
				"biography":     "Criado sob as muralhas de pedra de Verrogar, Kael jurou manter a estrada segura contra os clãs orcs das montanhas.",
				"efMax":         20,
				"ehMax":         20,
				"karmaMax":      0,
				"defesaAtiva":   8,
				"defesaPassiva": 3,
				"absorcao":      18,
				"rf":            3,
				"rm":            1,
				"vb":            22,
				"iniciativa":    3,
			},
			Computed: map[string]any{
				"efMax":            20,
				"ehMax":            20,
				"karmaMax":         0,
				"defesaAtiva":      8, // 3 AGI - 1 pen + 2 armor + 2 shield + 2 helm
				"defesaPassiva":    3, // 2 armor + 1 helm
				"effectiveDefense": 8,
				"absorcao":         18, // 12 + 4 + 2
				"armorClass":       "L",
				"rf":               3, // 1 stage + 2 FIS
				"rm":               1, // 1 stage + 0 AUR
				"vb":               22,
				"vbQuadrados":      14,
				"iniciativa":       3,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_aelindra",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindPC,
			Name:                "Aelindra",
			Subtitle:            "Elfa Dourada · Maga Elemental · Estágio 1",
			PortraitURL:         "./assets/portraits/elf-mage.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 6, Max: 6},
				"ef":    {Current: 12, Max: 12, Temp: 5},
				"karma": {Current: 10, Max: 10},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":             "elfo-dourado",
				"raceName":           "Elfo Dourado",
				"professionId":       "mago",
				"professionName":     "Mago",
				"specializationId":   "colegio-elemental",
				"specializationName": "Elementalista (Colégio Elemental)",
				"stage":              1,
				"xp":                 0,
				"attributes": map[string]any{
					"intelecto": 3,
					"aura":      4,
					"carisma":   1,
					"forca":     -1,
					"fisico":    0,
					"agilidade": 2,
				},
				"skills": []map[string]any{
					{"id": "sk_ael_1", "skillId": "misticismo", "name": "Misticismo", "group": "Conhecimento", "attribute": "intelecto", "level": 4, "specialized": true},
					{"id": "sk_ael_2", "skillId": "escrita", "name": "Escrita", "group": "Conhecimento", "attribute": "intelecto", "level": 2},
					{"id": "sk_ael_3", "skillId": "sabedoria", "name": "Sabedoria", "group": "Conhecimento", "attribute": "intelecto", "level": 3},
					{"id": "sk_ael_4", "skillId": "usar-os-sentidos", "name": "Usar os Sentidos", "group": "Geral", "attribute": "intelecto", "level": 2},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_ael_1", "techniqueId": "contusao-leve", "name": "Armas de Contusão Leve (Clavas e Bastões)", "category": "melee", "attribute": "agilidade", "level": 2},
				},
				"spells": []map[string]any{
					{
						"id": "sp_ael_1", "spellId": "lanca-de-fogo", "name": "Lança de Fogo", "group": "Mago — Colégio Elemental (Fogo)",
						"professionIds": []string{"mago"}, "level": 2, "karmaCost": 3, "evocationTime": "1 rodada", "range": "25 metros", "duration": "Instantânea", "resistance": "none",
						"description": "Dispara um dardo flamejante concentrado contra um alvo único.",
						"automation": map[string]any{
							"damageByColor": map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
							"damageType":    "Fogo", "targetType": "single",
						},
					},
					{
						"id": "sp_ael_2", "spellId": "bola-de-fogo", "name": "Bola de Fogo", "group": "Mago — Lista Básica / Colégio Elemental (Fogo)",
						"professionIds": []string{"mago"}, "level": 1, "karmaCost": 4, "evocationTime": "1 rodada", "range": "30 metros", "duration": "Instantânea", "resistance": "rf",
						"description": "Arremessa um orbe incandescente de chamas arcanas que detona em área.",
						"automation": map[string]any{
							"damageByColor":    map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
							"damageType":       "Fogo",
							"appliesCondition": "em-chamas",
							"targetType":       "area",
						},
					},
					{
						"id": "sp_ael_3", "spellId": "dardos-de-gelo", "name": "Dardos de Gelo", "group": "Mago — Colégio Elemental (Água)",
						"professionIds": []string{"mago"}, "level": 2, "karmaCost": 3, "evocationTime": "1 rodada", "range": "25 metros", "duration": "Instantânea", "resistance": "none",
						"description": "Conjura estilhaços cristalinos de gelo que atravessam o ar em alta velocidade.",
						"automation": map[string]any{
							"damageByColor": map[string]any{"verde": 3, "amarelo": 6, "laranja": 9, "vermelho": 12, "azul": 15},
							"damageType":    "Frio", "targetType": "single",
						},
					},
					{
						"id": "sp_ael_4", "spellId": "escudo-de-agua", "name": "Escudo de Água", "group": "Mago — Colégio Elemental (Água)",
						"professionIds": []string{"mago"}, "level": 1, "karmaCost": 2, "evocationTime": "1 rodada", "range": "Pessoal", "duration": "10 rodadas", "resistance": "none",
						"description": "Barreira líquida rodopiante que confere +2 em Defesa Ativa.",
						"automation": map[string]any{
							"defenseBonus": 2, "appliesCondition": "protegido", "targetType": "self",
						},
					},
					{
						"id": "sp_ael_5", "spellId": "manipulacao-de-luz", "name": "Manipulação de Luz", "group": "Mago — Lista Básica",
						"professionIds": []string{"mago"}, "level": 1, "karmaCost": 1, "evocationTime": "1 rodada", "range": "20 metros", "duration": "10 minutos", "resistance": "rf",
						"description": "Ilumina escuridão ou dispara clarão cegante contra inimigos.",
						"automation": map[string]any{
							"appliesCondition": "cego", "targetType": "area",
						},
					},
				},
				"inventory": []map[string]any{
					{
						"id": "inv_ael_staff", "itemId": "bordao", "name": "Bordão (Cajado de Combate)", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Contusão Leve",
						"damage":      map[string]any{"verde": 3, "amarelo": 6, "laranja": 9, "vermelho": 12, "azul": 15},
						"damageType":  "Contusão", "hands": 2, "minFor": -1, "columnBonus": 1, "range": "Corpo a Corpo", "weight": 1.5,
						"description": "Cajado élfico gravado com runas elementais de Palier.",
					},
					{
						"id": "inv_ael_robes", "itemId": "vestes-acolchoadas", "name": "Vestes Acolchoadas (Gambeson)", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "L", "absorcao": 5, "defActiveBonus": 0, "defPassiveBonus": 0, "agilityPenalty": 0, "weight": 3.0,
					},
					{
						"id": "inv_ael_focus", "itemId": "grimorio-em-branco", "name": "Grimório Encadernado (Focus)", "category": "gear",
						"equipped": true, "quantity": 1, "weight": 1.2,
						"description": "Focus místico indispensável para canalizar e recuperar Karma.",
					},
					{
						"id": "inv_ael_elixir", "itemId": "elixir-karma-menor", "name": "Elixir de Karma Menor", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.2,
						"effect":      map[string]any{"restoreKarma": 6},
						"description": "Restaura 6 pontos de Karma instantaneamente.",
					},
				},
				"money":         map[string]any{"mo": 1, "mp": 5, "mc": 0},
				"languages":     []string{"Malês", "Élfico"},
				"notes":         "Aprendiz do Colégio Elemental enviada a Verrogar para investigar anomalias no fluxo de mana da fronteira.",
				"biography":     "Erudita de linhagem dourada devota do estudo das chamas e do gelo, equilibra precisão arcana com disciplina élfica.",
				"efMax":         12,
				"ehMax":         6,
				"karmaMax":      10,
				"defesaAtiva":   2,
				"defesaPassiva": 0,
				"absorcao":      5,
				"rf":            1,
				"rm":            6,
				"vb":            18,
				"iniciativa":    2,
			},
			Computed: map[string]any{
				"efMax":            12, // 13 - 1 FOR + 0 FIS
				"ehMax":            6,  // 6 + 0 FIS
				"karmaMax":         10, // (4 AUR + 1) * (1 + 1)
				"defesaAtiva":      2,  // 2 AGI
				"defesaPassiva":    0,
				"effectiveDefense": 2,
				"absorcao":         5,
				"armorClass":       "L",
				"rf":               1, // 1 stage + 0 FIS
				"rm":               6, // 1 stage + 4 AUR + 1 Elfo Dourado
				"vb":               18,
				"vbQuadrados":      12,
				"iniciativa":       2,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_thorgar",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindPC,
			Name:                "Thorgar",
			Subtitle:            "Anão · Sacerdote de Parom · Estágio 1",
			PortraitURL:         "./assets/portraits/dwarf-paladin.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 15, Max: 15},
				"ef":    {Current: 20, Max: 20, Temp: 22},
				"karma": {Current: 8, Max: 8},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":             "anao",
				"raceName":           "Anão",
				"professionId":       "sacerdote",
				"professionName":     "Sacerdote",
				"specializationId":   "ordem-parom",
				"specializationName": "Ordem de Parom",
				"stage":              1,
				"xp":                 0,
				"attributes": map[string]any{
					"intelecto": 1,
					"aura":      3,
					"carisma":   2,
					"forca":     2,
					"fisico":    3,
					"agilidade": 0,
				},
				"skills": []map[string]any{
					{"id": "sk_tho_1", "skillId": "religiao", "name": "Religião", "group": "Conhecimento", "attribute": "intelecto", "level": 3, "specialized": true},
					{"id": "sk_tho_2", "skillId": "medicina", "name": "Medicina", "group": "Conhecimento", "attribute": "intelecto", "level": 3},
					{"id": "sk_tho_3", "skillId": "trabalho-em-metal", "name": "Trabalho em Metal", "group": "Profissional", "attribute": "forca", "level": 3},
					{"id": "sk_tho_4", "skillId": "oratoria", "name": "Oratória", "group": "Influência", "attribute": "carisma", "level": 2},
					{"id": "sk_tho_5", "skillId": "escrita", "name": "Escrita", "group": "Conhecimento", "attribute": "intelecto", "level": 1},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_tho_1", "techniqueId": "contusao-media", "name": "Armas de Contusão Média (Maças e Martelos)", "category": "melee", "attribute": "forca", "level": 3},
					{"id": "ct_tho_2", "techniqueId": "uso-de-escudo", "name": "Uso de Escudo", "category": "defense", "attribute": "forca", "level": 2},
					{"id": "ct_tho_3", "techniqueId": "combate-defensivo", "name": "Combate Defensivo", "category": "defense", "attribute": "agilidade", "level": 2},
				},
				"spells": []map[string]any{
					{
						"id": "sp_tho_1", "spellId": "curas-fisicas", "name": "Curas Físicas", "group": "Sacerdote — Lista Básica",
						"professionIds": []string{"sacerdote"}, "level": 2, "karmaCost": 2, "evocationTime": "1 rodada", "range": "Toque", "duration": "Instantânea", "resistance": "none",
						"description": "Fecha ferimentos reais e restaura Energia Física (EF) do aliado tocado.",
						"automation": map[string]any{
							"healByColor": map[string]any{"verde": 3, "amarelo": 6, "laranja": 9, "vermelho": 12, "azul": 15},
							"targetType":  "single",
						},
					},
					{
						"id": "sp_tho_2", "spellId": "curas-heroicas", "name": "Curas Heróicas", "group": "Sacerdote — Lista Básica",
						"professionIds": []string{"sacerdote"}, "level": 2, "karmaCost": 2, "evocationTime": "1 rodada", "range": "Toque", "duration": "Instantânea", "resistance": "none",
						"description": "Renova o fôlego e o ímpeto de batalha restaurando Energia Heróica (EH).",
						"automation": map[string]any{
							"healByColor": map[string]any{"verde": 5, "amarelo": 10, "laranja": 15, "vermelho": 20, "azul": 25},
							"targetType":  "single",
						},
					},
					{
						"id": "sp_tho_3", "spellId": "bencao", "name": "Bênção", "group": "Sacerdote — Lista Básica",
						"professionIds": []string{"sacerdote"}, "level": 1, "karmaCost": 2, "evocationTime": "1 rodada", "range": "10 metros", "duration": "10 rodadas", "resistance": "none",
						"description": "Abençoa aliados próximos com favor divino (+1 em Defesa e colunas).",
						"automation": map[string]any{
							"defenseBonus": 1, "appliesCondition": "abencoado", "targetType": "area",
						},
					},
					{
						"id": "sp_tho_4", "spellId": "forma-de-pedra", "name": "Forma de Pedra", "group": "Sacerdote — Ordem de Parom",
						"professionIds": []string{"sacerdote"}, "level": 1, "karmaCost": 3, "evocationTime": "1 rodada", "range": "Pessoal", "duration": "10 rodadas", "resistance": "none",
						"description": "Endurece a pele e a armadura com o poder da forja de Parom (+3 Defesa).",
						"automation": map[string]any{
							"defenseBonus": 3, "appliesCondition": "protegido", "targetType": "self",
						},
					},
					{
						"id": "sp_tho_5", "spellId": "onda-destrutiva", "name": "Onda Destrutiva", "group": "Sacerdote — Ordem de Parom",
						"professionIds": []string{"sacerdote"}, "level": 1, "karmaCost": 4, "evocationTime": "1 rodada", "range": "10 metros", "duration": "Instantânea", "resistance": "rf",
						"description": "Impacta o solo liberando onda sísmica que fere e derruba adversários.",
						"automation": map[string]any{
							"damageByColor":    map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
							"damageType":       "Contusão",
							"appliesCondition": "caido",
							"targetType":       "area",
						},
					},
				},
				"inventory": []map[string]any{
					{
						"id": "inv_tho_hammer", "itemId": "martelo-de-guerra", "name": "Martelo de Guerra", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Contusão Média",
						"damage":      map[string]any{"verde": 5, "amarelo": 10, "laranja": 15, "vermelho": 20, "azul": 25},
						"damageType":  "Contusão", "hands": 1, "minFor": 2, "columnBonus": 0, "range": "Corpo a Corpo", "weight": 2.5,
						"description": "Martelo consagrado na bigorna sagrada de Parom.",
					},
					{
						"id": "inv_tho_armor", "itemId": "cota-de-malha-parcial", "name": "Cota de Malha Parcial", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 18, "defActiveBonus": 1, "defPassiveBonus": 1, "agilityPenalty": -1, "weight": 11.0,
					},
					{
						"id": "inv_tho_shield", "itemId": "paves-pequeno", "name": "Pavês Pequeno (Escudo Médio)", "category": "shield", "slot": "shield",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 4, "defActiveBonus": 2, "defPassiveBonus": 0, "agilityPenalty": 0, "weight": 3.5,
					},
					{
						"id": "inv_tho_focus", "itemId": "simbolo-sagrado", "name": "Símbolo Sagrado de Parom (Focus)", "category": "gear",
						"equipped": true, "quantity": 1, "weight": 0.3,
						"description": "Bigorna de prata abençoada utilizada para canalizar milagres.",
					},
					{
						"id": "inv_tho_herb", "itemId": "folha-de-maira", "name": "Folha de Maira (Cicatrizante)", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.1,
						"effect":      map[string]any{"healEf": 4, "cureCondition": "sangrando"},
						"description": "Estanca sangramentos e recupera 4 pontos de EF.",
					},
				},
				"money":         map[string]any{"mo": 0, "mp": 4, "mc": 5},
				"languages":     []string{"Malês", "Voz da Pedra"},
				"notes":         "Clérigo-ferreiro devoto de Parom, senhor das forjas e da criação. Conserta armaduras e ergue aliados caídos.",
				"biography":     "Enviado de seu clã nas montanhas para auxiliar a fortaleza de Verrogar, Thorgar carrega tanto o martelo quanto a bênção da pedra.",
				"efMax":         20,
				"ehMax":         15,
				"karmaMax":      8,
				"defesaAtiva":   2,
				"defesaPassiva": 1,
				"absorcao":      22,
				"rf":            5,
				"rm":            4,
				"vb":            19,
				"iniciativa":    0,
			},
			Computed: map[string]any{
				"efMax":            20, // 15 + 2 FOR + 3 FIS
				"ehMax":            15, // 12 + 3 FIS
				"karmaMax":         8,  // (3 AUR + 1) * (1 + 1)
				"defesaAtiva":      2,  // max(0, 0 AGI - 1 pen + 1 armor + 2 shield)
				"defesaPassiva":    1,  // 1 armor
				"effectiveDefense": 2,
				"absorcao":         22, // 18 + 4
				"armorClass":       "M",
				"rf":               5, // 1 stage + 3 FIS + 1 Anão
				"rm":               4, // 1 stage + 3 AUR
				"vb":               19,
				"vbQuadrados":      12,
				"iniciativa":       0,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_liriel",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindPC,
			Name:                "Liriel",
			Subtitle:            "Pequenina Ladina · Estágio 1",
			PortraitURL:         "./assets/portraits/goblin-rogue.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 14, Max: 14},
				"ef":    {Current: 12, Max: 12, Temp: 9},
				"karma": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":             "pequenino",
				"raceName":           "Pequenino",
				"professionId":       "ladino",
				"professionName":     "Ladino",
				"specializationId":   nil,
				"specializationName": nil,
				"stage":              1,
				"xp":                 0,
				"attributes": map[string]any{
					"intelecto": 2,
					"aura":      0,
					"carisma":   2,
					"forca":     -1,
					"fisico":    2,
					"agilidade": 4,
				},
				"skills": []map[string]any{
					{"id": "sk_lir_1", "skillId": "acoes-furtivas", "name": "Ações Furtivas", "group": "Subterfúgio", "attribute": "agilidade", "level": 4, "specialized": true},
					{"id": "sk_lir_2", "skillId": "destravar-fechaduras", "name": "Destravar Fechaduras", "group": "Subterfúgio", "attribute": "agilidade", "level": 4},
					{"id": "sk_lir_3", "skillId": "manusear-armadilhas", "name": "Manusear Armadilhas", "group": "Subterfúgio", "attribute": "agilidade", "level": 3},
					{"id": "sk_lir_4", "skillId": "escapar", "name": "Escapar", "group": "Subterfúgio", "attribute": "agilidade", "level": 3},
					{"id": "sk_lir_5", "skillId": "usar-os-sentidos", "name": "Usar os Sentidos", "group": "Geral", "attribute": "intelecto", "level": 3},
					{"id": "sk_lir_6", "skillId": "escalar-superficies", "name": "Escalar Superfícies", "group": "Manobra", "attribute": "forca", "level": 2},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_lir_1", "techniqueId": "perfuracao-leve", "name": "Armas de Perfuração Leve (Adagas, Punhais e Floretes)", "category": "melee", "attribute": "agilidade", "level": 4},
					{"id": "ct_lir_2", "techniqueId": "arcos", "name": "Arcos (Simples, Composto e Longo)", "category": "ranged", "attribute": "agilidade", "level": 3},
					{"id": "ct_lir_3", "techniqueId": "esquiva-aprimorada", "name": "Esquiva Aprimorada", "category": "defense", "attribute": "agilidade", "level": 2},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_lir_dagger", "itemId": "punhal", "name": "Punhal", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Perfuração Leve",
						"damage":      map[string]any{"verde": 2, "amarelo": 4, "laranja": 6, "vermelho": 8, "azul": 10},
						"damageType":  "Perfuração", "hands": 1, "minFor": -2, "columnBonus": 0, "range": "Corpo a Corpo", "weight": 0.4,
						"description": "Punhal silencioso e letal em ataques pelas costas.",
					},
					{
						"id": "inv_lir_bow", "itemId": "arco-curto", "name": "Arco Curto (Simples)", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Arcos",
						"damage":      map[string]any{"verde": 3, "amarelo": 6, "laranja": 9, "vermelho": 12, "azul": 15},
						"damageType":  "Perfuração", "hands": 2, "minFor": -1, "columnBonus": 0, "range": "40m", "weight": 1.0,
						"description": "Arco compacto ideal para batedores pequeninos.",
					},
					{
						"id": "inv_lir_armor", "itemId": "couro-leve", "name": "Armadura de Couro Leve", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "L", "absorcao": 8, "defActiveBonus": 1, "defPassiveBonus": 1, "agilityPenalty": 0, "weight": 4.0,
					},
					{
						"id": "inv_lir_buckler", "itemId": "broquel-madeira", "name": "Broquel de Madeira", "category": "shield", "slot": "shield",
						"equipped": true, "quantity": 1, "armorClass": "L", "absorcao": 1, "defActiveBonus": 1, "defPassiveBonus": 0, "agilityPenalty": 0, "weight": 1.2,
					},
					{
						"id": "inv_lir_picks", "itemId": "gazuas-de-ladino", "name": "Estojo de Gazuas", "category": "gear",
						"equipped": true, "quantity": 1, "weight": 0.5,
						"effect": map[string]any{"skillBonus": map[string]any{"destravar-fechaduras": 1}},
					},
					{
						"id": "inv_lir_potion", "itemId": "pocao-cura-heroica-menor", "name": "Poção de Cura Heróica Menor", "category": "consumable",
						"equipped": false, "quantity": 1, "weight": 0.3,
						"effect":      map[string]any{"healEh": 10},
						"description": "Restaura 10 pontos de Energia Heróica (EH).",
					},
				},
				"money":         map[string]any{"mo": 0, "mp": 3, "mc": 8},
				"languages":     []string{"Malês", "Lanta"},
				"notes":         "Batedora furtiva e especialista em fechaduras, conhece cada trilha escondida ao redor da estrada de Verrogar.",
				"biography":     "Deixou sua vila pacata por pura curiosidade pelas estradas do Mundo Conhecido e hoje atua como olhos e ouvidos do grupo.",
				"efMax":         12,
				"ehMax":         14,
				"karmaMax":      0,
				"defesaAtiva":   6,
				"defesaPassiva": 1,
				"absorcao":      9,
				"rf":            3,
				"rm":            1,
				"vb":            16,
				"iniciativa":    4,
			},
			Computed: map[string]any{
				"efMax":            12, // 11 - 1 FOR + 2 FIS
				"ehMax":            14, // 12 + 2 FIS
				"karmaMax":         0,
				"defesaAtiva":      6, // 4 AGI + 1 armor + 1 buckler
				"defesaPassiva":    1, // 1 armor
				"effectiveDefense": 6,
				"absorcao":         9, // 8 + 1
				"armorClass":       "L",
				"rf":               3, // 1 stage + 2 FIS
				"rm":               1, // 1 stage + 0 AUR
				"vb":               16,
				"vbQuadrados":      10,
				"iniciativa":       4,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "npc_tagmar_brenno",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindNPC,
			Name:                "Capitão Brenno",
			Subtitle:            "Comandante da Guarnição de Verrogar · Estágio 2",
			PortraitURL:         "./assets/portraits/human-warrior.svg",
			OwnerUserID:         strPtr(TagmarGMUserID),
			ControlledByUserIDs: []string{TagmarGMUserID},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 27, Max: 27},
				"ef":    {Current: 19, Max: 19, Temp: 22},
				"karma": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":             "humano",
				"raceName":           "Humano",
				"professionId":       "guerreiro",
				"professionName":     "Guerreiro",
				"stage":              2,
				"xp":                 14,
				"ehGainedFromStages": 7,
				"attributes": map[string]any{
					"intelecto": 1,
					"aura":      0,
					"carisma":   2,
					"forca":     2,
					"fisico":    2,
					"agilidade": 2,
				},
				"skills": []map[string]any{
					{"id": "sk_bre_1", "skillId": "oratoria", "name": "Oratória", "group": "Influência", "attribute": "carisma", "level": 3},
					{"id": "sk_bre_2", "skillId": "montar-animais", "name": "Montar Animais", "group": "Manobra", "attribute": "agilidade", "level": 3},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_bre_1", "techniqueId": "corte-medio-espadas", "name": "Armas de Corte Médio — Espadas (CmE)", "category": "melee", "attribute": "agilidade", "level": 5},
					{"id": "ct_bre_2", "techniqueId": "uso-de-escudo", "name": "Uso de Escudo", "category": "defense", "attribute": "forca", "level": 4},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_bre_sword", "itemId": "espada-longa", "name": "Espada Longa da Guarda", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Corte Médio — Espadas",
						"damage":     map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
						"damageType": "Corte", "hands": 1, "minFor": 0, "columnBonus": 1, "range": "Corpo a Corpo", "weight": 1.8,
					},
					{
						"id": "inv_bre_armor", "itemId": "cota-de-malha-parcial", "name": "Cota de Malha Parcial", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 18, "defActiveBonus": 1, "defPassiveBonus": 1, "agilityPenalty": -1, "weight": 11.0,
					},
					{
						"id": "inv_bre_shield", "itemId": "paves-pequeno", "name": "Pavês Pequeno (Escudo Médio)", "category": "shield", "slot": "shield",
						"equipped": true, "quantity": 1, "armorClass": "M", "absorcao": 4, "defActiveBonus": 2, "defPassiveBonus": 0, "agilityPenalty": 0, "weight": 3.5,
					},
				},
				"money":         map[string]any{"mo": 2, "mp": 6, "mc": 0},
				"notes":         "Veterano austero responsável pela defesa da Fronteira de Verrogar. Contrata aventureiros para investigar os ataques na estrada.",
				"efMax":         19,
				"ehMax":         27,
				"karmaMax":      0,
				"defesaAtiva":   4,
				"defesaPassiva": 1,
				"absorcao":      22,
				"rf":            4,
				"rm":            2,
				"vb":            22,
				"iniciativa":    2,
			},
			Computed: map[string]any{
				"efMax": 19, "ehMax": 27, "karmaMax": 0,
				"defesaAtiva": 4, "defesaPassiva": 1, "effectiveDefense": 4,
				"absorcao": 22, "armorClass": "M", "rf": 4, "rm": 2, "vb": 22, "vbQuadrados": 14, "iniciativa": 2,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "mob_tagmar_orc_raider",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindMonster,
			Name:                "Orc Saqueador",
			Subtitle:            "Raças Selvagens · Estágio 2",
			PortraitURL:         "./assets/portraits/orc-barbarian.svg",
			OwnerUserID:         strPtr(TagmarGMUserID),
			ControlledByUserIDs: []string{TagmarGMUserID},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 14, Max: 14},
				"ef":    {Current: 16, Max: 16, Temp: 12},
				"karma": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":            "meio-orco",
				"raceName":          "Orco",
				"professionId":      "guerreiro",
				"professionName":    "Saqueador",
				"stage":             2,
				"xp":                3,
				"baseEfOverride":       12,
				"baseEhOverride":       12,
				"baseVbOverride":       16,
				"naturalAbsorption":    0,
				"naturalDefenseActive": 2,
				"rfBonus":              -1,
				"attributes": map[string]any{
					"intelecto": -1,
					"aura":      -1,
					"carisma":   -2,
					"forca":     2,
					"fisico":    2,
					"agilidade": 1,
				},
				"skills": []map[string]any{
					{"id": "sk_orc_1", "skillId": "usar-os-sentidos", "name": "Usar os Sentidos", "group": "Geral", "attribute": "intelecto", "level": 2},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_orc_1", "techniqueId": "corte-medio-machados", "name": "Armas de Corte Médio — Machados (CmM)", "category": "melee", "attribute": "forca", "level": 4},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_orc_axe", "itemId": "machado-de-batalha", "name": "Machado de Batalha Orco", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Corte Médio — Machados",
						"damage":     map[string]any{"verde": 5, "amarelo": 10, "laranja": 15, "vermelho": 20, "azul": 25},
						"damageType": "Corte", "hands": 1, "minFor": 1, "columnBonus": 0, "range": "Corpo a Corpo", "weight": 2.2,
					},
					{
						"id": "inv_orc_armor", "itemId": "couro-rigido", "name": "Armadura de Couro Rígido", "category": "armor", "slot": "armor",
						"equipped": true, "quantity": 1, "armorClass": "L", "absorcao": 12, "defActiveBonus": 2, "defPassiveBonus": 2, "agilityPenalty": -1, "weight": 6.0,
					},
				},
				"money":         map[string]any{"mo": 0, "mp": 1, "mc": 4},
				"notes":         "Saqueador orco agressivo das terras ermas ao norte de Verrogar.",
				"efMax":         16,
				"ehMax":         14,
				"karmaMax":      0,
				"defesaAtiva":   4,
				"defesaPassiva": 2,
				"absorcao":      12,
				"rf":            4,
				"rm":            1,
				"vb":            18,
				"iniciativa":    1,
			},
			Computed: map[string]any{
				"efMax": 16, "ehMax": 14, "karmaMax": 0,
				"defesaAtiva": 4, "defesaPassiva": 2, "effectiveDefense": 4,
				"absorcao": 12, "armorClass": "L", "rf": 4, "rm": 1, "vb": 18, "vbQuadrados": 12, "iniciativa": 1,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "mob_tagmar_snow_wolf",
			CampaignID:          TagmarCampaignID,
			SystemID:            "tagmar-3",
			Kind:                model.CharKindMonster,
			Name:                "Lobo das Neves",
			Subtitle:            "Fera Ártica · Estágio 3",
			PortraitURL:         "./assets/monsters/dire-wolf.svg",
			OwnerUserID:         strPtr(TagmarGMUserID),
			ControlledByUserIDs: []string{TagmarGMUserID},
			Resources: map[string]model.ResourceBar{
				"eh":    {Current: 18, Max: 18},
				"ef":    {Current: 20, Max: 20, Temp: 10},
				"karma": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":            "fera",
				"raceName":          "Fera",
				"professionId":      "rastreador",
				"professionName":    "Predador",
				"stage":             3,
				"xp":                6,
				"baseEfOverride":        14,
				"baseEhOverride":        15,
				"baseVbOverride":        21,
				"naturalAbsorption":     10,
				"naturalDefenseActive":  3,
				"naturalDefensePassive": 3,
				"attributes": map[string]any{
					"intelecto": -1,
					"aura":      0,
					"carisma":   -1,
					"forca":     3,
					"fisico":    3,
					"agilidade": 3,
				},
				"skills": []map[string]any{
					{"id": "sk_wolf_1", "skillId": "acoes-furtivas", "name": "Ações Furtivas", "group": "Subterfúgio", "attribute": "agilidade", "level": 4},
				},
				"combatTechniques": []map[string]any{
					{"id": "ct_wolf_1", "techniqueId": "briga-artes-marciais", "name": "Mordida e Investida", "category": "melee", "attribute": "forca", "level": 5},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_wolf_bite", "name": "Mordida Gélida", "category": "weapon",
						"equipped": true, "quantity": 1, "weaponGroup": "Briga",
						"damage":     map[string]any{"verde": 4, "amarelo": 9, "laranja": 13, "vermelho": 18, "azul": 22},
						"damageType": "Perfuração", "hands": 1, "minFor": 0, "columnBonus": 1, "range": "Corpo a Corpo", "weight": 0,
					},
				},
				"money":         map[string]any{"mo": 0, "mp": 0, "mc": 0},
				"notes":         "Lobo albino gigantesco adestrado pelos saqueadores para emboscar viajantes na floresta sombria.",
				"efMax":         20,
				"ehMax":         18,
				"karmaMax":      0,
				"defesaAtiva":   6,
				"defesaPassiva": 3,
				"absorcao":      10,
				"rf":            6,
				"rm":            3,
				"vb":            24,
				"iniciativa":    3,
			},
			Computed: map[string]any{
				"efMax": 20, "ehMax": 18, "karmaMax": 0,
				"defesaAtiva": 6, "defesaPassiva": 3, "effectiveDefense": 6,
				"absorcao": 10, "armorClass": "L", "rf": 6, "rm": 3, "vb": 24, "vbQuadrados": 16, "iniciativa": 3,
			},
			Visibility: model.VisibilityGMOnly,
			UpdatedAt:  now,
		},
	}
	for _, c := range characters {
		if err := st.UpsertCharacter(ctx, c); err != nil {
			return err
		}
	}

	allRevealed := strings.Repeat("1", 24*18)
	forestFog := buildFogGrid(24, 18, func(x, y int) bool {
		return x >= 2 && x <= 11 && y >= 6 && y <= 12
	})

	scenes := []model.Scene{
		{
			ID:         TagmarSceneFortress,
			CampaignID: TagmarCampaignID,
			Name:       "Pátio da Fortaleza de Verrogar",
			ImageURL:   "./assets/maps/castle-courtyard.svg",
			Width:      1600,
			Height:     1200,
			Grid: model.SceneGrid{
				Enabled:    true,
				Cols:       24,
				Rows:       18,
				CellMeters: 1.5,
				Color:      "rgba(255,255,255,0.16)",
				Snap:       true,
			},
			Fog: model.SceneFog{
				Enabled:       false,
				RevealedCells: allRevealed,
			},
			Tokens: []model.Token{
				{
					ID: "tok_tagmar_kael", CharacterID: strPtr("char_kael"), Name: "Kael",
					ImageURL: "./assets/portraits/human-warrior.svg", X: 9, Y: 10, Size: 1,
					Color: "#d4a84f", Layer: "tokens", ShowBars: true,
					HP: intPtr(20), HPMax: intPtr(20), MP: intPtr(20), MPMax: intPtr(20),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_tagmar_aelindra", CharacterID: strPtr("char_aelindra"), Name: "Aelindra",
					ImageURL: "./assets/portraits/elf-mage.svg", X: 11, Y: 10, Size: 1,
					Color: "#38bdf8", Layer: "tokens", ShowBars: true,
					HP: intPtr(6), HPMax: intPtr(6), MP: intPtr(12), MPMax: intPtr(12),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_tagmar_thorgar", CharacterID: strPtr("char_thorgar"), Name: "Thorgar",
					ImageURL: "./assets/portraits/dwarf-paladin.svg", X: 10, Y: 11, Size: 1,
					Color: "#eab308", Layer: "tokens", ShowBars: true,
					HP: intPtr(15), HPMax: intPtr(15), MP: intPtr(20), MPMax: intPtr(20),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_tagmar_liriel", CharacterID: strPtr("char_liriel"), Name: "Liriel",
					ImageURL: "./assets/portraits/goblin-rogue.svg", X: 12, Y: 11, Size: 1,
					Color: "#22c55e", Layer: "tokens", ShowBars: true,
					HP: intPtr(14), HPMax: intPtr(14), MP: intPtr(12), MPMax: intPtr(12),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_tagmar_brenno", CharacterID: strPtr("npc_tagmar_brenno"), Name: "Capitão Brenno",
					ImageURL: "./assets/portraits/human-warrior.svg", X: 10, Y: 7, Size: 1,
					Color: "#a855f7", Layer: "tokens", ShowBars: false,
					HP: intPtr(27), HPMax: intPtr(27), MP: intPtr(19), MPMax: intPtr(19),
					Conditions: []string{}, ControlledByUserIDs: []string{TagmarGMUserID},
				},
				{
					// Hidden GM-layer ambush scout on the battlements — MUST be stripped for players!
					ID: "tok_tagmar_orc_ambush_gm", CharacterID: strPtr("mob_tagmar_orc_raider"), Name: "Orc Batedor (Oculto)",
					ImageURL: "./assets/portraits/orc-barbarian.svg", X: 20, Y: 4, Size: 1,
					Color: "#ef4444", Layer: "gm", ShowBars: true,
					HP: intPtr(14), HPMax: intPtr(14), MP: intPtr(16), MPMax: intPtr(16),
					Conditions: []string{}, ControlledByUserIDs: []string{TagmarGMUserID},
				},
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:         TagmarSceneForest,
			CampaignID: TagmarCampaignID,
			Name:       "Estrada da Floresta Sombria",
			ImageURL:   "./assets/maps/forest-road.svg",
			Width:      1600,
			Height:     1200,
			Grid: model.SceneGrid{
				Enabled: true, Cols: 24, Rows: 18, CellMeters: 1.5, Color: "rgba(255,255,255,0.16)", Snap: true,
			},
			Fog: model.SceneFog{
				Enabled:       true,
				RevealedCells: forestFog,
			},
			Tokens: []model.Token{
				{
					ID: "tok_tagmar_forest_orc", CharacterID: strPtr("mob_tagmar_orc_raider"), Name: "Orc Saqueador",
					ImageURL: "./assets/portraits/orc-barbarian.svg", X: 15, Y: 9, Size: 1,
					Color: "#ef4444", Layer: "tokens", ShowBars: true,
					HP: intPtr(14), HPMax: intPtr(14), MP: intPtr(16), MPMax: intPtr(16),
					Conditions: []string{}, ControlledByUserIDs: []string{TagmarGMUserID},
				},
				{
					// Hidden GM-layer ambush beast — MUST be stripped on wire for non-GM players!
					ID: "tok_tagmar_wolf_ambush_gm", CharacterID: strPtr("mob_tagmar_snow_wolf"), Name: "Lobo das Neves (Emboscada)",
					ImageURL: "./assets/monsters/dire-wolf.svg", X: 17, Y: 5, Size: 1,
					Color: "#ef4444", Layer: "gm", ShowBars: true,
					HP: intPtr(18), HPMax: intPtr(18), MP: intPtr(20), MPMax: intPtr(20),
					Conditions: []string{}, ControlledByUserIDs: []string{TagmarGMUserID},
				},
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
	}
	for _, sc := range scenes {
		if err := st.UpsertScene(ctx, sc); err != nil {
			return err
		}
	}

	// Hierarchical Folders
	folders := []model.Folder{
		{
			ID:         "folder_tagmar_gm_secrets",
			CampaignID: TagmarCampaignID,
			ParentID:   nil,
			Name:       "Segredos do Mestre — Verrogar",
			Icon:       "lock",
			SortOrder:  1,
			Visibility: model.VisibilityGMOnly,
			CreatedBy:  TagmarGMUserID,
		},
		{
			ID:         "folder_tagmar_chronicles",
			CampaignID: TagmarCampaignID,
			ParentID:   nil,
			Name:       "Crônicas dos Reinos",
			Icon:       "book-open",
			SortOrder:  2,
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  TagmarGMUserID,
		},
		{
			ID:         "folder_tagmar_table",
			CampaignID: TagmarCampaignID,
			ParentID:   nil,
			Name:       "Tabela de Resolução Rápida",
			Icon:       "table",
			SortOrder:  3,
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  TagmarGMUserID,
		},
	}
	for _, f := range folders {
		if err := st.UpsertFolder(ctx, f); err != nil {
			return err
		}
	}

	docs := []model.Document{
		{
			ID:         "doc_tagmar_gm_ambush",
			CampaignID: TagmarCampaignID,
			FolderID:   strPtr("folder_tagmar_gm_secrets"),
			Kind:       model.DocKindLore,
			Title:      "Emboscada Orc na Estrada Norte",
			Content:    "## Notas Secretas do Mestre\n\nUm bando de saqueadores orcs lidera um **Lobo das Neves** treinado para atacar caravanas na *Estrada da Floresta Sombria*.\n\n- Um **Orc Batedor** está oculto na camada GM do pátio vigiando os portões.\n- Na floresta, o **Lobo das Neves** permanece na camada GM aguardando o sinal do saqueador (Teste de *Usar os Sentidos* Col. Difícil / Laranja para notar antes do ataque).",
			Tags:       []string{"gm", "verrogar", "emboscada"},
			Visibility: model.VisibilityGMOnly,
			CreatedBy:  TagmarGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_tagmar_verrogar_lore",
			CampaignID: TagmarCampaignID,
			FolderID:   strPtr("folder_tagmar_chronicles"),
			Kind:       model.DocKindLore,
			Title:      "Fronteira de Verrogar — O Mundo Conhecido",
			Content:    "# Crônicas de Tagmar: Verrogar\n\nSituado nas fronteiras setentrionais do Mundo Conhecido, o **Reino de Verrogar** sustenta fortalezas de pedra contra incursões das Terras Selvagens.\n\n- **Fortaleza de Verrogar:** Quartel do Capitão Brenno e ponto de reunião para escoltas de mercadores.\n- **Estrada da Floresta Sombria:** Rota comercial cercada por pinheiros frios onde patrulhas recentes desapareceram.",
			ImageURL:   "./assets/maps/castle-courtyard.svg",
			Tags:       []string{"tagmar", "verrogar", "lore"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  TagmarGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_tagmar_brenno_orders",
			CampaignID: TagmarCampaignID,
			FolderID:   strPtr("folder_tagmar_chronicles"),
			Kind:       model.DocKindHandout,
			Title:      "Edital do Capitão Brenno",
			Content:    "### Convocação da Guarnição — 15 Moedas de Prata (MP) por Herói\n\n*\"Procuram-se aventureiros capazes de patrulhar a Estrada da Floresta Sombria, resgatar a caravana de suprimentos e afastar os saqueadores orcs que rondam Verrogar.\"*",
			Tags:       []string{"missao", "handout"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  TagmarGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_tagmar_quick_rules",
			CampaignID: TagmarCampaignID,
			FolderID:   strPtr("folder_tagmar_table"),
			Kind:       model.DocKindLore,
			Title:      "Guia Rápido: Tagmar 3.0 & Tabela de Resolução",
			Content:    "## Tabela de Resolução (1d20 vs Coluna)\n\n- **Erro Crítico:** Falha desastrosa (1 no d20; 1–2 em colunas -7 a -4).\n- **Falha:** O golpe erra ou a tarefa não atinge o grau mínimo.\n- **Verde (25%) · Amarelo (50%) · Laranja (75%) · Vermelho (100%):** Sucesso progressivo aplicando o dano colorido da arma!\n- **Azul — Crítico (125%):** Golpe devastador direto na **Energia Física (EF)**, ignorando EH e Absorção comum!\n\n## Fluxo de Dano & Recursos\n- **EH (Energia Heróica):** Absorve dano normal primeiro.\n- **Absorção → EF (Energia Física):** O dano excedente é amortecido pela Absorção da armadura/escudo antes de ferir a EF (`EF ≤ 0` Inconsciente · `EF ≤ -15` Morto).\n- **Karma:** `(AUR + 1) × (Estágio + 1)` para místicos com Aura ≥ 1.\n- **Resistências (RF / RM):** Role `1d20` na Tabela de Resistências (FD vs FA).\n- **Iniciativa:** `1d10 + AGI`.\n\n*Conteúdo Tagmar 3.0 © Projeto Tagmar (tagmar.com.br) — CC BY-NC-SA 3.0 BR.*",
			Tags:       []string{"regras", "tagmar", "tabela"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  TagmarGMUserID,
			UpdatedAt:  now,
		},
	}
	for _, d := range docs {
		if err := st.UpsertDocument(ctx, d); err != nil {
			return err
		}
	}

	// Default Tagmar 3.0 Macros
	macros := []model.Macro{
		{
			ID: "macro_tagmar_tabela", CampaignID: TagmarCampaignID, Name: "Teste na Tabela (1d20)",
			Icon: "dices", Color: "#22c55e", Scope: "campaign",
			Script:     `roll("1d20", "Teste na Tabela de Resolução", { tagmarColumn: @agilidade + 2 })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: TagmarGMUserID,
		},
		{
			ID: "macro_tagmar_iniciativa", CampaignID: TagmarCampaignID, Name: "Iniciativa (1d10+AGI)",
			Icon: "zap", Color: "#eab308", Scope: "campaign",
			Script:     `roll("1d10 + @agilidade", "Iniciativa (Tagmar)", { kind: "initiative" })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: TagmarGMUserID,
		},
		{
			ID: "macro_tagmar_rf", CampaignID: TagmarCampaignID, Name: "Resistência Física (RF)",
			Icon: "shield", Color: "#f97316", Scope: "campaign",
			Script:     `roll("1d20", "Resistência Física (RF vs FA 5)", { tagmarResistance: { kind: "rf", fa: 5, fd: @rf } })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: TagmarGMUserID,
		},
		{
			ID: "macro_tagmar_rm", CampaignID: TagmarCampaignID, Name: "Resistência à Magia (RM)",
			Icon: "sparkles", Color: "#38bdf8", Scope: "campaign",
			Script:     `roll("1d20", "Resistência à Magia (RM vs FA 5)", { tagmarResistance: { kind: "rm", fa: 5, fd: @rm } })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: TagmarGMUserID,
		},
	}
	for _, mc := range macros {
		if err := st.UpsertMacro(ctx, mc); err != nil {
			return err
		}
	}

	// Opening narration + sample Tagmar 3.0 color-coded roll card (Col 6, d20=15 -> Laranja 75%)
	col6 := 6
	welcomeMsgs := []model.ChatMessage{
		{
			ID:           "msg_tagmar_seed_narration",
			CampaignID:   TagmarCampaignID,
			Kind:         model.ChatKindNarration,
			SenderUserID: TagmarGMUserID,
			SenderName:   "Mestre de Tagmar",
			Content:      "O vento frio das montanhas corta o **Pátio da Fortaleza de Verrogar** enquanto os sinos da muralha ecoam ao amanhecer. O **Capitão Brenno** chama vocês junto ao portão norte: uma caravana de suprimentos não chegou da *Estrada da Floresta Sombria*. Preparados para marchar pelo Mundo Conhecido?",
			Visibility:   model.VisibilityAllPlayers,
			CreatedAt:    now.Add(-2 * time.Minute),
		},
		{
			ID:            "msg_tagmar_seed_roll",
			CampaignID:    TagmarCampaignID,
			Kind:          model.ChatKindRoll,
			SenderUserID:  TagmarGMUserID,
			SenderName:    "Mestre de Tagmar",
			CharacterID:   "char_kael",
			CharacterName: "Kael de Verrogar",
			PortraitURL:   "./assets/portraits/human-warrior.svg",
			Content:       "Kael testa o fio de sua Espada Longa no pátio antes da patrulha.",
			Roll: &model.RollResult{
				RollID:           "roll_tagmar_seed_01",
				Formula:          "1d20",
				Label:            "Ataque · Espada Longa (Col 6)",
				Dice:             []model.RolledDie{{Sides: 20, Value: 15}},
				Modifier:         0,
				Total:            15,
				Seed:             303030,
				TagmarColumn:     &col6,
				TagmarColor:      "laranja",
				TagmarDamageTier: 3,
				TagmarDirectToEf: false,
				Outcome: &model.RollOutcome{
					Kind:      "success",
					BadgeText: "LARANJA (75%) · Col 6",
				},
				SystemMeta: map[string]any{
					"tagmarColumn":     6,
					"tagmarColor":      "laranja",
					"tagmarDamageTier": 3,
					"tagmarDirectToEf": false,
					"weaponDamage":     map[string]any{"verde": 4, "amarelo": 8, "laranja": 12, "vermelho": 16, "azul": 20},
					"damageType":       "Corte",
				},
			},
			Visibility: model.VisibilityAllPlayers,
			CreatedAt:  now.Add(-1 * time.Minute),
		},
	}
	for _, msg := range welcomeMsgs {
		if err := st.CreateMessage(ctx, msg); err != nil {
			return err
		}
	}

	return nil
}
