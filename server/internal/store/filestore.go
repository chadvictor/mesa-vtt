package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

type fileData struct {
	Campaigns     map[string]model.Campaign                  `json:"campaigns"`
	Members       map[string]map[string]model.CampaignMember `json:"members"`       // campaignID -> userID -> member
	Folders       map[string]map[string]model.Folder         `json:"folders"`       // campaignID -> folderID -> folder
	Documents     map[string]map[string]model.Document       `json:"documents"`     // campaignID -> docID -> doc
	Characters    map[string]map[string]model.Character      `json:"characters"`    // campaignID -> charID -> char
	Scenes        map[string]map[string]model.Scene          `json:"scenes"`        // campaignID -> sceneID -> scene
	Messages      map[string][]model.ChatMessage             `json:"messages"`      // campaignID -> ordered messages
	Macros        map[string]map[string]model.Macro          `json:"macros"`        // campaignID -> macroID -> macro
	VoiceChannels map[string]map[string]model.VoiceChannel   `json:"voiceChannels"` // campaignID -> channelID -> channel
}

func newFileData() fileData {
	return fileData{
		Campaigns:     make(map[string]model.Campaign),
		Members:       make(map[string]map[string]model.CampaignMember),
		Folders:       make(map[string]map[string]model.Folder),
		Documents:     make(map[string]map[string]model.Document),
		Characters:    make(map[string]map[string]model.Character),
		Scenes:        make(map[string]map[string]model.Scene),
		Messages:      make(map[string][]model.ChatMessage),
		Macros:        make(map[string]map[string]model.Macro),
		VoiceChannels: make(map[string]map[string]model.VoiceChannel),
	}
}

// FileStore provides zero-config local persistence backed by an atomically written JSON file.
type FileStore struct {
	mu   sync.RWMutex
	path string
	data fileData
}

