package api

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/data"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

const MaxUploadBytes = 5 * 1024 * 1024 // 5 MB

var (
	mightyBladeCategories = []string{
		"rules", "races", "classes", "conditions", "abilities", "spells", "equipment", "bestiary",
	}
	tagmarCategories = []string{
		"rules", "races", "professions", "conditions", "skills", "spells", "equipment", "bestiary",
	}
	unsafeSVGPattern = regexp.MustCompile(`(?is)<\s*script|on[a-z]+\s*=|javascript:|<\s*foreignObject`)
)

// --- Folders ---

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	var in model.Folder
	if err := decodeJSON(r, &in, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "Nome da pasta é obrigatório")
		return
	}
	in.ID = newID("fld")
	in.CampaignID = member.CampaignID
	in.CreatedBy = user.ID
	if in.Visibility == "" {
		in.Visibility = model.VisibilityAllPlayers
	}
	in.Visibility = model.NormalizeVisibility(in.Visibility)

	if err := s.Store.UpsertFolder(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar pasta")
		return
	}
	s.Hub.NotifyFolderUpserted(member.CampaignID, in)
	writeJSON(w, http.StatusCreated, map[string]any{"folder": in})
}

func (s *Server) handleUpdateFolder(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	fid := r.PathValue("fid")
	existing, err := s.Store.GetFolder(r.Context(), member.CampaignID, fid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Pasta não encontrada")
		return
	}
	var patch map[string]any
	if err := decodeJSON(r, &patch, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	if v, ok := patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		existing.Name = strings.TrimSpace(v)
	}
	if v, ok := patch["icon"].(string); ok {
		existing.Icon = v
	}
	if v, ok := patch["sortOrder"].(float64); ok {
		existing.SortOrder = int(v)
	}
	if v, ok := patch["parentId"]; ok {
		if v == nil {
			existing.ParentID = nil
		} else if str, ok := v.(string); ok {
			if str == "" {
				existing.ParentID = nil
			} else {
				existing.ParentID = &str
			}
		}
	}
	if v, ok := patch["visibility"].(string); ok && v != "" {
		existing.Visibility = model.NormalizeVisibility(model.Visibility(v))
	}
	if v, ok := patch["visibleToUserIds"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var ids []string
			if json.Unmarshal(raw, &ids) == nil {
				existing.VisibleToUserIDs = ids
			}
		}
	}

	if err := s.Store.UpsertFolder(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar pasta")
		return
	}
	s.Hub.NotifyFolderUpserted(member.CampaignID, existing)
	writeJSON(w, http.StatusOK, map[string]any{"folder": existing})
}

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	fid := r.PathValue("fid")
	if err := s.Store.DeleteFolder(r.Context(), member.CampaignID, fid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Pasta não encontrada")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir pasta")
		return
	}
	s.Hub.NotifyFolderDeleted(member.CampaignID, fid)
	w.WriteHeader(http.StatusNoContent)
}

// --- Documents ---

func (s *Server) handleCreateDocument(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	if member.Role == model.RoleObserver {
		writeError(w, http.StatusForbidden, "forbidden", "Observadores não podem criar documentos")
		return
	}
	var in model.Document
	if err := decodeJSON(r, &in, 256*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		writeError(w, http.StatusBadRequest, "invalid_title", "Título é obrigatório")
		return
	}
	in.ID = newID("doc")
	in.CampaignID = member.CampaignID
	in.CreatedBy = user.ID
	if in.Kind == "" {
		in.Kind = model.DocKindNote
	}
	if member.Role != model.RoleGM {
		// Players create shared or specific-player notes (never hidden GM secrets)
		if in.Visibility == "" || in.Visibility == model.VisibilityGMOnly {
			in.Visibility = model.VisibilityAllPlayers
		}
	} else if in.Visibility == "" {
		in.Visibility = model.VisibilityAllPlayers
	}
	in.Visibility = model.NormalizeVisibility(in.Visibility)
	in.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpsertDocument(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar documento")
		return
	}
	s.Hub.NotifyDocumentUpserted(member.CampaignID, in)
	writeJSON(w, http.StatusCreated, map[string]any{"document": in})
}

