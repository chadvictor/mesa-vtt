package model

import (
	"testing"
)

func strPtr(s string) *string { return &s }

func TestCanViewRules(t *testing.T) {
	if !CanView("gm1", RoleGM, VisibilityGMOnly, nil) {
		t.Fatal("GM must view gm_only")
	}
	if CanView("p1", RolePlayer, VisibilityGMOnly, []string{"p1"}) {
		t.Fatal("player must NEVER view gm_only even if listed in visibleTo")
	}
	if !CanView("p1", RolePlayer, VisibilityAllPlayers, nil) {
		t.Fatal("player should view all_players")
	}
	if !CanView("p1", RolePlayer, VisibilitySpecificPlayers, []string{"p1"}) {
		t.Fatal("player listed in specific_players should view")
	}
	if CanView("p2", RolePlayer, VisibilitySpecificPlayers, []string{"p1"}) {
		t.Fatal("player NOT listed in specific_players must not view")
	}
	if CanView("p1", RolePlayer, Visibility("unknown"), nil) {
		t.Fatal("unknown visibility must fail closed")
	}
}

func TestSanitizeCampaignStateStripsAllGMSecrets(t *testing.T) {
	gmSceneID := "sc_gm"
	state := CampaignState{
		Campaign: Campaign{
			ID:            "c1",
			ActiveSceneID: strPtr(gmSceneID),
			Combat: CombatState{
				Active:    true,
				Round:     2,
				TurnIndex: 1,
				Combatants: []Combatant{
					{ID: "cmb1", Name: "Hero", Initiative: 14, Hidden: false},
					{ID: "cmb2", Name: "Secret Assassin", Initiative: 12, Hidden: true},
					{ID: "cmb3", Name: "Goblin", Initiative: 10, Hidden: false},
				},
			},
		},
		ActiveSceneID: strPtr(gmSceneID),
		Folders: []Folder{
			{ID: "f_gm", Name: "GM Root", Visibility: VisibilityGMOnly},
			{ID: "f_child", ParentID: strPtr("f_gm"), Name: "Child Under GM", Visibility: VisibilityAllPlayers},
			{ID: "f_pub", Name: "Public", Visibility: VisibilityAllPlayers},
		},
		Documents: []Document{
			{ID: "d_in_gm_folder", FolderID: strPtr("f_gm"), Title: "Nested Secret", Visibility: VisibilityAllPlayers},
			{ID: "d_gm", FolderID: strPtr("f_pub"), Title: "Direct Secret", Visibility: VisibilityGMOnly},
			{ID: "d_p1", FolderID: strPtr("f_pub"), Title: "Only P1", Visibility: VisibilitySpecificPlayers, VisibleToUserIDs: []string{"p1"}},
			{ID: "d_pub", FolderID: strPtr("f_pub"), Title: "Public", Visibility: VisibilityAllPlayers},
		},
		Scenes: []Scene{
			{
				ID:         gmSceneID,
				Name:       "Secret Boss Room",
				Visibility: VisibilityGMOnly,
				Tokens:     []Token{{ID: "t_boss", Layer: "tokens"}},
			},
			{
				ID:         "sc_pub",
				Name:       "Tavern",
				Visibility: VisibilityAllPlayers,
				Tokens: []Token{
					{ID: "t_hero", Name: "Hero", Layer: "tokens"},
					{ID: "t_ambush", Name: "Hidden Goblin", Layer: "gm"},
				},
			},
		},
		Messages: []ChatMessage{
			{ID: "m_pub", Kind: ChatKindOOC, Visibility: VisibilityAllPlayers},
			{ID: "m_gm_roll", Kind: ChatKindRoll, Visibility: VisibilityGMOnly, SenderUserID: "gm1"},
			{ID: "m_whisper_p1", Kind: ChatKindWhisper, Visibility: VisibilitySpecificPlayers, SenderUserID: "gm1", VisibleToUserIDs: []string{"p1"}},
		},
	}

	p2State := SanitizeCampaignState(state, "p2", RolePlayer)

	if len(p2State.Folders) != 1 || p2State.Folders[0].ID != "f_pub" {
		t.Fatalf("expected only f_pub for p2, got %+v", p2State.Folders)
	}
	if len(p2State.Documents) != 1 || p2State.Documents[0].ID != "d_pub" {
		t.Fatalf("expected only d_pub for p2, got %+v", p2State.Documents)
	}
	if len(p2State.Scenes) != 1 || p2State.Scenes[0].ID != "sc_pub" {
		t.Fatalf("expected only sc_pub for p2, got %+v", p2State.Scenes)
	}
	if len(p2State.Scenes[0].Tokens) != 1 || p2State.Scenes[0].Tokens[0].ID != "t_hero" {
		t.Fatalf("expected GM-layer token stripped, got %+v", p2State.Scenes[0].Tokens)
	}
	if p2State.ActiveSceneID == nil || *p2State.ActiveSceneID != "sc_pub" {
		t.Fatalf("expected activeSceneId fallback to sc_pub, got %v", p2State.ActiveSceneID)
	}
	if len(p2State.Campaign.Combat.Combatants) != 2 {
		t.Fatalf("expected hidden combatant stripped, got %+v", p2State.Campaign.Combat.Combatants)
	}
	if len(p2State.Messages) != 1 || p2State.Messages[0].ID != "m_pub" {
		t.Fatalf("expected secret roll & other whisper stripped for p2, got %+v", p2State.Messages)
	}

	// Player 1 should see their own whisper and specific_players doc, still not GM secrets
	p1State := SanitizeCampaignState(state, "p1", RolePlayer)
	if len(p1State.Documents) != 2 {
		t.Fatalf("expected 2 docs for p1, got %+v", p1State.Documents)
	}
	if len(p1State.Messages) != 2 {
		t.Fatalf("expected 2 messages for p1, got %+v", p1State.Messages)
	}

	// GM sees everything
	gmState := SanitizeCampaignState(state, "gm1", RoleGM)
	if len(gmState.Folders) != 3 || len(gmState.Documents) != 4 || len(gmState.Scenes) != 2 || len(gmState.Messages) != 3 {
		t.Fatalf("GM should see all items: folders=%d docs=%d scenes=%d msgs=%d",
			len(gmState.Folders), len(gmState.Documents), len(gmState.Scenes), len(gmState.Messages))
	}
}