func NewFileStore(path string) (*FileStore, error) {
	fs := &FileStore{
		path: path,
		data: newFileData(),
	}
	if path != "" {
		raw, err := os.ReadFile(path)
		if err == nil && len(raw) > 0 {
			var loaded fileData
			if uErr := json.Unmarshal(raw, &loaded); uErr != nil {
				return nil, uErr
			}
			ensureMaps(&loaded)
			fs.data = loaded
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return fs, nil
}

func ensureMaps(d *fileData) {
	if d.Campaigns == nil {
		d.Campaigns = make(map[string]model.Campaign)
	}
	if d.Members == nil {
		d.Members = make(map[string]map[string]model.CampaignMember)
	}
	if d.Folders == nil {
		d.Folders = make(map[string]map[string]model.Folder)
	}
	if d.Documents == nil {
		d.Documents = make(map[string]map[string]model.Document)
	}
	if d.Characters == nil {
		d.Characters = make(map[string]map[string]model.Character)
	}
	if d.Scenes == nil {
		d.Scenes = make(map[string]map[string]model.Scene)
	}
	if d.Messages == nil {
		d.Messages = make(map[string][]model.ChatMessage)
	}
	if d.Macros == nil {
		d.Macros = make(map[string]map[string]model.Macro)
	}
	if d.VoiceChannels == nil {
		d.VoiceChannels = make(map[string]map[string]model.VoiceChannel)
	}
}

func (s *FileStore) flushLocked() error {
	if s.path == "" {
		return nil
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".mesa-vtt-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(encoded); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, s.path)
}

func deepCopy[T any](in T) T {
	b, err := json.Marshal(in)
	if err != nil {
		return in
	}
	var out T
	if err := json.Unmarshal(b, &out); err != nil {
		return in
	}
	return out
}

func (s *FileStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flushLocked()
}

// --- Campaigns ---

func (s *FileStore) ListCampaigns(_ context.Context) ([]model.Campaign, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.Campaign, 0, len(s.data.Campaigns))
	for _, c := range s.data.Campaigns {
		out = append(out, deepCopy(c))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (s *FileStore) GetCampaign(_ context.Context, id string) (model.Campaign, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.data.Campaigns[id]
	if !ok {
		return model.Campaign{}, ErrNotFound
	}
	return deepCopy(c), nil
}

func (s *FileStore) GetCampaignByInviteCode(_ context.Context, code string) (model.Campaign, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	norm := strings.ToUpper(strings.TrimSpace(code))
	for _, c := range s.data.Campaigns {
		if strings.ToUpper(c.InviteCode) == norm {
			return deepCopy(c), nil
		}
	}
	return model.Campaign{}, ErrNotFound
}

func (s *FileStore) CreateCampaign(_ context.Context, c model.Campaign) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data.Campaigns[c.ID]; exists {
		return ErrConflict
	}
	norm := strings.ToUpper(strings.TrimSpace(c.InviteCode))
	for _, existing := range s.data.Campaigns {
		if strings.ToUpper(existing.InviteCode) == norm {
			return ErrConflict
		}
	}
	s.data.Campaigns[c.ID] = deepCopy(c)
	return s.flushLocked()
}

func (s *FileStore) UpdateCampaign(_ context.Context, c model.Campaign) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data.Campaigns[c.ID]; !exists {
		return ErrNotFound
	}
	s.data.Campaigns[c.ID] = deepCopy(c)
	return s.flushLocked()
}

func (s *FileStore) DeleteCampaign(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data.Campaigns[id]; !exists {
		return ErrNotFound
	}
	delete(s.data.Campaigns, id)
	delete(s.data.Members, id)
	delete(s.data.Folders, id)
	delete(s.data.Documents, id)
	delete(s.data.Characters, id)
	delete(s.data.Scenes, id)
	delete(s.data.Messages, id)
	delete(s.data.Macros, id)
	delete(s.data.VoiceChannels, id)
	return s.flushLocked()
}

// --- Members ---

func (s *FileStore) ListMembers(_ context.Context, campaignID string) ([]model.CampaignMember, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Members[campaignID]
	out := make([]model.CampaignMember, 0, len(m))
	for _, item := range m {
		out = append(out, deepCopy(item))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].JoinedAt.Before(out[j].JoinedAt)
	})
	return out, nil
}

func (s *FileStore) GetMember(_ context.Context, campaignID, userID string) (model.CampaignMember, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.data.Members[campaignID][userID]
	if !ok {
		return model.CampaignMember{}, ErrNotFound
	}
	return deepCopy(m), nil
}

func (s *FileStore) UpsertMember(_ context.Context, member model.CampaignMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Members[member.CampaignID] == nil {
		s.data.Members[member.CampaignID] = make(map[string]model.CampaignMember)
	}
	s.data.Members[member.CampaignID][member.UserID] = deepCopy(member)
	return s.flushLocked()
}

func (s *FileStore) DeleteMember(_ context.Context, campaignID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Members[campaignID] != nil {
		delete(s.data.Members[campaignID], userID)
	}
	return s.flushLocked()
}

// --- Folders ---