func (s *Server) handleUpdateDocument(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	did := r.PathValue("did")
	existing, err := s.Store.GetDocument(r.Context(), member.CampaignID, did)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Documento não encontrado")
		return
	}
	if member.Role != model.RoleGM && existing.CreatedBy != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para editar este documento")
		return
	}

	var patch map[string]any
	if err := decodeJSON(r, &patch, 256*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	if v, ok := patch["title"].(string); ok && strings.TrimSpace(v) != "" {
		existing.Title = strings.TrimSpace(v)
	}
	if v, ok := patch["content"].(string); ok {
		existing.Content = v
	}
	if v, ok := patch["kind"].(string); ok && v != "" {
		existing.Kind = model.DocumentKind(v)
	}
	if v, ok := patch["imageUrl"].(string); ok {
		existing.ImageURL = v
	}
	if v, ok := patch["folderId"]; ok {
		if v == nil {
			existing.FolderID = nil
		} else if str, ok := v.(string); ok {
			if str == "" {
				existing.FolderID = nil
			} else {
				existing.FolderID = &str
			}
		}
	}
	if v, ok := patch["tags"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var tags []string
			if json.Unmarshal(raw, &tags) == nil {
				existing.Tags = tags
			}
		}
	}
	if v, ok := patch["visibility"].(string); ok && v != "" {
		nv := model.NormalizeVisibility(model.Visibility(v))
		if member.Role == model.RoleGM || nv != model.VisibilityGMOnly {
			existing.Visibility = nv
		}
	}
	if v, ok := patch["visibleToUserIds"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var ids []string
			if json.Unmarshal(raw, &ids) == nil {
				existing.VisibleToUserIDs = ids
			}
		}
	}
	existing.UpdatedAt = time.Now().UTC()

	if err := s.Store.UpsertDocument(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar documento")
		return
	}
	s.Hub.NotifyDocumentUpserted(member.CampaignID, existing)
	writeJSON(w, http.StatusOK, map[string]any{"document": existing})
}

func (s *Server) handleDeleteDocument(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	did := r.PathValue("did")
	existing, err := s.Store.GetDocument(r.Context(), member.CampaignID, did)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Documento não encontrado")
		return
	}
	if member.Role != model.RoleGM && existing.CreatedBy != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para excluir este documento")
		return
	}
	if err := s.Store.DeleteDocument(r.Context(), member.CampaignID, did); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir documento")
		return
	}
	s.Hub.NotifyDocumentDeleted(member.CampaignID, did)
	w.WriteHeader(http.StatusNoContent)
}

// --- Macros ---

func (s *Server) handleCreateMacro(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	if member.Role == model.RoleObserver {
		writeError(w, http.StatusForbidden, "forbidden", "Observadores não podem criar macros")
		return
	}
	var in model.Macro
	if err := decodeJSON(r, &in, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Script = strings.TrimSpace(in.Script)
	if in.Name == "" || in.Script == "" {
		writeError(w, http.StatusBadRequest, "invalid_macro", "Nome e script da macro são obrigatórios")
		return
	}
	in.ID = newID("mac")
	in.CampaignID = member.CampaignID
	in.CreatedBy = user.ID
	if in.Scope == "" {
		in.Scope = "campaign"
	}
	if in.Icon == "" {
		in.Icon = "sparkles"
	}
	if in.Color == "" {
		in.Color = "#d4a84f"
	}
	if in.Visibility == "" || (member.Role != model.RoleGM && in.Visibility == model.VisibilityGMOnly) {
		in.Visibility = model.VisibilityAllPlayers
	}
	in.Visibility = model.NormalizeVisibility(in.Visibility)

	if err := s.Store.UpsertMacro(r.Context(), in); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar macro")
		return
	}
	s.Hub.NotifyMacroUpserted(member.CampaignID, in)
	writeJSON(w, http.StatusCreated, map[string]any{"macro": in})
}

