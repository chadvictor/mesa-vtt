package seed

import (
	"context"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

const (
	DemoCampaignID   = "camp_drakon_01"
	DemoInviteCode   = "DRAKON"
	DemoGMUserID     = "seed_gm_mestre"
	DemoVoiceMainID  = "vc_drakon_main"
	DemoVoicePrivID  = "vc_drakon_whisper"
	DemoSceneTavern  = "scene_tavern"
	DemoSceneCrypt   = "scene_crypt"
	DemoSceneForest  = "scene_forest"
	DemoSceneCastle  = "scene_castle"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

// EnsureSeeded populates the flagship demo campaign if the store has no campaigns yet.
func EnsureSeeded(ctx context.Context, st store.Store) error {
	existing, err := st.ListCampaigns(ctx)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}

	now := time.Now().UTC()

	campaign := model.Campaign{
		ID:            DemoCampaignID,
		Name:          "Crônicas de Drakon — A Estalagem do Javali Dourado",
		Description:   "Uma aventura introdutória oficial de Mighty Blade 3ª Edição em Drakon: rumores de cultistas nas criptas antigas, emboscadas na floresta e segredos na Estalagem do Javali Dourado.",
		SystemID:      "mighty-blade-3e",
		CoverURL:      "./assets/banner-mesa-rpg.svg",
		InviteCode:    DemoInviteCode,
		Privacy:       "public",
		OwnerUserID:   DemoGMUserID,
		ActiveSceneID: strPtr(DemoSceneTavern),
		Combat: model.CombatState{
			Active:     false,
			Round:      1,
			TurnIndex:  0,
			Combatants: []model.Combatant{},
		},
		Settings: model.CampaignSettings{
			AllowPlayerDice3D:     true,
			DefaultVoiceChannelID: DemoVoiceMainID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := st.CreateCampaign(ctx, campaign); err != nil {
		return err
	}

	// Seed GM member
	if err := st.UpsertMember(ctx, model.CampaignMember{
		CampaignID:  DemoCampaignID,
		UserID:      DemoGMUserID,
		DisplayName: "Mestre de Drakon",
		AvatarURL:   "./assets/portraits/gm-avatar.svg",
		Role:        model.RoleGM,
		JoinedAt:    now,
	}); err != nil {
		return err
	}

	// Voice channels
	voiceChannels := []model.VoiceChannel{
		{
			ID:               DemoVoiceMainID,
			CampaignID:       DemoCampaignID,
			Name:             "Mesa Principal",
			IsDefault:        true,
			LockedForPlayers: false,
		},
		{
			ID:               DemoVoicePrivID,
			CampaignID:       DemoCampaignID,
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

	// Mighty Blade 3e Heroes & NPCs/Monsters (exact MightyBladeSystemData contract)
	characters := []model.Character{
		{
			ID:                  "char_aldric",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindPC,
			Name:                "Aldric de Valmont",
			Subtitle:            "Guerreiro Humano · Nível 1",
			PortraitURL:         "./assets/portraits/human-warrior.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 60, Max: 60},
				"pm": {Current: 60, Max: 60},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":    "humano",
				"raceName":  "Humano",
				"classId":   "guerreiro",
				"className": "Guerreiro",
				"level":     1,
				"xp":        0,
				"money":     85,
				"size":      "Médio",
				"attributes": map[string]any{
					"forca":        5,
					"agilidade":    4,
					"inteligencia": 3,
					"vontade":      3,
				},
				"abilities": []map[string]any{
					{
						"id":          "ab_aldric_1",
						"abilityId":   "guerreiro-de-aco",
						"name":        "Guerreiro de Aço",
						"category":    "caracteristica",
						"manaCost":    0,
						"description": "Reduz em 1 a Força Necessária (FN) de armaduras e escudos e ignora penalidades de deslocamento de armaduras pesadas.",
						"automation":  map[string]any{"defenseBonus": 1, "targetType": "self"},
					},
					{
						"id":          "ab_aldric_2",
						"abilityId":   "ataque-poderoso",
						"name":        "Ataque Poderoso",
						"category":    "acao",
						"manaCost":    10,
						"description": "Realize um ataque corpo a corpo que causa +6 de dano adicional caso acerte.",
						"automation":  map[string]any{"rollAttribute": "forca", "damageFormula": "weapon + 6", "damageType": "Corte", "targetType": "single"},
					},
					{
						"id":          "ab_aldric_3",
						"abilityId":   "postura-defensiva",
						"name":        "Postura Defensiva",
						"category":    "suporte",
						"manaCost":    10,
						"description": "Você firma os pés e ergue seu escudo em guarda fechada, recebendo +2 em Bloqueio até o próximo turno.",
						"automation":  map[string]any{"defenseBonus": 2, "targetType": "self"},
					},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_aldric_sword", "itemId": "espada-longa", "name": "Espada Longa", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 3, "damageBonus": 7, "damageAttribute": "forca", "damageType": "Corte",
						"weight": 2.0, "range": "Corpo a Corpo", "description": "Lâmina versátil forjada em Valmont.",
					},
					{
						"id": "inv_aldric_shield", "itemId": "escudo-medio", "name": "Escudo Médio", "category": "shield",
						"equipped": true, "quantity": 1, "fn": 2, "defenseBonus": 2, "agilityPenalty": 0,
						"weight": 3.0, "description": "Escudo de carvalho reforçado com aço.",
					},
					{
						"id": "inv_aldric_armor", "itemId": "cota-de-malha", "name": "Cota de Malha", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 4, "defenseBonus": 3, "agilityPenalty": 0,
						"weight": 12.0, "description": "Anéis de aço entrelaçados de alta resistência.",
					},
					{
						"id": "inv_aldric_potion", "itemId": "pocao-cura-menor", "name": "Poção de Cura Menor", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.5,
						"effect":      map[string]any{"heal": 20},
						"description": "Recupera 20 Pontos de Vida ao ser consumida.",
					},
				},
				"notes": "Veterano da guarda fronteiriça de Valmont em busca de seu irmão desaparecido nas colinas de Drakon.",
			},
			Computed: map[string]any{
				"bloqueio":     15, // 5 + 5 FOR + 3 armadura + 2 escudo
				"esquiva":      9,  // 5 + 4 AGI
				"defesa":       15,
				"determinacao": 11, // 8 + max(3 INT, 3 VON)
				"deslocamento": 7,  // floor(4/2) + 5
				"cargaBasica":  35, // 5 * 7
				"cargaPesada":  70, // 5 * 14
				"cargaMaxima":  105,
				"fnPenalty":    false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_lyra",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindPC,
			Name:                "Lyra Estrela-da-Alva",
			Subtitle:            "Elfa Maga · Nível 1",
			PortraitURL:         "./assets/portraits/elf-mage.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 60, Max: 60},
				"pm": {Current: 60, Max: 60},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":    "elfo",
				"raceName":  "Elfo",
				"classId":   "feiticeiro",
				"className": "Feiticeiro",
				"level":     1,
				"xp":        0,
				"money":     120,
				"size":      "Médio",
				"attributes": map[string]any{
					"forca":        2,
					"agilidade":    4,
					"inteligencia": 4,
					"vontade":      4,
				},
				"abilities": []map[string]any{
					{
						"id":          "ab_lyra_1",
						"abilityId":   "sentidos-apurados",
						"name":        "Sentidos Apurados",
						"category":    "suporte",
						"manaCost":    0,
						"description": "Rola +1d6 (3d6) em testes de Inteligência de percepção, +1 em Iniciativa e visão na penumbra.",
						"automation":  map[string]any{"perceptionDiceBonus": 1, "initiativeBonus": 1, "targetType": "self"},
					},
					{
						"id":          "ab_lyra_2",
						"abilityId":   "foco-elemental",
						"name":        "Foco Elemental",
						"category":    "suporte",
						"manaCost":    0,
						"description": "Aumenta em +2 o dano de suas magias do Caminho do Fogo.",
						"automation":  map[string]any{"damageBonus": 2, "targetType": "self"},
					},
				},
				"spells": []map[string]any{
					{
						"id": "sp_lyra_1", "spellId": "seta-flamejante", "name": "Seta Flamejante", "path": "Fogo", "type": "acao",
						"manaCost": 10, "difficulty": 9, "range": "15 metros", "duration": "Instantânea",
						"description": "Dispara um projétil incandescente causando 12 + Inteligência de dano Fogo.",
						"automation":  map[string]any{"rollAttribute": "inteligencia", "damageFormula": "12 + inteligencia", "damageType": "Fogo", "targetType": "single"},
					},
					{
						"id": "sp_lyra_2", "spellId": "escudo-arcano", "name": "Escudo Arcano", "path": "Arcano", "type": "reacao",
						"manaCost": 10, "difficulty": 9, "range": "Pessoal", "duration": "1 Cena",
						"description": "Conjura uma barreira translúcida que concede +2 em Defesa.",
						"automation":  map[string]any{"rollAttribute": "inteligencia", "defenseBonus": 2, "targetType": "self"},
					},
					{
						"id": "sp_lyra_3", "spellId": "rajada-de-gelo", "name": "Rajada de Gelo", "path": "Água", "type": "acao",
						"manaCost": 10, "difficulty": 10, "range": "12 metros", "duration": "Instantânea",
						"description": "Dispara um feixe congelante causando 10 + Inteligência de dano Gelo.",
						"automation":  map[string]any{"rollAttribute": "inteligencia", "damageFormula": "10 + inteligencia", "damageType": "Gelo", "targetType": "single"},
					},
					{
						"id": "sp_lyra_4", "spellId": "luz", "name": "Luz", "path": "Luz", "type": "acao",
						"manaCost": 5, "difficulty": 8, "range": "10 metros", "duration": "1 Cena",
						"description": "Ilumina uma área de 10 metros com brilho claro e constante.",
						"automation":  map[string]any{"rollAttribute": "inteligencia", "targetType": "area"},
					},
				},
				"inventory": []map[string]any{
					{
						"id": "inv_lyra_staff", "itemId": "cajado", "name": "Cajado Arcano", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 1, "damageBonus": 4, "damageAttribute": "forca", "damageType": "Contusão",
						"weight": 1.5, "range": "Corpo a Corpo", "description": "Cajado de freixo élfico entalhado com runas.",
					},
					{
						"id": "inv_lyra_robe", "itemId": "manto-arcano", "name": "Manto do Estudioso", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 1, "defenseBonus": 1, "agilityPenalty": 0,
						"weight": 1.5, "description": "Manto leve tecido com fios protetores.",
					},
					{
						"id": "inv_lyra_potion", "itemId": "pocao-mana-menor", "name": "Poção de Mana Menor", "category": "consumable",
						"equipped": false, "quantity": 2, "weight": 0.5,
						"effect":      map[string]any{"restorePm": 20},
						"description": "Restaura 20 Pontos de Mana ao ser consumida.",
					},
				},
				"notes": "Estudiosa da Torre de Cristal investigando perturbações na trama arcana sob o Javali Dourado.",
			},
			Computed: map[string]any{
				"bloqueio":     8,  // 5 + 2 FOR + 1 manto
				"esquiva":      9,  // 5 + 4 AGI
				"defesa":       9,
				"determinacao": 12, // 8 + max(4 INT, 4 VON)
				"deslocamento": 7,  // floor(4/2) + 5
				"cargaBasica":  14, // 2 * 7
				"cargaPesada":  28,
				"cargaMaxima":  42,
				"fnPenalty":    false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_borin",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindPC,
			Name:                "Borin Martelo-de-Ouro",
			Subtitle:            "Anão Paladino · Nível 1",
			PortraitURL:         "./assets/portraits/dwarf-paladin.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 60, Max: 60},
				"pm": {Current: 60, Max: 60},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":    "anao",
				"raceName":  "Anão",
				"classId":   "paladino",
				"className": "Paladino",
				"level":     1,
				"xp":        0,
				"money":     65,
				"size":      "Médio",
				"attributes": map[string]any{
					"forca":        5,
					"agilidade":    2,
					"inteligencia": 3,
					"vontade":      4,
				},
				"abilities": []map[string]any{
					{
						"id":          "ab_borin_1",
						"abilityId":   "coracao-da-montanha",
						"name":        "Coração da Montanha",
						"category":    "suporte",
						"manaCost":    0,
						"description": "+2 em testes de Resistência contra venenos, doenças e efeitos físicos debilitantes; visão no escuro.",
						"automation":  map[string]any{"resistanceBonus": 2, "targetType": "self"},
					},
					{
						"id":          "ab_borin_2",
						"abilityId":   "aura-divina",
						"name":        "Aura Divina",
						"category":    "suporte",
						"manaCost":    0,
						"description": "Você e aliados adjacentes recebem +1 em Determinação e em testes contra medo e efeitos de Trevas.",
						"automation":  map[string]any{"determinacaoBonus": 1, "targetType": "self"},
					},
					{
						"id":          "ab_borin_3",
						"abilityId":   "bencao-da-justica",
						"name":        "Bênção da Justiça",
						"category":    "acao",
						"manaCost":    10,
						"description": "Canaliza luz sagrada em seu martelo causando +6 de dano Sagrado em um golpe.",
						"automation":  map[string]any{"rollAttribute": "forca", "damageFormula": "weapon + 6", "damageType": "Sagrado", "targetType": "single"},
					},
				},
				"spells": []map[string]any{
					{
						"id": "sp_borin_1", "spellId": "curar-ferimentos", "name": "Curar Ferimentos", "path": "Luz", "type": "acao",
						"manaCost": 10, "difficulty": 9, "range": "Toque", "duration": "Instantânea",
						"description": "Restaura 15 + Vontade Pontos de Vida de um aliado tocado.",
						"automation":  map[string]any{"rollAttribute": "vontade", "healFormula": "15 + vontade", "targetType": "ally"},
					},
				},
				"inventory": []map[string]any{
					{
						"id": "inv_borin_hammer", "itemId": "martelo-de-guerra", "name": "Martelo de Guerra", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 4, "damageBonus": 8, "damageAttribute": "forca", "damageType": "Contusão",
						"weight": 4.0, "range": "Corpo a Corpo", "description": "Martelo anão consagrado à Chama Dourada.",
					},
					{
						"id": "inv_borin_shield", "itemId": "escudo-torre", "name": "Escudo de Torre", "category": "shield",
						"equipped": true, "quantity": 1, "fn": 4, "defenseBonus": 3, "agilityPenalty": 0,
						"weight": 6.0, "description": "Grande escudo de aço com brasão solar.",
					},
					{
						"id": "inv_borin_armor", "itemId": "cota-de-malha", "name": "Cota de Malha", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 4, "defenseBonus": 3, "agilityPenalty": 0,
						"weight": 12.0, "description": "Malha de aço forjada nas montanhas.",
					},
				},
				"notes": "Jurado à Ordem da Chama Dourada, protetor incansável dos viajantes de Drakon.",
			},
			Computed: map[string]any{
				"bloqueio":     16, // 5 + 5 FOR + 3 armadura + 3 escudo
				"esquiva":      7,  // 5 + 2 AGI
				"defesa":       16,
				"determinacao": 13, // 8 + max(3 INT, 4 VON) + 1 Aura Divina
				"deslocamento": 6,  // floor(2/2) + 5
				"cargaBasica":  35,
				"cargaPesada":  70,
				"cargaMaxima":  105,
				"fnPenalty":    false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "char_pip",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindPC,
			Name:                "Pip Folha-Ligeira",
			Subtitle:            "Faen Patrulheiro · Nível 1",
			PortraitURL:         "./assets/portraits/faen-ranger.svg",
			OwnerUserID:         nil,
			ControlledByUserIDs: []string{},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 60, Max: 60},
				"pm": {Current: 60, Max: 60},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":    "faen",
				"raceName":  "Faen",
				"classId":   "patrulheiro",
				"className": "Patrulheiro",
				"level":     1,
				"xp":        0,
				"money":     110,
				"size":      "Pequeno",
				"attributes": map[string]any{
					"forca":        2,
					"agilidade":    5,
					"inteligencia": 3,
					"vontade":      4,
				},
				"abilities": []map[string]any{
					{
						"id":          "ab_pip_1",
						"abilityId":   "rastreador",
						"name":        "Rastreador",
						"category":    "suporte",
						"manaCost":    0,
						"description": "Rola +1d6 ao seguir trilhas, identificar criaturas e perceber emboscadas em ambientes naturais.",
						"automation":  map[string]any{"targetType": "self"},
					},
					{
						"id":          "ab_pip_2",
						"abilityId":   "tiro-certeiro",
						"name":        "Tiro Certeiro",
						"category":    "acao",
						"manaCost":    10,
						"description": "Dispara uma flecha mirando um ponto vital, recebendo +2 no ataque e +4 no dano à distância.",
						"automation":  map[string]any{"rollAttribute": "agilidade", "rollBonus": 2, "damageFormula": "weapon + 4", "damageType": "Perfuração", "targetType": "single"},
					},
				},
				"spells": []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_pip_bow", "itemId": "arco-curto", "name": "Arco Curto", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 1, "damageBonus": 6, "damageAttribute": "agilidade", "damageType": "Perfuração",
						"weight": 1.0, "range": "20 metros", "description": "Arco ágil de madeira feérica com aljava de 20 flechas.",
					},
					{
						"id": "inv_pip_dagger", "itemId": "adaga", "name": "Adaga", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 1, "damageBonus": 4, "damageAttribute": "agilidade", "damageType": "Perfuração",
						"weight": 0.5, "range": "Corpo a Corpo", "description": "Adaga leve e bem equilibrada.",
					},
					{
						"id": "inv_pip_armor", "itemId": "couro-batido", "name": "Armadura de Couro Batido", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 1, "defenseBonus": 2, "agilityPenalty": 0,
						"weight": 4.0, "description": "Couro tratado silencioso para patrulhas florestais.",
					},
				},
				"notes": "Batedor ágil das florestas de Drakon que conhece cada trilha oculta ao redor da estalagem.",
			},
			Computed: map[string]any{
				"bloqueio":     10, // base 6 (Pequeno) + 2 FOR + 2 armadura
				"esquiva":      11, // base 6 (Pequeno) + 5 AGI
				"defesa":       11,
				"determinacao": 12, // 8 + max(3 INT, 4 VON)
				"deslocamento": 7,  // floor(5/2) + 5
				"cargaBasica":  14,
				"cargaPesada":  28,
				"cargaMaxima":  42,
				"fnPenalty":    false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "npc_barnabe",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindNPC,
			Name:                "Barnabé, o Taverneiro",
			Subtitle:            "Estalajadeiro do Javali Dourado",
			PortraitURL:         "./assets/portraits/human-warrior.svg",
			OwnerUserID:         strPtr(DemoGMUserID),
			ControlledByUserIDs: []string{DemoGMUserID},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 40, Max: 40},
				"pm": {Current: 20, Max: 20},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":     "humano",
				"raceName":   "Humano",
				"classId":    "npc",
				"className":  "Estalajadeiro",
				"level":      1,
				"xp":         0,
				"money":      200,
				"size":       "Médio",
				"attributes": map[string]any{"forca": 3, "agilidade": 2, "inteligencia": 3, "vontade": 4},
				"abilities":  []map[string]any{},
				"spells":     []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_barnabe_club", "name": "Porrete de Carvalho", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 2, "damageBonus": 4, "damageAttribute": "forca", "damageType": "Contusão",
						"weight": 1.5, "range": "Corpo a Corpo", "description": "Guardado atrás do balcão para clientes encrenqueiros.",
					},
				},
				"notes": "Conhece todos os rumores da estrada norte. Sabe sobre os barulhos estranhos vindos do porão.",
			},
			Computed: map[string]any{
				"bloqueio": 8, "esquiva": 7, "defesa": 8, "determinacao": 12, "deslocamento": 6,
				"cargaBasica": 21, "cargaPesada": 42, "cargaMaxima": 63, "fnPenalty": false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "mob_goblin_raider",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindMonster,
			Name:                "Goblin Saqueador",
			Subtitle:            "Criatura · Nível 1",
			PortraitURL:         "./assets/monsters/goblin-raider.svg",
			OwnerUserID:         strPtr(DemoGMUserID),
			ControlledByUserIDs: []string{DemoGMUserID},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 35, Max: 35},
				"pm": {Current: 20, Max: 20},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":     "goblin",
				"raceName":   "Goblin",
				"classId":    "monstro",
				"className":  "Saqueador",
				"level":      1,
				"xp":         0,
				"money":      15,
				"size":       "Pequeno",
				"attributes": map[string]any{"forca": 2, "agilidade": 4, "inteligencia": 2, "vontade": 2},
				"abilities":  []map[string]any{},
				"spells":     []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_goblin_scimitar", "name": "Cimitarra Enferrujada", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 1, "damageBonus": 5, "damageAttribute": "agilidade", "damageType": "Corte",
						"weight": 1.0, "range": "Corpo a Corpo", "description": "Lâmina curva saqueada de viajantes.",
					},
					{
						"id": "inv_goblin_leather", "name": "Couro Remendado", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 1, "defenseBonus": 1,
						"weight": 2.0,
					},
				},
			},
			Computed: map[string]any{
				"bloqueio": 9, "esquiva": 10, "defesa": 10, "determinacao": 10, "deslocamento": 7,
				"cargaBasica": 14, "cargaPesada": 28, "cargaMaxima": 42, "fnPenalty": false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:                  "mob_skeleton_warrior",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindMonster,
			Name:                "Esqueleto Guerreiro",
			Subtitle:            "Morto-Vivo · Nível 2",
			PortraitURL:         "./assets/monsters/skeleton-warrior.svg",
			OwnerUserID:         strPtr(DemoGMUserID),
			ControlledByUserIDs: []string{DemoGMUserID},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 50, Max: 50},
				"pm": {Current: 0, Max: 0},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":     "morto-vivo",
				"raceName":   "Morto-Vivo",
				"classId":    "monstro",
				"className":  "Guardião Ósseo",
				"level":      2,
				"xp":         0,
				"money":      0,
				"size":       "Médio",
				"attributes": map[string]any{"forca": 4, "agilidade": 3, "inteligencia": 1, "vontade": 3},
				"abilities":  []map[string]any{},
				"spells":     []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_skel_sword", "name": "Espada Antiga", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 3, "damageBonus": 7, "damageAttribute": "forca", "damageType": "Corte",
						"weight": 2.0, "range": "Corpo a Corpo", "description": "Espada corroída pelo tempo, ainda mortal.",
					},
					{
						"id": "inv_skel_shield", "name": "Escudo Partido", "category": "shield",
						"equipped": true, "quantity": 1, "fn": 2, "defenseBonus": 2,
						"weight": 2.5,
					},
					{
						"id": "inv_skel_armor", "name": "Restos de Cota", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 2, "defenseBonus": 1,
						"weight": 5.0,
					},
				},
			},
			Computed: map[string]any{
				"bloqueio": 12, "esquiva": 8, "defesa": 12, "determinacao": 11, "deslocamento": 6,
				"cargaBasica": 28, "cargaPesada": 56, "cargaMaxima": 84, "fnPenalty": false,
			},
			Visibility: model.VisibilityGMOnly,
			UpdatedAt:  now,
		},
		{
			ID:                  "mob_dire_wolf",
			CampaignID:          DemoCampaignID,
			SystemID:            "mighty-blade-3e",
			Kind:                model.CharKindMonster,
			Name:                "Lobo Atroz",
			Subtitle:            "Fera · Nível 2",
			PortraitURL:         "./assets/monsters/dire-wolf.svg",
			OwnerUserID:         strPtr(DemoGMUserID),
			ControlledByUserIDs: []string{DemoGMUserID},
			Resources: map[string]model.ResourceBar{
				"pv": {Current: 55, Max: 55},
				"pm": {Current: 10, Max: 10},
			},
			Conditions: []model.ActiveCondition{},
			SystemData: map[string]any{
				"raceId":     "fera",
				"raceName":   "Fera",
				"classId":    "monstro",
				"className":  "Predador",
				"level":      2,
				"xp":         0,
				"money":      0,
				"size":       "Grande",
				"attributes": map[string]any{"forca": 4, "agilidade": 4, "inteligencia": 2, "vontade": 3},
				"abilities":  []map[string]any{},
				"spells":     []map[string]any{},
				"inventory": []map[string]any{
					{
						"id": "inv_wolf_bite", "name": "Mordida Dilacerante", "category": "weapon",
						"equipped": true, "quantity": 1, "fn": 1, "damageBonus": 6, "damageAttribute": "forca", "damageType": "Perfuração",
						"weight": 0, "range": "Corpo a Corpo", "description": "Presas poderosas capazes de derrubar a presa.",
					},
					{
						"id": "inv_wolf_hide", "name": "Couro Espesso", "category": "armor",
						"equipped": true, "quantity": 1, "fn": 1, "defenseBonus": 1,
						"weight": 0,
					},
				},
			},
			Computed: map[string]any{
				"bloqueio": 10, "esquiva": 9, "defesa": 10, "determinacao": 11, "deslocamento": 7,
				"cargaBasica": 28, "cargaPesada": 56, "cargaMaxima": 84, "fnPenalty": false,
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
	}
	for _, c := range characters {
		if err := st.UpsertCharacter(ctx, c); err != nil {
			return err
		}
	}

	// Build initial revealed fog string for Cripta (24x18 = 432 cells; reveal entrance cells around rows 14..17, cols 9..14)
	cryptFog := buildFogGrid(24, 18, func(x, y int) bool {
		return x >= 9 && x <= 14 && y >= 13 && y <= 17
	})
	allRevealed := strings.Repeat("1", 24*18)

	scenes := []model.Scene{
		{
			ID:         DemoSceneTavern,
			CampaignID: DemoCampaignID,
			Name:       "Estalagem do Javali Dourado",
			ImageURL:   "./assets/maps/tavern.svg",
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
					ID: "tok_aldric", CharacterID: strPtr("char_aldric"), Name: "Aldric",
					ImageURL: "./assets/portraits/human-warrior.svg", X: 9, Y: 10, Size: 1,
					Color: "#d4a84f", Layer: "tokens", ShowBars: true,
					HP: intPtr(60), HPMax: intPtr(60), MP: intPtr(60), MPMax: intPtr(60),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_lyra", CharacterID: strPtr("char_lyra"), Name: "Lyra",
					ImageURL: "./assets/portraits/elf-mage.svg", X: 11, Y: 10, Size: 1,
					Color: "#3b82f6", Layer: "tokens", ShowBars: true,
					HP: intPtr(60), HPMax: intPtr(60), MP: intPtr(60), MPMax: intPtr(60),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_borin", CharacterID: strPtr("char_borin"), Name: "Borin",
					ImageURL: "./assets/portraits/dwarf-paladin.svg", X: 10, Y: 11, Size: 1,
					Color: "#eab308", Layer: "tokens", ShowBars: true,
					HP: intPtr(60), HPMax: intPtr(60), MP: intPtr(60), MPMax: intPtr(60),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_pip", CharacterID: strPtr("char_pip"), Name: "Pip",
					ImageURL: "./assets/portraits/faen-ranger.svg", X: 12, Y: 11, Size: 1,
					Color: "#22c55e", Layer: "tokens", ShowBars: true,
					HP: intPtr(60), HPMax: intPtr(60), MP: intPtr(60), MPMax: intPtr(60),
					Conditions: []string{}, ControlledByUserIDs: []string{},
				},
				{
					ID: "tok_barnabe", CharacterID: strPtr("npc_barnabe"), Name: "Barnabé",
					ImageURL: "./assets/portraits/human-warrior.svg", X: 6, Y: 5, Size: 1,
					Color: "#a855f7", Layer: "tokens", ShowBars: false,
					HP: intPtr(40), HPMax: intPtr(40),
					Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
				{
					// GM-only hidden ambush token — MUST be stripped on wire for non-GM players!
					ID: "tok_goblin_ambush_gm", CharacterID: strPtr("mob_goblin_raider"), Name: "Goblin Espião (Oculto)",
					ImageURL: "./assets/monsters/goblin-raider.svg", X: 20, Y: 3, Size: 1,
					Color: "#ef4444", Layer: "gm", ShowBars: true,
					HP: intPtr(35), HPMax: intPtr(35), MP: intPtr(20), MPMax: intPtr(20),
					Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:         DemoSceneCrypt,
			CampaignID: DemoCampaignID,
			Name:       "Cripta dos Antigos",
			ImageURL:   "./assets/maps/dungeon-crypt.svg",
			Width:      1600,
			Height:     1200,
			Grid: model.SceneGrid{
				Enabled: true, Cols: 24, Rows: 18, CellMeters: 1.5, Color: "rgba(255,255,255,0.16)", Snap: true,
			},
			Fog: model.SceneFog{
				Enabled:       true,
				RevealedCells: cryptFog,
			},
			Tokens: []model.Token{
				{
					ID: "tok_crypt_skel_1", CharacterID: strPtr("mob_skeleton_warrior"), Name: "Esqueleto Sentinela",
					ImageURL: "./assets/monsters/skeleton-warrior.svg", X: 11, Y: 8, Size: 1,
					Color: "#ef4444", Layer: "tokens", ShowBars: true,
					HP: intPtr(50), HPMax: intPtr(50), Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
				{
					ID: "tok_crypt_skel_gm", CharacterID: strPtr("mob_skeleton_warrior"), Name: "Esqueleto da Emboscada (GM)",
					ImageURL: "./assets/monsters/skeleton-warrior.svg", X: 16, Y: 6, Size: 1,
					Color: "#ef4444", Layer: "gm", ShowBars: true,
					HP: intPtr(50), HPMax: intPtr(50), Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:         DemoSceneForest,
			CampaignID: DemoCampaignID,
			Name:       "Estrada da Floresta Sombria",
			ImageURL:   "./assets/maps/forest-road.svg",
			Width:      1600,
			Height:     1200,
			Grid: model.SceneGrid{
				Enabled: true, Cols: 24, Rows: 18, CellMeters: 1.5, Color: "rgba(255,255,255,0.16)", Snap: true,
			},
			Fog: model.SceneFog{
				Enabled:       false,
				RevealedCells: allRevealed,
			},
			Tokens: []model.Token{
				{
					ID: "tok_forest_wolf", CharacterID: strPtr("mob_dire_wolf"), Name: "Lobo Atroz",
					ImageURL: "./assets/monsters/dire-wolf.svg", X: 15, Y: 7, Size: 1,
					Color: "#ef4444", Layer: "tokens", ShowBars: true,
					HP: intPtr(55), HPMax: intPtr(55), Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
				{
					ID: "tok_forest_goblin", CharacterID: strPtr("mob_goblin_raider"), Name: "Goblin Saqueador",
					ImageURL: "./assets/monsters/goblin-raider.svg", X: 17, Y: 10, Size: 1,
					Color: "#ef4444", Layer: "tokens", ShowBars: true,
					HP: intPtr(35), HPMax: intPtr(35), Conditions: []string{}, ControlledByUserIDs: []string{DemoGMUserID},
				},
			},
			Visibility: model.VisibilityAllPlayers,
			UpdatedAt:  now,
		},
		{
			ID:         DemoSceneCastle,
			CampaignID: DemoCampaignID,
			Name:       "Pátio do Castelo de Drakon",
			ImageURL:   "./assets/maps/castle-courtyard.svg",
			Width:      1600,
			Height:     1200,
			Grid: model.SceneGrid{
				Enabled: true, Cols: 24, Rows: 18, CellMeters: 1.5, Color: "rgba(255,255,255,0.16)", Snap: true,
			},
			Fog: model.SceneFog{
				Enabled:       false,
				RevealedCells: allRevealed,
			},
			Tokens:     []model.Token{},
			Visibility: model.VisibilityGMOnly,
			UpdatedAt:  now,
		},
	}
	for _, sc := range scenes {
		if err := st.UpsertScene(ctx, sc); err != nil {
			return err
		}
	}

	// Hierarchical Folders demonstrating all 3 visibility tiers
	folders := []model.Folder{
		{
			ID:         "folder_gm_secrets",
			CampaignID: DemoCampaignID,
			ParentID:   nil,
			Name:       "Segredos do Mestre",
			Icon:       "lock",
			SortOrder:  1,
			Visibility: model.VisibilityGMOnly,
			CreatedBy:  DemoGMUserID,
		},
		{
			ID:         "folder_journal",
			CampaignID: DemoCampaignID,
			ParentID:   nil,
			Name:       "Diário da Campanha",
			Icon:       "book-open",
			SortOrder:  2,
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  DemoGMUserID,
		},
		{
			ID:         "folder_maps_lore",
			CampaignID: DemoCampaignID,
			ParentID:   nil,
			Name:       "Mapas & Locais",
			Icon:       "map",
			SortOrder:  3,
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  DemoGMUserID,
		},
		{
			ID:               "folder_private_notes",
			CampaignID:       DemoCampaignID,
			ParentID:         nil,
			Name:             "Bilhetes Privados",
			Icon:             "mail",
			SortOrder:        4,
			Visibility:       model.VisibilitySpecificPlayers,
			VisibleToUserIDs: []string{DemoGMUserID},
			CreatedBy:        DemoGMUserID,
		},
	}
	for _, f := range folders {
		if err := st.UpsertFolder(ctx, f); err != nil {
			return err
		}
	}

	docs := []model.Document{
		{
			ID:         "doc_cult_conspiracy",
			CampaignID: DemoCampaignID,
			FolderID:   strPtr("folder_gm_secrets"),
			Kind:       model.DocKindLore,
			Title:      "A Conspiração do Culto Carmesim",
			Content:    "## Notas Secretas do Mestre\n\nO Culto Carmesim subornou um ajudante da cozinha do **Javali Dourado** para abrir a passagem secreta sob a adega.\n\n- **Goblin Espião** está escondido na camada GM no canto superior direito do salão.\n- **Objetivo do Culto:** despertar o Guardião Ósseo na *Cripta dos Antigos* antes da lua nova.",
			Tags:       []string{"gm", "trama", "culto"},
			Visibility: model.VisibilityGMOnly,
			CreatedBy:  DemoGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_crypt_traps",
			CampaignID: DemoCampaignID,
			FolderID:   strPtr("folder_gm_secrets"),
			Kind:       model.DocKindNote,
			Title:      "Armadilhas da Cripta (CD 12)",
			Content:    "### Lajes de Pressão da Câmara Central\n- **Percepção:** Inteligência CD 12 (Elfos rolam 3d6 pela habilidade *Sentidos Apurados*).\n- **Efeito:** Dardos envenenados causam **10 de dano** e aplicam *Envenenado* (Vontade CD 11 anula).",
			Tags:       []string{"armadilha", "cripta"},
			Visibility: model.VisibilityGMOnly,
			CreatedBy:  DemoGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_tavern_board",
			CampaignID: DemoCampaignID,
			FolderID:   strPtr("folder_journal"),
			Kind:       model.DocKindHandout,
			Title:      "Quadro de Avisos do Javali Dourado",
			Content:    "# Quadro de Avisos — Drakon\n\n1. **Recompensa (250 MO):** Caravanas vêm sendo atacadas na *Estrada da Floresta Sombria* por goblins e lobos atrozes.\n2. **Procura-se:** Qualquer pista sobre os ruídos estranhos vindos das antigas catacumbas ao sul da vila.\n3. **Estadia:** Caneca de Hidromel Anão por apenas 2 moedas de prata — procure Barnabé no balcão!",
			ImageURL:   "./assets/maps/tavern.svg",
			Tags:       []string{"missao", "estalagem"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  DemoGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_mb3e_quickstart",
			CampaignID: DemoCampaignID,
			FolderID:   strPtr("folder_journal"),
			Kind:       model.DocKindLore,
			Title:      "Guia Rápido: Mighty Blade 3ª Edição",
			Content:    "## Regras Essenciais de Mighty Blade 3ª Ed.\n\n- **Testes:** Role **2d6 + Atributo** (Força, Agilidade, Inteligência ou Vontade) e compare com a Dificuldade (Fácil 7, Comum 9, Difícil 12, Muito Difícil 15).\n- **Crítico Automático:** Dois **6** nos dados (`6+6`)! Sucesso extraordinário e dano ampliado.\n- **Falha Crítica:** Dois **1** nos dados (`1+1`)! Algo dá terrivelmente errado.\n- **Defesa:** Use o maior valor entre **Bloqueio** (`5 + FOR + Armadura + Escudo`) e **Esquiva** (`5 + AGI`).",
			Tags:       []string{"regras", "mighty-blade"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  DemoGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:         "doc_drakon_locations",
			CampaignID: DemoCampaignID,
			FolderID:   strPtr("folder_maps_lore"),
			Kind:       model.DocKindLore,
			Title:      "Região do Javali Dourado & Arredores",
			Content:    "### Pontos de Interesse\n- **Estalagem do Javali Dourado:** Ponto seguro de encontro de aventureiros na bifurcação norte.\n- **Estrada da Floresta Sombria:** Trilha densa cercada por pinheiros antigos — reduto de salteadores.\n- **Cripta dos Antigos:** Ruínas esquecidas sob as colinas de pedra.",
			Tags:       []string{"drakon", "locais"},
			Visibility: model.VisibilityAllPlayers,
			CreatedBy:  DemoGMUserID,
			UpdatedAt:  now,
		},
		{
			ID:               "doc_mages_guild_seal",
			CampaignID:       DemoCampaignID,
			FolderID:         strPtr("folder_private_notes"),
			Kind:             model.DocKindHandout,
			Title:            "Selo da Guilda dos Magos",
			Content:          "*Mensagem selada destinada apenas aos iniciados da Torre de Cristal:*\n\nO cristal de contenção sob a Cripta está rachando. Não permita que o selo caia em mãos erradas.",
			Tags:             []string{"secreto", "guilda"},
			Visibility:       model.VisibilitySpecificPlayers,
			VisibleToUserIDs: []string{DemoGMUserID},
			CreatedBy:        DemoGMUserID,
			UpdatedAt:        now,
		},
	}
	for _, d := range docs {
		if err := st.UpsertDocument(ctx, d); err != nil {
			return err
		}
	}

	macros := []model.Macro{
		{
			ID: "macro_ataque_basico", CampaignID: DemoCampaignID, Name: "Ataque Básico",
			Icon: "swords", Color: "#ef4444", Scope: "campaign",
			Script:     `roll("2d6 + @forca", "Ataque Básico")`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
		{
			ID: "macro_teste_forca", CampaignID: DemoCampaignID, Name: "Teste de Força",
			Icon: "shield", Color: "#f59e0b", Scope: "campaign",
			Script:     `roll("2d6 + @forca", "Teste de Força", { difficulty: 9 })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
		{
			ID: "macro_teste_agilidade", CampaignID: DemoCampaignID, Name: "Teste de Agilidade",
			Icon: "wind", Color: "#22c55e", Scope: "campaign",
			Script:     `roll("2d6 + @agilidade", "Teste de Agilidade", { difficulty: 9 })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
		{
			ID: "macro_teste_inteligencia", CampaignID: DemoCampaignID, Name: "Teste de Inteligência",
			Icon: "eye", Color: "#3b82f6", Scope: "campaign",
			Script:     `roll("2d6 + @inteligencia", "Teste de Inteligência", { difficulty: 9 })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
		{
			ID: "macro_teste_vontade", CampaignID: DemoCampaignID, Name: "Teste de Vontade",
			Icon: "sparkles", Color: "#a855f7", Scope: "campaign",
			Script:     `roll("2d6 + @vontade", "Teste de Vontade", { difficulty: 9 })`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
		{
			ID: "macro_iniciativa", CampaignID: DemoCampaignID, Name: "Iniciativa (2d6+AGI)",
			Icon: "zap", Color: "#d4a84f", Scope: "campaign",
			Script:     `roll("2d6 + @agilidade", "Iniciativa")`,
			Visibility: model.VisibilityAllPlayers, CreatedBy: DemoGMUserID,
		},
	}
	for _, mc := range macros {
		if err := st.UpsertMacro(ctx, mc); err != nil {
			return err
		}
	}

	// Opening atmospheric narration + sample roll card
	diff9 := 9
	margin3 := 3
	welcomeMsgs := []model.ChatMessage{
		{
			ID:           "msg_seed_narration",
			CampaignID:   DemoCampaignID,
			Kind:         model.ChatKindNarration,
			SenderUserID: DemoGMUserID,
			SenderName:   "Mestre de Drakon",
			Content:      "A chuva tamborila nas janelas da **Estalagem do Javali Dourado** enquanto o fogo da lareira aquece os viajantes. Barnabé limpa uma caneca atrás do balcão e lança um olhar preocupado para a porta do porão. O que vocês fazem?",
			Visibility:   model.VisibilityAllPlayers,
			CreatedAt:    now.Add(-2 * time.Minute),
		},
		{
			ID:            "msg_seed_roll",
			CampaignID:    DemoCampaignID,
			Kind:          model.ChatKindRoll,
			SenderUserID:  DemoGMUserID,
			SenderName:    "Mestre de Drakon",
			CharacterID:   "char_aldric",
			CharacterName: "Aldric de Valmont",
			PortraitURL:   "./assets/portraits/human-warrior.svg",
			Content:       "Aldric observa os arredores da estalagem com atenção.",
			Roll: &model.RollResult{
				RollID:   "roll_seed_01",
				Formula:  "2d6 + 3",
				Label:    "Teste de Percepção (INT)",
				Dice:     []model.RolledDie{{Sides: 6, Value: 5}, {Sides: 6, Value: 4}},
				Modifier: 3,
				Total:    12,
				Seed:     424242,
				Outcome: &model.RollOutcome{
					Kind:       "success",
					BadgeText:  "SUCESSO (vs CD 9)",
					Difficulty: &diff9,
					Margin:     &margin3,
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

func buildFogGrid(cols, rows int, revealed func(x, y int) bool) string {
	var b strings.Builder
	b.Grow(cols * rows)
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			if revealed(x, y) {
				b.WriteByte('1')
			} else {
				b.WriteByte('0')
			}
		}
	}
	return b.String()
}
