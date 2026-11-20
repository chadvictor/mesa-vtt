package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

var inviteCodePattern = regexp.MustCompile(`^[A-Z0-9]{4,12}$`)

func (s *Server) handleListCampaigns(w http.ResponseWriter, r *http.Request, user model.UserIdentity) {
	campaigns, err := s.Store.ListCampaigns(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao listar campanhas")
		return
	}

	out := make([]model.CampaignSummary, 0, len(campaigns))
	for _, c := range campaigns {
		members, _ := s.Store.ListMembers(r.Context(), c.ID)
		var myRole model.MemberRole
		gmName := ""
		isMember := false
		for _, m := range members {
			if m.UserID == user.ID {
				isMember = true
				myRole = m.Role
			}
			if m.Role == model.RoleGM && gmName == "" {
				gmName = m.DisplayName
			}
		}
		if !isMember && c.Privacy != "public" {
			continue
		}

		// Strip hidden combat state in lobby listing
		c.Combat = model.SanitizeCombatForUser(c.Combat, myRole)
		onlineCount, voiceCount := s.Hub.Counts(c.ID)
		out = append(out, model.CampaignSummary{
			Campaign:         c,
			GMName:           gmName,
			MemberCount:      len(members),
			OnlineCount:      onlineCount,
			VoiceCount:       voiceCount,
			VoiceActiveCount: voiceCount,
			MyRole:           myRole,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"campaigns": out})
}

func (s *Server) handleCreateCampaign(w http.ResponseWriter, r *http.Request, user model.UserIdentity) {
	var in struct {
		Name        string `json:"name"`
		SystemID    string `json:"systemId"`
		Description string `json:"description"`
		CoverURL    string `json:"coverUrl"`
		Privacy     string `json:"privacy"`
		InviteCode  string `json:"inviteCode"`
	}
	if err := decodeJSON(r, &in, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	name := strings.TrimSpace(in.Name)
	if len(name) < 2 || len(name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_name", "Nome da campanha deve ter entre 2 e 100 caracteres")
		return
	}
	systemID := strings.TrimSpace(in.SystemID)
	if systemID == "" {
		systemID = "mighty-blade-3e"
	}
	switch strings.ToLower(systemID) {
	case "mighty-blade-3e", "mighty-blade":
		systemID = "mighty-blade-3e"
	case "tagmar-3", "tagmar", "tagmar-3e", "tagmar-3.0":
		systemID = "tagmar-3"
	case "generic-rpg":
		systemID = "generic-rpg"
	default:
		writeError(w, http.StatusBadRequest, "invalid_system", "Sistema não suportado: "+systemID)
		return
	}
	privacy := strings.TrimSpace(in.Privacy)
	if privacy != "public" && privacy != "invite_only" {
		privacy = "public"
	}
	coverURL := strings.TrimSpace(in.CoverURL)
	if coverURL == "" {
		if systemID == "tagmar-3" {
			coverURL = "./assets/maps/castle-courtyard.svg"
		} else {
			coverURL = "./assets/banner-mesa-rpg.svg"
		}
	}

	inviteCode := strings.ToUpper(strings.TrimSpace(in.InviteCode))
	if inviteCode == "" {
		inviteCode = newInviteCode()
	} else if !inviteCodePattern.MatchString(inviteCode) {
		writeError(w, http.StatusBadRequest, "invalid_invite_code", "Código de convite deve ter 4 a 12 letras/números")
		return
	}

	now := time.Now().UTC()
	campID := newID("camp")
	sceneID := newID("scene")
	vcID := newID("vc")

	camp := model.Campaign{
		ID:            campID,
		Name:          name,
		Description:   strings.TrimSpace(in.Description),
		SystemID:      systemID,
		CoverURL:      coverURL,
		InviteCode:    inviteCode,
		Privacy:       privacy,
		OwnerUserID:   user.ID,
		ActiveSceneID: &sceneID,
		Combat: model.CombatState{
			Active:     false,
			Round:      1,
			TurnIndex:  0,
			Combatants: []model.Combatant{},
		},
		Settings: model.CampaignSettings{
			AllowPlayerDice3D:     true,
			DefaultVoiceChannelID: vcID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := s.Store.CreateCampaign(r.Context(), camp); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "invite_code_taken", "Código de convite já está em uso")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar campanha")
		return
	}

	member := model.CampaignMember{
		CampaignID:  campID,
		UserID:      user.ID,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Role:        model.RoleGM,
		Online:      true,
		JoinedAt:    now,
	}
	_ = s.Store.UpsertMember(r.Context(), member)

	// Create default scene & default "Mesa Principal" voice channel
	defaultSceneImg := "./assets/maps/tavern.svg"
	if systemID == "tagmar-3" {
		defaultSceneImg = "./assets/maps/castle-courtyard.svg"
	}
	_ = s.Store.UpsertScene(r.Context(), model.Scene{
		ID:         sceneID,
		CampaignID: campID,
		Name:       "Mapa Inicial",
		ImageURL:   defaultSceneImg,
		Width:      1600,
		Height:     1200,
		Grid: model.SceneGrid{
			Enabled: true, Cols: 24, Rows: 18, CellMeters: 1.5, Color: "rgba(255,255,255,0.16)", Snap: true,
		},
		Fog:        model.SceneFog{Enabled: false, RevealedCells: strings.Repeat("1", 24*18)},
		Tokens:     []model.Token{},
		Visibility: model.VisibilityAllPlayers,
		UpdatedAt:  now,
	})

	_ = s.Store.UpsertVoiceChannel(r.Context(), model.VoiceChannel{
		ID:         vcID,
		CampaignID: campID,
		Name:       "Mesa Principal",
		IsDefault:  true,
	})

	_ = s.Store.UpsertFolder(r.Context(), model.Folder{
		ID:         newID("fld"),
		CampaignID: campID,
		Name:       "Segredos do Mestre",
		Icon:       "lock",
		SortOrder:  1,
		Visibility: model.VisibilityGMOnly,
		CreatedBy:  user.ID,
	})
	_ = s.Store.UpsertFolder(r.Context(), model.Folder{
		ID:         newID("fld"),
		CampaignID: campID,
		Name:       "Diário da Campanha",
		Icon:       "book-open",
		SortOrder:  2,
		Visibility: model.VisibilityAllPlayers,
		CreatedBy:  user.ID,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"campaign": camp,
		"member":   member,
	})
}

func (s *Server) handleJoinCampaign(w http.ResponseWriter, r *http.Request, user model.UserIdentity) {
	var in struct {
		InviteCode  string           `json:"inviteCode"`
		DesiredRole model.MemberRole `json:"desiredRole"`
	}
	if err := decodeJSON(r, &in, 16*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(in.InviteCode))
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing_code", "Informe o código da campanha")
		return
	}

	camp, err := s.Store.GetCampaignByInviteCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Campanha não encontrada para este código")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Erro ao buscar campanha")
		return
	}

	existing, err := s.Store.GetMember(r.Context(), camp.ID, user.ID)
	if err == nil {
		// Allow local/demo role switch when explicitly requested
		if s.Config.LocalAuthEnabled() && in.DesiredRole != "" &&
			(in.DesiredRole == model.RoleGM || in.DesiredRole == model.RolePlayer || in.DesiredRole == model.RoleObserver) {
			existing.Role = in.DesiredRole
			existing.DisplayName = user.DisplayName
			_ = s.Store.UpsertMember(r.Context(), existing)
			s.Hub.UpdateMemberRole(camp.ID, user.ID, existing.Role)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"campaign": camp,
			"member":   existing,
		})
		return
	}

	role := model.RolePlayer
	if camp.OwnerUserID == user.ID {
		role = model.RoleGM
	} else if in.DesiredRole == model.RoleObserver {
		role = model.RoleObserver
	} else if in.DesiredRole == model.RoleGM && (s.Config.LocalAuthEnabled() || camp.InviteCode == "DRAKON" || camp.InviteCode == "TAGMAR" || user.IsAdmin) {
		role = model.RoleGM
	}

	member := model.CampaignMember{
		CampaignID:  camp.ID,
		UserID:      user.ID,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Role:        role,
		JoinedAt:    time.Now().UTC(),
	}
	if err := s.Store.UpsertMember(r.Context(), member); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao entrar na campanha")
		return
	}

	s.Hub.NotifyPresence(camp.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"campaign": camp,
		"member":   member,
	})
}

