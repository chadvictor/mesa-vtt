package store

import (
	"context"
	"errors"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// Store defines the persistence contract implemented by both FileStore and PostgresStore.
type Store interface {
	// Campaigns
	ListCampaigns(ctx context.Context) ([]model.Campaign, error)
	GetCampaign(ctx context.Context, id string) (model.Campaign, error)
	GetCampaignByInviteCode(ctx context.Context, code string) (model.Campaign, error)
	CreateCampaign(ctx context.Context, c model.Campaign) error
	UpdateCampaign(ctx context.Context, c model.Campaign) error
	DeleteCampaign(ctx context.Context, id string) error

	// Members
	ListMembers(ctx context.Context, campaignID string) ([]model.CampaignMember, error)
	GetMember(ctx context.Context, campaignID, userID string) (model.CampaignMember, error)
	UpsertMember(ctx context.Context, m model.CampaignMember) error
	DeleteMember(ctx context.Context, campaignID, userID string) error

	// Folders
	ListFolders(ctx context.Context, campaignID string) ([]model.Folder, error)
	GetFolder(ctx context.Context, campaignID, folderID string) (model.Folder, error)
	UpsertFolder(ctx context.Context, f model.Folder) error
	DeleteFolder(ctx context.Context, campaignID, folderID string) error

	// Documents
	ListDocuments(ctx context.Context, campaignID string) ([]model.Document, error)
	GetDocument(ctx context.Context, campaignID, docID string) (model.Document, error)
	UpsertDocument(ctx context.Context, d model.Document) error
	DeleteDocument(ctx context.Context, campaignID, docID string) error

	// Characters
	ListCharacters(ctx context.Context, campaignID string) ([]model.Character, error)
	GetCharacter(ctx context.Context, campaignID, charID string) (model.Character, error)
	UpsertCharacter(ctx context.Context, c model.Character) error
	DeleteCharacter(ctx context.Context, campaignID, charID string) error

	// Scenes
	ListScenes(ctx context.Context, campaignID string) ([]model.Scene, error)
	GetScene(ctx context.Context, campaignID, sceneID string) (model.Scene, error)
	UpsertScene(ctx context.Context, s model.Scene) error
	DeleteScene(ctx context.Context, campaignID, sceneID string) error

	// Chat Messages
	ListMessages(ctx context.Context, campaignID string, limit int) ([]model.ChatMessage, error)
	GetMessage(ctx context.Context, campaignID, messageID string) (model.ChatMessage, error)
	CreateMessage(ctx context.Context, msg model.ChatMessage) error
	UpdateMessage(ctx context.Context, msg model.ChatMessage) error

	// Macros
	ListMacros(ctx context.Context, campaignID string) ([]model.Macro, error)
	GetMacro(ctx context.Context, campaignID, macroID string) (model.Macro, error)
	UpsertMacro(ctx context.Context, m model.Macro) error
	DeleteMacro(ctx context.Context, campaignID, macroID string) error

	// Voice Channels
	ListVoiceChannels(ctx context.Context, campaignID string) ([]model.VoiceChannel, error)
	GetVoiceChannel(ctx context.Context, campaignID, channelID string) (model.VoiceChannel, error)
	UpsertVoiceChannel(ctx context.Context, ch model.VoiceChannel) error
	DeleteVoiceChannel(ctx context.Context, campaignID, channelID string) error

	Close() error
}