func (s *Server) handleUpdateMacro(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	mid := r.PathValue("mid")
	existing, err := s.Store.GetMacro(r.Context(), member.CampaignID, mid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Macro não encontrada")
		return
	}
	if member.Role != model.RoleGM && existing.CreatedBy != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para editar esta macro")
		return
	}
	var patch map[string]any
	if err := decodeJSON(r, &patch, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	if v, ok := patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		existing.Name = strings.TrimSpace(v)
	}
	if v, ok := patch["script"].(string); ok && strings.TrimSpace(v) != "" {
		existing.Script = strings.TrimSpace(v)
	}
	if v, ok := patch["icon"].(string); ok {
		existing.Icon = v
	}
	if v, ok := patch["color"].(string); ok {
		existing.Color = v
	}
	if v, ok := patch["scope"].(string); ok && v != "" {
		existing.Scope = v
	}
	if v, ok := patch["visibility"].(string); ok && v != "" {
		nv := model.NormalizeVisibility(model.Visibility(v))
		if member.Role == model.RoleGM || nv != model.VisibilityGMOnly {
			existing.Visibility = nv
		}
	}

	if err := s.Store.UpsertMacro(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao atualizar macro")
		return
	}
	s.Hub.NotifyMacroUpserted(member.CampaignID, existing)
	writeJSON(w, http.StatusOK, map[string]any{"macro": existing})
}

func (s *Server) handleDeleteMacro(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	mid := r.PathValue("mid")
	existing, err := s.Store.GetMacro(r.Context(), member.CampaignID, mid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Macro não encontrada")
		return
	}
	if member.Role != model.RoleGM && existing.CreatedBy != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "Sem permissão para excluir macro")
		return
	}
	if err := s.Store.DeleteMacro(r.Context(), member.CampaignID, mid); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao excluir macro")
		return
	}
	s.Hub.NotifyMacroDeleted(member.CampaignID, mid)
	w.WriteHeader(http.StatusNoContent)
}

// --- Voice Channels ---

func (s *Server) handleCreateVoiceChannel(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	var in struct {
		Name             string `json:"name"`
		LockedForPlayers bool   `json:"lockedForPlayers"`
	}
	if err := decodeJSON(r, &in, 8192); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	name := strings.TrimSpace(in.Name)
	if len(name) < 2 || len(name) > 60 {
		writeError(w, http.StatusBadRequest, "invalid_name", "Nome do canal deve ter entre 2 e 60 caracteres")
		return
	}
	ch := model.VoiceChannel{
		ID:               newID("vc"),
		CampaignID:       member.CampaignID,
		Name:             name,
		IsDefault:        false,
		LockedForPlayers: in.LockedForPlayers,
		Participants:     []model.VoiceParticipant{},
	}
	if err := s.Store.UpsertVoiceChannel(r.Context(), ch); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao criar canal de voz")
		return
	}
	s.Hub.NotifyVoiceChannelsChanged(member.CampaignID)
	writeJSON(w, http.StatusCreated, map[string]any{"channel": ch})
}

func (s *Server) handleDeleteVoiceChannel(w http.ResponseWriter, r *http.Request, _ model.UserIdentity, member model.CampaignMember) {
	vcid := r.PathValue("vcid")
	ch, err := s.Store.GetVoiceChannel(r.Context(), member.CampaignID, vcid)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Canal de voz não encontrado")
		return
	}
	if ch.IsDefault {
		writeError(w, http.StatusBadRequest, "cannot_delete_default", "Não é possível remover o canal de voz padrão")
		return
	}
	if err := s.Store.DeleteVoiceChannel(r.Context(), member.CampaignID, vcid); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", "Falha ao remover canal de voz")
		return
	}
	s.Hub.NotifyVoiceChannelsChanged(member.CampaignID)
	w.WriteHeader(http.StatusNoContent)
}