func (s *Server) handleGetCampaignState(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	state, err := s.Hub.BuildCampaignState(r.Context(), member.CampaignID, user.ID, member.Role)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Campanha não encontrada")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao carregar estado da campanha")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleUpdateCampaign(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	camp, err := s.Store.GetCampaign(r.Context(), member.CampaignID)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Campanha não encontrada")
		return
	}

	var in struct {
		Name          *string                 `json:"name"`
		Description   *string                 `json:"description"`
		CoverURL      *string                 `json:"coverUrl"`
		Privacy       *string                 `json:"privacy"`
		ActiveSceneID *string                 `json:"activeSceneId"`
		Settings      *model.CampaignSettings `json:"settings"`
	}
	if err := decodeJSON(r, &in, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	if in.Name != nil && strings.TrimSpace(*in.Name) != "" {
		camp.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		camp.Description = strings.TrimSpace(*in.Description)
	}
	if in.CoverURL != nil {
		camp.CoverURL = strings.TrimSpace(*in.CoverURL)
	}
	if in.Privacy != nil && (*in.Privacy == "public" || *in.Privacy == "invite_only") {
		camp.Privacy = *in.Privacy
	}
	var activatedScene *model.Scene
	if in.ActiveSceneID != nil && *in.ActiveSceneID != "" {
		sc, err := s.Store.GetScene(r.Context(), camp.ID, *in.ActiveSceneID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_scene", "Cena não encontrada")
			return
		}
		sid := sc.ID
		camp.ActiveSceneID = &sid
		activatedScene = &sc
	}
	if in.Settings != nil {
		camp.Settings = *in.Settings
	}
	camp.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpdateCampaign(r.Context(), camp); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar campanha")
		return
	}
	if activatedScene != nil {
		s.Hub.NotifySceneActivated(camp.ID, *activatedScene)
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaign": camp})
}

func (s *Server) handleDeleteCampaign(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	if err := s.Store.DeleteCampaign(r.Context(), member.CampaignID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Campanha não encontrada")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir campanha")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdateMemberRole(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	targetUID := r.PathValue("uid")
	target, err := s.Store.GetMember(r.Context(), member.CampaignID, targetUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Membro não encontrado")
		return
	}
	var in struct {
		Role model.MemberRole `json:"role"`
	}
	if err := decodeJSON(r, &in, 4096); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	if in.Role != model.RoleGM && in.Role != model.RolePlayer && in.Role != model.RoleObserver {
		writeError(w, http.StatusBadRequest, "invalid_role", "Papel inválido")
		return
	}
	target.Role = in.Role
	if err := s.Store.UpsertMember(r.Context(), target); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar membro")
		return
	}
	s.Hub.UpdateMemberRole(member.CampaignID, target.UserID, target.Role)
	writeJSON(w, http.StatusOK, map[string]any{"member": target})
}