func (s *FileStore) ListFolders(_ context.Context, campaignID string) ([]model.Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Folders[campaignID]
	out := make([]model.Folder, 0, len(m))
	for _, f := range m {
		out = append(out, deepCopy(f))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (s *FileStore) GetFolder(_ context.Context, campaignID, folderID string) (model.Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, ok := s.data.Folders[campaignID][folderID]
	if !ok {
		return model.Folder{}, ErrNotFound
	}
	return deepCopy(f), nil
}

func (s *FileStore) UpsertFolder(_ context.Context, f model.Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Folders[f.CampaignID] == nil {
		s.data.Folders[f.CampaignID] = make(map[string]model.Folder)
	}
	s.data.Folders[f.CampaignID][f.ID] = deepCopy(f)
	return s.flushLocked()
}

func (s *FileStore) DeleteFolder(_ context.Context, campaignID, folderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Folders[campaignID][folderID]; !ok {
		return ErrNotFound
	}
	delete(s.data.Folders[campaignID], folderID)
	return s.flushLocked()
}

// --- Documents ---

func (s *FileStore) ListDocuments(_ context.Context, campaignID string) ([]model.Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Documents[campaignID]
	out := make([]model.Document, 0, len(m))
	for _, d := range m {
		out = append(out, deepCopy(d))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Title < out[j].Title
	})
	return out, nil
}

func (s *FileStore) GetDocument(_ context.Context, campaignID, docID string) (model.Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.data.Documents[campaignID][docID]
	if !ok {
		return model.Document{}, ErrNotFound
	}
	return deepCopy(d), nil
}

func (s *FileStore) UpsertDocument(_ context.Context, d model.Document) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Documents[d.CampaignID] == nil {
		s.data.Documents[d.CampaignID] = make(map[string]model.Document)
	}
	s.data.Documents[d.CampaignID][d.ID] = deepCopy(d)
	return s.flushLocked()
}

func (s *FileStore) DeleteDocument(_ context.Context, campaignID, docID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Documents[campaignID][docID]; !ok {
		return ErrNotFound
	}
	delete(s.data.Documents[campaignID], docID)
	return s.flushLocked()
}

// --- Characters ---

