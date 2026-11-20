package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/api"
	"github.com/chadvictor/mesa-vtt/server/internal/auth"
	"github.com/chadvictor/mesa-vtt/server/internal/config"
	"github.com/chadvictor/mesa-vtt/server/internal/dice"
	"github.com/chadvictor/mesa-vtt/server/internal/hub"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/seed"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

func TestTagmarCompendiumAndConfigEndpoints(t *testing.T) {
	env := newTestEnv(t, "local", "", "", nil)

	// /api/v1/config lists tagmar-3 alongside mighty-blade-3e and generic-rpg
	resp, raw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/config", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/api/v1/config status=%d", resp.StatusCode)
	}
	if !strings.Contains(string(raw), `"tagmar-3"`) || !strings.Contains(string(raw), `"mighty-blade-3e"`) {
		t.Fatalf("/api/v1/config missing expected systems: %s", string(raw))
	}

	// Full compendium endpoint: /api/v1/compendium/tagmar-3 and /api/v1/compendium/tagmar alias
	categories := []string{"rules", "races", "professions", "conditions", "skills", "spells", "equipment", "bestiary"}
	for _, sysPath := range []string{"tagmar-3", "tagmar"} {
		resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/"+sysPath, "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /compendium/%s status=%d body=%s", sysPath, resp.StatusCode, string(raw))
		}
		var all map[string]json.RawMessage
		if err := json.Unmarshal(raw, &all); err != nil {
			t.Fatalf("unmarshal /compendium/%s: %v", sysPath, err)
		}
		for _, cat := range categories {
			if len(all[cat]) == 0 {
				t.Fatalf("/compendium/%s missing category %q", sysPath, cat)
			}
		}
	}

	// Individual categories
	for _, cat := range categories {
		resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/tagmar-3/"+cat, "", nil)
		if resp.StatusCode != http.StatusOK || len(raw) < 32 {
			t.Fatalf("GET /compendium/tagmar-3/%s failed: status=%d len=%d", cat, resp.StatusCode, len(raw))
		}
	}

	// Spot-check key Tagmar compendium content
	resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/tagmar-3/races", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"elfo-dourado"`) || !strings.Contains(string(raw), `"pequenino"`) {
		t.Fatalf("tagmar races unexpected content")
	}
	resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/tagmar-3/professions", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"ordem-parom"`) || !strings.Contains(string(raw), `"colegio-elemental"`) {
		t.Fatalf("tagmar professions unexpected content")
	}

	// Unknown category -> 404
	resp, _ = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/tagmar-3/invalidcat", "", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown Tagmar category, got %d", resp.StatusCode)
	}

	// Verify disk DATA_DIR precedence + embed.FS fallback
	dataDir := t.TempDir()
	tagmarDir := filepath.Join(dataDir, "tagmar")
	if err := os.MkdirAll(tagmarDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	customRules := `{"systemId":"tagmar-3","override":"from-disk"}`
	if err := os.WriteFile(filepath.Join(tagmarDir, "rules.json"), []byte(customRules), 0o644); err != nil {
		t.Fatalf("write override: %v", err)
	}
	dbPath := filepath.Join(t.TempDir(), "disk-override.json")
	st, err := store.NewFileStore(dbPath)
	if err != nil {
		t.Fatalf("NewFileStore: %v", err)
	}
	cfg := config.Config{
		ListenAddress:  ":0",
		DataFile:       dbPath,
		DataDir:        dataDir,
		AuthMode:       config.AuthModeLocal,
		SessionSecret:  "test-secret-key-32-bytes-minimum-ok!",
		OriginPatterns: []string{"*"},
	}
	h := hub.New(st)
	srv := api.NewServer(cfg, st, auth.NewService(cfg.SessionSecret, true, "", ""), h)
	ts, client := newInMemoryServer(t, srv.Handler)
	t.Cleanup(func() {
		h.Close()
		_ = st.Close()
	})

	resp, raw = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/compendium/tagmar-3/rules", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"from-disk"`) {
		t.Fatalf("expected disk DATA_DIR override for tagmar/rules.json, got %d %s", resp.StatusCode, string(raw))
	}
	// races.json is NOT on disk -> must seamlessly fall back to embedded TagmarFS!
	resp, raw = doJSON(t, client, http.MethodGet, ts.URL+"/api/v1/compendium/tagmar-3/races", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"elfo-dourado"`) {
		t.Fatalf("expected embed.FS fallback for tagmar/races.json, got %d", resp.StatusCode)
	}
}

func TestTagmarSeededCampaignVisibilitySecurityAndCreation(t *testing.T) {
	env := newTestEnv(t, "local", "", "", nil)

	gmTok, _ := loginLocal(t, env, "Mestre Verrogar")
	p1Tok, _ := loginLocal(t, env, "Jogador Tagmar")

	// Both DRAKON and TAGMAR demo campaigns must appear in lobby listing
	resp, raw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/campaigns", gmTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list campaigns status=%d", resp.StatusCode)
	}
	if !strings.Contains(string(raw), `"DRAKON"`) || !strings.Contains(string(raw), `"TAGMAR"`) {
		t.Fatalf("expected both DRAKON and TAGMAR campaigns in lobby, got %s", string(raw))
	}

	// Join TAGMAR as GM and as Player
	camp, gmMember := joinByCode(t, env, gmTok, "TAGMAR", model.RoleGM)
	if camp.SystemID != "tagmar-3" || gmMember.Role != model.RoleGM {
		t.Fatalf("unexpected TAGMAR campaign/member: camp=%+v member=%+v", camp, gmMember)
	}
	_, p1Member := joinByCode(t, env, p1Tok, "TAGMAR", model.RolePlayer)
	if p1Member.Role != model.RolePlayer {
		t.Fatalf("expected player role, got %s", p1Member.Role)
	}

	// REST state check: GM vs Player visibility security
	resp, gmRaw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/campaigns/"+camp.ID+"/state", gmTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GM state status=%d", resp.StatusCode)
	}
	var gmState model.CampaignState
	_ = json.Unmarshal(gmRaw, &gmState)

	// Verify all 4 Tagmar heroes, NPC, monsters, scenes, folders, macros, voice channels exist for GM
	for _, want := range []string{
		"Kael de Verrogar",
		"Aelindra",
		"Thorgar",
		"Liriel",
		"Capitão Brenno",
		"Orc Saqueador",
		"Lobo das Neves",
		"Pátio da Fortaleza de Verrogar",
		"Estrada da Floresta Sombria",
		"Segredos do Mestre — Verrogar",
		"Crônicas dos Reinos",
		"Tabela de Resolução Rápida",
		"tok_tagmar_orc_ambush_gm",
		"tok_tagmar_wolf_ambush_gm",
	} {
		if !strings.Contains(string(gmRaw), want) {
			t.Fatalf("TAGMAR GM state missing expected item %q", want)
		}
	}
	if len(gmState.VoiceChannels) != 2 || len(gmState.Macros) < 4 {
		t.Fatalf("unexpected voice channels (%d) or macros (%d)", len(gmState.VoiceChannels), len(gmState.Macros))
	}

	// Player REST state MUST NEVER contain GM secrets or GM-layer ambush tokens!
	resp, p1Raw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/campaigns/"+camp.ID+"/state", p1Tok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("P1 state status=%d", resp.StatusCode)
	}
	for _, secret := range []string{
		"Segredos do Mestre — Verrogar",
		"Emboscada Orc na Estrada Norte",
		"tok_tagmar_orc_ambush_gm",
		"tok_tagmar_wolf_ambush_gm",
		"mob_tagmar_snow_wolf",
		"Lobo das Neves",
	} {
		if strings.Contains(string(p1Raw), secret) {
			t.Fatalf("WIRE SECURITY LEAK in TAGMAR REST state: player saw %q", secret)
		}
	}

	// Player WS welcome MUST also strip GM secrets
	p1WS := dialWS(t, env, p1Tok, camp.ID)
	p1Welcome := readUntilType(t, p1WS, "welcome", 3*time.Second)
	for _, secret := range []string{"Segredos do Mestre — Verrogar", "tok_tagmar_orc_ambush_gm", "mob_tagmar_snow_wolf"} {
		if strings.Contains(string(p1Welcome.Payload), secret) {
			t.Fatalf("WIRE SECURITY LEAK in TAGMAR WS welcome: player saw %q", secret)
		}
	}

	// Creating a custom tagmar-3 campaign and a default Tagmar character initializes eh/ef/karma
	resp, raw = doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/campaigns", gmTok, map[string]any{
		"name":       "Terras Selvagens",
		"systemId":   "tagmar-3",
		"privacy":    "public",
		"inviteCode": "SELV01",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create tagmar-3 campaign failed: %d %s", resp.StatusCode, string(raw))
	}
	var createdCamp struct {
		Campaign model.Campaign `json:"campaign"`
	}
	_ = json.Unmarshal(raw, &createdCamp)
	if createdCamp.Campaign.SystemID != "tagmar-3" {
		t.Fatalf("expected systemId=tagmar-3, got %s", createdCamp.Campaign.SystemID)
	}

	resp, raw = doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/campaigns/"+createdCamp.Campaign.ID+"/characters", gmTok, map[string]any{
		"name": "Bardo de Filanti",
		"kind": "pc",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create Tagmar char failed: %d %s", resp.StatusCode, string(raw))
	}
	var createdChar struct {
		Character model.Character `json:"character"`
	}
	_ = json.Unmarshal(raw, &createdChar)
	if _, hasEH := createdChar.Character.Resources["eh"]; !hasEH {
		t.Fatalf("expected default Tagmar character to have 'eh' resource, got %+v", createdChar.Character.Resources)
	}
	if _, hasEF := createdChar.Character.Resources["ef"]; !hasEF {
		t.Fatalf("expected default Tagmar character to have 'ef' resource, got %+v", createdChar.Character.Resources)
	}
	if _, hasKarma := createdChar.Character.Resources["karma"]; !hasKarma {
		t.Fatalf("expected default Tagmar character to have 'karma' resource, got %+v", createdChar.Character.Resources)
	}
}

func TestTagmarWSRollsAndEhToEfDamageFlow(t *testing.T) {
	env := newTestEnv(t, "local", "", "", nil)

	gmTok, _ := loginLocal(t, env, "Mestre Tagmar")
	p1Tok, _ := loginLocal(t, env, "Jogador Kael")

	camp, _ := joinByCode(t, env, gmTok, "TAGMAR", model.RoleGM)
	joinByCode(t, env, p1Tok, "TAGMAR", model.RolePlayer)

	gmWS := dialWS(t, env, gmTok, camp.ID)
	p1WS := dialWS(t, env, p1Tok, camp.ID)
	readUntilType(t, gmWS, "welcome", 3*time.Second)
	readUntilType(t, p1WS, "welcome", 3*time.Second)

	// 1. Authoritative Tagmar 1d20 Resolution Table roll over WS (Col 8)
	gmWS.send(t, hub.OutEnvelope{
		Type: "dice.roll",
		Payload: map[string]any{
			"formula":      "1d20",
			"label":        "Ataque de Espada Longa",
			"characterId":  "char_kael",
			"tagmarColumn": 8,
		},
	})
	diceEv := readUntilType(t, p1WS, "dice.result", 3*time.Second)
	var dicePayload struct {
		Roll model.RollResult `json:"roll"`
	}
	if err := json.Unmarshal(diceEv.Payload, &dicePayload); err != nil {
		t.Fatalf("unmarshal dice.result: %v", err)
	}
	r := dicePayload.Roll
	if r.TagmarColumn == nil || *r.TagmarColumn != 8 || len(r.Dice) != 1 || r.Dice[0].Sides != 20 {
		t.Fatalf("unexpected Tagmar roll result: %+v", r)
	}
	expectedRes, err := dice.ResolveTagmarColumn(r.Dice[0].Value, 8)
	if err != nil {
		t.Fatalf("ResolveTagmarColumn: %v", err)
	}
	if r.TagmarColor != expectedRes.Color || r.TagmarDamageTier != expectedRes.DamageTier || r.TagmarDirectToEf != expectedRes.DirectToEf {
		t.Fatalf("WS server Tagmar resolution mismatch for d20=%d col=8: got (%s, tier=%d, direct=%v), want (%s, tier=%d, direct=%v)",
			r.Dice[0].Value, r.TagmarColor, r.TagmarDamageTier, r.TagmarDirectToEf,
			expectedRes.Color, expectedRes.DamageTier, expectedRes.DirectToEf)
	}

	// 2. Authoritative Tagmar Resistance Table roll (RM: FA 6 vs FD 6 -> target 11)
	gmWS.send(t, hub.OutEnvelope{
		Type: "dice.roll",
		Payload: map[string]any{
			"formula":     "1d20",
			"label":       "Resistência à Magia",
			"characterId": "char_aelindra",
			"tagmarResistance": map[string]any{
				"kind": "rm",
				"fa":   6,
				"fd":   6,
			},
		},
	})
	rmEv := readUntilType(t, p1WS, "dice.result", 3*time.Second)
	var rmPayload struct {
		Roll model.RollResult `json:"roll"`
	}
	_ = json.Unmarshal(rmEv.Payload, &rmPayload)
	if rmPayload.Roll.TagmarResistance == nil || rmPayload.Roll.TagmarResistance.Target != 11 || rmPayload.Roll.TagmarResistance.Kind != "rm" {
		t.Fatalf("unexpected RM resistance roll: %+v", rmPayload.Roll)
	}
	expectedRM, _ := dice.ResolveTagmarResistance(rmPayload.Roll.Dice[0].Value, model.TagmarResistanceRequest{Kind: "rm", FA: 6, FD: 6})
	if rmPayload.Roll.TagmarResistance.Resisted != expectedRM.Resisted {
		t.Fatalf("RM resisted mismatch for d20=%d: got %v want %v", rmPayload.Roll.Dice[0].Value, rmPayload.Roll.TagmarResistance.Resisted, expectedRM.Resisted)
	}

	// 3. Tagmar EH -> Absorção -> EF damage overflow + Critical Direct-to-EF + Healing + Karma spend via chat.action!
	// Emit a roll message with interactive actions targeting Kael (EH 20/20, EF 20/20, Temp/Absorção 18) & Aelindra (Karma 10/10)
	gmWS.send(t, hub.OutEnvelope{
		Type: "dice.roll",
		Payload: map[string]any{
			"formula":      "1d20",
			"label":        "Teste Combate Tagmar",
			"characterId":  "char_kael",
			"tagmarColumn": 10,
			"actions": []map[string]any{
				{
					"id": "act_dmg_eh", "label": "Dano 12 (EH)", "style": "damage", "actionType": "apply_damage",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 12},
				},
				{
					"id": "act_dmg_abs", "label": "Dano 20 (EH->Abs)", "style": "damage", "actionType": "apply_damage",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 20},
				},
				{
					"id": "act_dmg_ef", "label": "Dano 14 (Abs->EF)", "style": "damage", "actionType": "apply_damage",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 14},
				},
				{
					"id": "act_dmg_crit", "label": "Crítico 15 Direto na EF", "style": "damage", "actionType": "apply_damage",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 15, "directToEf": true},
				},
				{
					"id": "act_heal_1", "label": "Curar 10", "style": "heal", "actionType": "apply_heal",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 10},
				},
				{
					"id": "act_heal_2", "label": "Curar 20", "style": "heal", "actionType": "apply_heal",
					"targetCharacterId": "char_kael", "payload": map[string]any{"amount": 20},
				},
				{
					"id": "act_karma_ok", "label": "Gastar 4 Karma", "style": "mana", "actionType": "spend_resource",
					"targetCharacterId": "char_aelindra", "payload": map[string]any{"resource": "karma", "amount": 4},
				},
				{
					"id": "act_karma_fail", "label": "Gastar 9 Karma", "style": "mana", "actionType": "spend_mana",
					"targetCharacterId": "char_aelindra", "payload": map[string]any{"resource": "karma", "amount": 9},
				},
			},
		},
	})

	rollMsgEv := readUntilMatch(t, gmWS, "chat.message", func(e hub.WsEnvelope) bool {
		return strings.Contains(string(e.Payload), "act_dmg_eh")
	}, 3*time.Second)
	var rollMsgPayload struct {
		Message model.ChatMessage `json:"message"`
	}
	_ = json.Unmarshal(rollMsgEv.Payload, &rollMsgPayload)
	msgID := rollMsgPayload.Message.ID

	execAction := func(actionID string) model.Character {
		t.Helper()
		gmWS.send(t, hub.OutEnvelope{
			Type:    "chat.action",
			Payload: map[string]any{"messageId": msgID, "actionId": actionID},
		})
		ev := readUntilType(t, gmWS, "character.updated", 3*time.Second)
		var out struct {
			Character model.Character `json:"character"`
		}
		_ = json.Unmarshal(ev.Payload, &out)
		return out.Character
	}

	// Step A: 12 normal damage -> EH 20 -> 8, EF stays 20, Absorção stays 18
	kael := execAction("act_dmg_eh")
	if kael.Resources["eh"].Current != 8 || kael.Resources["ef"].Current != 20 || kael.Resources["ef"].Temp != 18 {
		t.Fatalf("Step A (EH only) mismatch: %+v", kael.Resources)
	}

	// Step B: 20 normal damage -> -8 EH (EH=0), 12 absorbed by armor (Abs 18->6), EF stays 20
	kael = execAction("act_dmg_abs")
	if kael.Resources["eh"].Current != 0 || kael.Resources["ef"].Current != 20 || kael.Resources["ef"].Temp != 6 {
		t.Fatalf("Step B (EH->Absorção) mismatch: %+v", kael.Resources)
	}

	// Step C: 14 normal damage -> 0 EH, 6 absorbed by remaining armor (Abs 6->0), 8 overflows to EF (20->12)
	kael = execAction("act_dmg_ef")
	if kael.Resources["eh"].Current != 0 || kael.Resources["ef"].Current != 12 || kael.Resources["ef"].Temp != 0 {
		t.Fatalf("Step C (Absorção->EF overflow) mismatch: %+v", kael.Resources)
	}

	// Step D: 15 Critical Direct-to-EF -> EF 12 -> -3 (Inconsciente + Agonizando!)
	kael = execAction("act_dmg_crit")
	if kael.Resources["ef"].Current != -3 {
		t.Fatalf("Step D (Critical directToEf) expected EF=-3, got %+v", kael.Resources)
	}
	hasUnconscious, hasDying := false, false
	for _, cond := range kael.Conditions {
		if cond.ID == "inconsciente" {
			hasUnconscious = true
		}
		if cond.ID == "agonizando" {
			hasDying = true
		}
	}
	if !hasUnconscious || !hasDying {
		t.Fatalf("expected inconsciente & agonizando at EF=-3, got %+v", kael.Conditions)
	}

	// Step E: Heal 10 -> EF -3 -> 7, clears inconsciente & agonizando!
	kael = execAction("act_heal_1")
	if kael.Resources["ef"].Current != 7 || kael.Resources["eh"].Current != 0 || len(kael.Conditions) != 0 {
		t.Fatalf("Step E (stabilize EF heal) mismatch: res=%+v conds=%+v", kael.Resources, kael.Conditions)
	}

	// Step F: Heal 20 -> EF 7 -> 20 (+13), overflow +7 to EH (0 -> 7)!
	kael = execAction("act_heal_2")
	if kael.Resources["ef"].Current != 20 || kael.Resources["eh"].Current != 7 {
		t.Fatalf("Step F (EF->EH overflow heal) mismatch: %+v", kael.Resources)
	}

	// Verify linked token on Verrogar fortress scene synced HP=EH(7) and MP=EF(20)
	sc, err := env.store.GetScene(context.Background(), camp.ID, seed.TagmarSceneFortress)
	if err != nil {
		t.Fatalf("GetScene: %v", err)
	}
	for _, tok := range sc.Tokens {
		if tok.ID == "tok_tagmar_kael" {
			if tok.HP == nil || *tok.HP != 7 || tok.MP == nil || *tok.MP != 20 {
				t.Fatalf("expected linked Kael token HP=7 (EH) MP=20 (EF), got HP=%v MP=%v", tok.HP, tok.MP)
			}
		}
	}

	// Step G: Spend 4 Karma on Aelindra (10 -> 6)
	aelindra := execAction("act_karma_ok")
	if aelindra.Resources["karma"].Current != 6 {
		t.Fatalf("expected Aelindra Karma=6, got %+v", aelindra.Resources)
	}

	// Step H: Attempt to spend 9 Karma when only 6 remain -> error & unchanged!
	gmWS.send(t, hub.OutEnvelope{
		Type:    "chat.action",
		Payload: map[string]any{"messageId": msgID, "actionId": "act_karma_fail"},
	})
	errEv := readUntilType(t, gmWS, "error", 3*time.Second)
	if !strings.Contains(string(errEv.Payload), "Karma insuficiente") {
		t.Fatalf("expected Karma insuficiente error, got %s", string(errEv.Payload))
	}
}
