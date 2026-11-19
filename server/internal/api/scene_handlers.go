package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

func (s *Server) handleCreateScene(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	var in model.Scene
	if err := decodeJSON(r, &in, 256*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "Nome da cena é obrigatório")
		return
	}
	in.ID = newID("scene")
	in.CampaignID = member.CampaignID
	if in.Width <= 0 {
		in.Width = 1600
	}
	if in.Height <= 0 {
		in.Height = 1200
	}
	if in.Grid.Cols <= 0 {
		in.Grid.Cols = 24
	}
	if in.Grid.Rows <= 0 {
		in.Grid.Rows = 18
	}
	if in.Grid.CellMeters <= 0 {
		in.Grid.CellMeters = 1.5
	}
	if in.Grid.Color == "" {
		in.Grid.Color = "rgba(255,255,255,0.16)"
	}
	expectedFogLen := in.Grid.Cols * in.Grid.Rows
	if len(in.Fog.RevealedCells) != expectedFogLen {
		fill := "1"
		if in.Fog.Enabled {
			fill = "0"
		}
		in.Fog.RevealedCells = strings.Repeat(fill, expectedFogLen)
	}
	if in.Tokens == nil {
		in.Tokens = []model.Token{}
	}
	if in.Visibility == "" {
		in.Visibility = model.VisibilityAllPlayers
	}
	in.Visibility = model.NormalizeVisibility(in.Visibility)
	in.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpsertScene(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar cena")
		return
	}
	s.Hub.NotifySceneUpserted(member.CampaignID, in, true)
	writeJSON(w, http.StatusCreated, map[string]any{"scene": in})
}

func (s *Server) handleUpdateScene(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	sid := r.PathValue("sid")
	sc, err := s.Store.GetScene(r.Context(), member.CampaignID, sid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Cena não encontrada")
		return
	}

	var patch map[string]any
	if err := decodeJSON(r, &patch, 256*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	if v, ok := patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		sc.Name = strings.TrimSpace(v)
	}
	if v, ok := patch["imageUrl"].(string); ok {
		sc.ImageURL = v
	}
	if v, ok := patch["width"].(float64); ok && v > 0 {
		sc.Width = int(v)
	}
	if v, ok := patch["height"].(float64); ok && v > 0 {
		sc.Height = int(v)
	}
	if v, ok := patch["grid"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			_ = json.Unmarshal(raw, &sc.Grid)
		}
	}
	if v, ok := patch["fog"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			_ = json.Unmarshal(raw, &sc.Fog)
		}
	}
	if v, ok := patch["tokens"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var tokens []model.Token
			if json.Unmarshal(raw, &tokens) == nil {
				sc.Tokens = tokens
			}
		}
	}
	if v, ok := patch["visibility"].(string); ok && v != "" {
		sc.Visibility = model.NormalizeVisibility(model.Visibility(v))
	}
	if v, ok := patch["visibleToUserIds"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var ids []string
			if json.Unmarshal(raw, &ids) == nil {
				sc.VisibleToUserIDs = ids
			}
		}
	}
	sc.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpsertScene(r.Context(), sc); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar cena")
		return
	}
	s.Hub.NotifySceneUpserted(member.CampaignID, sc, false)
	writeJSON(w, http.StatusOK, map[string]any{"scene": sc})
}

func (s *Server) handleDeleteScene(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	sid := r.PathValue("sid")
	if err := s.Store.DeleteScene(r.Context(), member.CampaignID, sid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Cena não encontrada")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir cena")
		return
	}
	s.Hub.NotifySceneDeleted(member.CampaignID, sid)
	w.WriteHeader(http.StatusNoContent)
}