func (s *FileStore) ListCharacters(_ context.Context, campaignID string) ([]model.Character, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Characters[campaignID]
	out := make([]model.Character, 0, len(m))
	for _, c := range m {
		out = append(out, deepCopy(c))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (s *FileStore) GetCharacter(_ context.Context, campaignID, charID string) (model.Character, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.data.Characters[campaignID][charID]
	if !ok {
		return model.Character{}, ErrNotFound
	}
	return deepCopy(c), nil
}

func (s *FileStore) UpsertCharacter(_ context.Context, c model.Character) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Characters[c.CampaignID] == nil {
		s.data.Characters[c.CampaignID] = make(map[string]model.Character)
	}
	s.data.Characters[c.CampaignID][c.ID] = deepCopy(c)
	return s.flushLocked()
}

func (s *FileStore) DeleteCharacter(_ context.Context, campaignID, charID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Characters[campaignID][charID]; !ok {
		return ErrNotFound
	}
	delete(s.data.Characters[campaignID], charID)
	return s.flushLocked()
}

// --- Scenes ---

func (s *FileStore) ListScenes(_ context.Context, campaignID string) ([]model.Scene, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Scenes[campaignID]
	out := make([]model.Scene, 0, len(m))
	for _, sc := range m {
		out = append(out, deepCopy(sc))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (s *FileStore) GetScene(_ context.Context, campaignID, sceneID string) (model.Scene, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sc, ok := s.data.Scenes[campaignID][sceneID]
	if !ok {
		return model.Scene{}, ErrNotFound
	}
	return deepCopy(sc), nil
}

func (s *FileStore) UpsertScene(_ context.Context, sc model.Scene) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Scenes[sc.CampaignID] == nil {
		s.data.Scenes[sc.CampaignID] = make(map[string]model.Scene)
	}
	s.data.Scenes[sc.CampaignID][sc.ID] = deepCopy(sc)
	return s.flushLocked()
}

func (s *FileStore) DeleteScene(_ context.Context, campaignID, sceneID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Scenes[campaignID][sceneID]; !ok {
		return ErrNotFound
	}
	delete(s.data.Scenes[campaignID], sceneID)
	return s.flushLocked()
}

// --- Chat Messages ---

func (s *FileStore) ListMessages(_ context.Context, campaignID string, limit int) ([]model.ChatMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	msgs := s.data.Messages[campaignID]
	if len(msgs) == 0 {
		return []model.ChatMessage{}, nil
	}
	start := 0
	if limit > 0 && len(msgs) > limit {
		start = len(msgs) - limit
	}
	slice := msgs[start:]
	out := make([]model.ChatMessage, len(slice))
	for i, m := range slice {
		out[i] = deepCopy(m)
	}
	return out, nil
}

func (s *FileStore) GetMessage(_ context.Context, campaignID, messageID string) (model.ChatMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, m := range s.data.Messages[campaignID] {
		if m.ID == messageID {
			return deepCopy(m), nil
		}
	}
	return model.ChatMessage{}, ErrNotFound
}

func (s *FileStore) CreateMessage(_ context.Context, msg model.ChatMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	msgs := append(s.data.Messages[msg.CampaignID], deepCopy(msg))
	// Cap in-file history at 500 messages per campaign to keep JSON snappy.
	if len(msgs) > 500 {
		msgs = msgs[len(msgs)-500:]
	}
	s.data.Messages[msg.CampaignID] = msgs
	return s.flushLocked()
}

func (s *FileStore) UpdateMessage(_ context.Context, msg model.ChatMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	msgs := s.data.Messages[msg.CampaignID]
	for i := range msgs {
		if msgs[i].ID == msg.ID {
			msgs[i] = deepCopy(msg)
			s.data.Messages[msg.CampaignID] = msgs
			return s.flushLocked()
		}
	}
	return ErrNotFound
}

// --- Macros ---

func (s *FileStore) ListMacros(_ context.Context, campaignID string) ([]model.Macro, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.Macros[campaignID]
	out := make([]model.Macro, 0, len(m))
	for _, mc := range m {
		out = append(out, deepCopy(mc))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (s *FileStore) GetMacro(_ context.Context, campaignID, macroID string) (model.Macro, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mc, ok := s.data.Macros[campaignID][macroID]
	if !ok {
		return model.Macro{}, ErrNotFound
	}
	return deepCopy(mc), nil
}

func (s *FileStore) UpsertMacro(_ context.Context, mc model.Macro) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Macros[mc.CampaignID] == nil {
		s.data.Macros[mc.CampaignID] = make(map[string]model.Macro)
	}
	s.data.Macros[mc.CampaignID][mc.ID] = deepCopy(mc)
	return s.flushLocked()
}

func (s *FileStore) DeleteMacro(_ context.Context, campaignID, macroID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Macros[campaignID][macroID]; !ok {
		return ErrNotFound
	}
	delete(s.data.Macros[campaignID], macroID)
	return s.flushLocked()
}

// --- Voice Channels ---

func (s *FileStore) ListVoiceChannels(_ context.Context, campaignID string) ([]model.VoiceChannel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.data.VoiceChannels[campaignID]
	out := make([]model.VoiceChannel, 0, len(m))
	for _, ch := range m {
		cp := deepCopy(ch)
		cp.Participants = []model.VoiceParticipant{}
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDefault != out[j].IsDefault {
			return out[i].IsDefault
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (s *FileStore) GetVoiceChannel(_ context.Context, campaignID, channelID string) (model.VoiceChannel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ch, ok := s.data.VoiceChannels[campaignID][channelID]
	if !ok {
		return model.VoiceChannel{}, ErrNotFound
	}
	cp := deepCopy(ch)
	cp.Participants = []model.VoiceParticipant{}
	return cp, nil
}

func (s *FileStore) UpsertVoiceChannel(_ context.Context, ch model.VoiceChannel) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.VoiceChannels[ch.CampaignID] == nil {
		s.data.VoiceChannels[ch.CampaignID] = make(map[string]model.VoiceChannel)
	}
	cp := deepCopy(ch)
	cp.Participants = nil
	s.data.VoiceChannels[ch.CampaignID][ch.ID] = cp
	return s.flushLocked()
}

func (s *FileStore) DeleteVoiceChannel(_ context.Context, campaignID, channelID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.VoiceChannels[campaignID][channelID]; !ok {
		return ErrNotFound
	}
	delete(s.data.VoiceChannels[campaignID], channelID)
	return s.flushLocked()
}