// --- Compendium ---

type compendiumSpec struct {
	dir        string
	fs         embed.FS
	categories []string
}

func resolveCompendiumSpec(sysID string) (compendiumSpec, bool) {
	switch strings.ToLower(strings.TrimSpace(sysID)) {
	case "mighty-blade-3e", "mighty-blade":
		return compendiumSpec{
			dir:        "mighty-blade",
			fs:         data.MightyBladeFS,
			categories: mightyBladeCategories,
		}, true
	case "tagmar-3", "tagmar", "tagmar-3e", "tagmar-3.0":
		return compendiumSpec{
			dir:        "tagmar",
			fs:         data.TagmarFS,
			categories: tagmarCategories,
		}, true
	default:
		return compendiumSpec{}, false
	}
}

func (s *Server) handleCompendiumAll(w http.ResponseWriter, r *http.Request) {
	sysID := r.PathValue("systemId")
	spec, ok := resolveCompendiumSpec(sysID)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Compêndio não encontrado para o sistema: "+sysID)
		return
	}
	out := make(map[string]json.RawMessage, len(spec.categories))
	for _, cat := range spec.categories {
		if raw, err := s.readCompendiumFile(spec.dir, spec.fs, cat+".json"); err == nil {
			out[cat] = json.RawMessage(raw)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCompendiumCategory(w http.ResponseWriter, r *http.Request) {
	sysID := r.PathValue("systemId")
	cat := strings.TrimSuffix(strings.TrimSpace(r.PathValue("category")), ".json")
	spec, ok := resolveCompendiumSpec(sysID)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Compêndio não encontrado")
		return
	}
	allowed := false
	for _, c := range spec.categories {
		if c == cat {
			allowed = true
			break
		}
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "not_found", "Categoria não encontrada: "+cat)
		return
	}
	raw, err := s.readCompendiumFile(spec.dir, spec.fs, cat+".json")
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Arquivo de compêndio indisponível")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (s *Server) readCompendiumFile(dir string, fs embed.FS, filename string) ([]byte, error) {
	// Prefer configurable disk DATA_DIR if present, fall back to embedded FS.
	if s.Config.DataDir != "" {
		diskPath := filepath.Join(s.Config.DataDir, dir, filename)
		if b, err := os.ReadFile(diskPath); err == nil {
			return b, nil
		}
	}
	return fs.ReadFile(dir + "/" + filename)
}

// --- Image Upload ---

func (s *Server) handleUploadImage(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
	if member.Role == model.RoleObserver {
		writeError(w, http.StatusForbidden, "forbidden", "Observadores não podem enviar imagens")
		return
	}
	if !s.limiter.allow("upload:"+user.ID, 20, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Limite de uploads atingido, aguarde um minuto.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes+1024*64)
	if err := r.ParseMultipartForm(MaxUploadBytes); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "Imagem excede o limite de 5 MB")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing_file", "Campo 'file' é obrigatório")
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, MaxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "read_error", "Falha ao ler arquivo")
		return
	}
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "empty_file", "Arquivo vazio")
		return
	}
	if len(raw) > MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "Imagem excede o limite de 5 MB")
		return
	}

	mimeType := detectSafeImageMIME(raw, header.Filename)
	if mimeType == "" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_type", "Formato suportado: PNG, JPEG, WebP ou SVG seguro")
		return
	}
	if mimeType == "image/svg+xml" && unsafeSVGPattern.Match(raw) {
		writeError(w, http.StatusBadRequest, "unsafe_svg", "SVG contém scripts ou manipuladores não permitidos")
		return
	}

	dataURI := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(raw)
	writeJSON(w, http.StatusOK, map[string]any{
		"url":      dataURI,
		"mimeType": mimeType,
		"size":     len(raw),
	})
}

