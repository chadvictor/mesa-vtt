package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

func (s *Server) handleCreateCharacter(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	if member.Role == model.RoleObserver {
		writeError(w, http.StatusForbidden, "forbidden", "Observadores não podem criar personagens")
		return
	}
	camp, err := s.Store.GetCampaign(r.Context(), member.CampaignID)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Campanha não encontrada")
		return
	}

	var in model.Character
	if err := decodeJSON(r, &in, 128*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "Nome do personagem é obrigatório")
		return
	}

	in.ID = newID("char")
	in.CampaignID = member.CampaignID
	if in.SystemID == "" {
		in.SystemID = camp.SystemID
	}
	if member.Role != model.RoleGM {
		// Players create PCs owned by themselves
		in.Kind = model.CharKindPC
		uid := user.ID
		in.OwnerUserID = &uid
		in.ControlledByUserIDs = []string{user.ID}
		if in.Visibility == "" || in.Visibility == model.VisibilityGMOnly {
			in.Visibility = model.VisibilityAllPlayers
		}
	} else {
		if in.Kind == "" {
			in.Kind = model.CharKindPC
		}
		if in.Visibility == "" {
			in.Visibility = model.VisibilityAllPlayers
		}
		if in.ControlledByUserIDs == nil {
			in.ControlledByUserIDs = []string{}
		}
	}
	in.Visibility = model.NormalizeVisibility(in.Visibility)
	if in.Resources == nil {
		if in.SystemID == "tagmar-3" {
			in.Resources = map[string]model.ResourceBar{
				"eh":    {Current: 18, Max: 18},
				"ef":    {Current: 15, Max: 15},
				"karma": {Current: 0, Max: 0},
			}
		} else {
			in.Resources = map[string]model.ResourceBar{
				"pv": {Current: 60, Max: 60},
				"pm": {Current: 60, Max: 60},
			}
		}
	}
	if in.Conditions == nil {
		in.Conditions = []model.ActiveCondition{}
	}
	if in.SystemData == nil {
		in.SystemData = map[string]any{}
	}
	if in.Computed == nil {
		in.Computed = map[string]any{}
	}
	if in.PortraitURL == "" {
		in.PortraitURL = "./assets/portraits/human-warrior.svg"
	}
	in.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpsertCharacter(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar personagem")
		return
	}
	s.Hub.NotifyCharacterUpserted(member.CampaignID, in, true)
	writeJSON(w, http.StatusCreated, map[string]any{"character": in})
}

func (s *Server) handleUpdateCharacter(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	cid := r.PathValue("cid")
	ch, err := s.Store.GetCharacter(r.Context(), member.CampaignID, cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Personagem não encontrado")
		return
	}
	if !ch.IsControlledBy(user.ID, member.Role) {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para editar este personagem")
		return
	}

	var patch map[string]any
	if err := decodeJSON(r, &patch, 128*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	if v, ok := patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		ch.Name = strings.TrimSpace(v)
	}
	if v, ok := patch["subtitle"].(string); ok {
		ch.Subtitle = v
	}
	if v, ok := patch["portraitUrl"].(string); ok {
		ch.PortraitURL = v
	}
	if v, ok := patch["resources"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var res map[string]model.ResourceBar
			if json.Unmarshal(raw, &res) == nil {
				ch.Resources = res
				if ef, ok := res["ef"]; ok && ef.Temp > 0 && ch.Computed != nil {
					delete(ch.Computed, "absorcaoDepleted")
				}
			}
		}
	}
	if v, ok := patch["conditions"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var conds []model.ActiveCondition
			if json.Unmarshal(raw, &conds) == nil {
				ch.Conditions = conds
			}
		}
	}
	if v, ok := patch["systemData"]; ok {
		if m, ok := v.(map[string]any); ok {
			if ch.SystemData == nil {
				ch.SystemData = map[string]any{}
			}
			for k, val := range m {
				ch.SystemData[k] = val
			}
		}
	}
	if v, ok := patch["computed"]; ok {
		if m, ok := v.(map[string]any); ok {
			ch.Computed = m
		}
	}
	if member.Role == model.RoleGM {
		if v, ok := patch["kind"].(string); ok && v != "" {
			ch.Kind = model.CharacterKind(v)
		}
		if v, ok := patch["visibility"].(string); ok && v != "" {
			ch.Visibility = model.NormalizeVisibility(model.Visibility(v))
		}
		if v, ok := patch["visibleToUserIds"]; ok {
			if raw, err := json.Marshal(v); err == nil {
				var ids []string
				if json.Unmarshal(raw, &ids) == nil {
					ch.VisibleToUserIDs = ids
				}
			}
		}
		if v, ok := patch["ownerUserId"]; ok {
			if v == nil {
				ch.OwnerUserID = nil
			} else if str, ok := v.(string); ok {
				if str == "" {
					ch.OwnerUserID = nil
				} else {
					ch.OwnerUserID = &str
				}
			}
		}
		if v, ok := patch["controlledByUserIds"]; ok {
			if raw, err := json.Marshal(v); err == nil {
				var ids []string
				if json.Unmarshal(raw, &ids) == nil {
					ch.ControlledByUserIDs = ids
				}
			}
		}
	}

	ch.UpdatedAt = time.Now().UTC()
	if err := s.Store.UpsertCharacter(r.Context(), ch); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar personagem")
		return
	}
	s.Hub.NotifyCharacterUpserted(member.CampaignID, ch, false)
	writeJSON(w, http.StatusOK, map[string]any{"character": ch})
}

func (s *Server) handleDeleteCharacter(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	cid := r.PathValue("cid")
	ch, err := s.Store.GetCharacter(r.Context(), member.CampaignID, cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Personagem não encontrado")
		return
	}
	if !ch.IsControlledBy(user.ID, member.Role) {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para excluir este personagem")
		return
	}
	if err := s.Store.DeleteCharacter(r.Context(), member.CampaignID, cid); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir personagem")
		return
	}
	s.Hub.NotifyCharacterDeleted(member.CampaignID, cid)
	w.WriteHeader(http.StatusNoContent)
}