func detectSafeImageMIME(raw []byte, filename string) string {
	// Check magic bytes for PNG, JPEG, WebP
	if len(raw) >= 8 && bytes.Equal(raw[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		return "image/png"
	}
	if len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff {
		return "image/jpeg"
	}
	if len(raw) >= 12 && string(raw[0:4]) == "RIFF" && string(raw[8:12]) == "WEBP" {
		return "image/webp"
	}
	// Check safe SVG
	head := strings.TrimSpace(string(raw[:min(len(raw), 512)]))
	lower := strings.ToLower(head)
	if (strings.HasSuffix(strings.ToLower(filename), ".svg") || strings.Contains(lower, "<svg")) &&
		strings.Contains(lower, "<svg") {
		return "image/svg+xml"
	}
	return ""
}

// --- Optional Gemini (Nano Banana) Live Image Generation ---

func (s *Server) handleGenerateAIImage(w http.ResponseWriter, r *http.Request, user model.UserIdentity) {
	if s.Config.GeminiAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "ai_not_configured", "GEMINI_API_KEY não configurado no servidor")
		return
	}
	if !s.limiter.allow("ai:"+user.ID, 6, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Aguarde antes de gerar outra imagem")
		return
	}

	var in struct {
		Prompt string `json:"prompt"`
		Kind   string `json:"kind"` // "map" | "portrait" | "monster" | "handout"
	}
	if err := decodeJSON(r, &in, 16*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}
	prompt := strings.TrimSpace(in.Prompt)
	if len(prompt) < 3 || len(prompt) > 600 {
		writeError(w, http.StatusBadRequest, "invalid_prompt", "Descreva a imagem entre 3 e 600 caracteres")
		return
	}

	styledPrompt := prompt
	switch in.Kind {
	case "map":
		styledPrompt = "Top-down tabletop RPG battlemap, dark fantasy medieval painterly illustration, crisp grid-friendly layout, no text or UI: " + prompt
	case "portrait":
		styledPrompt = "Dark fantasy medieval RPG character portrait, centered bust, dramatic torchlight, oil painting style, no text: " + prompt
	case "monster":
		styledPrompt = "Dark fantasy tabletop RPG monster illustration, dramatic lighting, painterly concept art, no text: " + prompt
	}

	reqBody := map[string]any{
		"contents": []map[string]any{
			{
				"parts": []map[string]any{
					{"text": styledPrompt},
				},
			},
		},
		"generationConfig": map[string]any{
			"responseModalities": []string{"IMAGE"},
		},
	}
	encoded, _ := json.Marshal(reqBody)

	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		s.Config.GeminiImageModel, s.Config.GeminiAPIKey)
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ai_error", "Falha ao preparar requisição de imagem")
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ai_unreachable", "Serviço de geração de imagem indisponível")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "ai_failed", fmt.Sprintf("Falha na API de imagem (HTTP %d)", resp.StatusCode))
		return
	}

	var apiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					InlineData *struct {
						MimeType string `json:"mimeType"`
						Data     string `json:"data"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 12*1024*1024)).Decode(&apiResp); err != nil {
		writeError(w, http.StatusBadGateway, "ai_parse_error", "Resposta inválida da API de imagem")
		return
	}
	for _, cand := range apiResp.Candidates {
		for _, part := range cand.Content.Parts {
			if part.InlineData != nil && part.InlineData.Data != "" {
				mime := part.InlineData.MimeType
				if mime == "" {
					mime = "image/png"
				}
				writeJSON(w, http.StatusOK, map[string]any{
					"url": "data:" + mime + ";base64," + part.InlineData.Data,
				})
				return
			}
		}
	}
	writeError(w, http.StatusBadGateway, "ai_no_image", "Nenhuma imagem retornada pela API")
}
