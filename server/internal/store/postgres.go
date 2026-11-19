package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

const pgSchema = `
CREATE TABLE IF NOT EXISTS mesa_campaigns (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	system_id TEXT NOT NULL,
	cover_url TEXT NOT NULL DEFAULT '',
	invite_code TEXT NOT NULL UNIQUE,
	privacy TEXT NOT NULL DEFAULT 'public',
	owner_user_id TEXT NOT NULL,
	active_scene_id TEXT,
	combat_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mesa_members (
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	display_name TEXT NOT NULL,
	avatar_url TEXT NOT NULL DEFAULT '',
	role TEXT NOT NULL,
	active_character_id TEXT NOT NULL DEFAULT '',
	joined_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS mesa_folders (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	parent_id TEXT,
	name TEXT NOT NULL,
	icon TEXT NOT NULL DEFAULT '',
	sort_order INT NOT NULL DEFAULT 0,
	visibility TEXT NOT NULL DEFAULT 'gm_only',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mesa_documents (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	folder_id TEXT,
	kind TEXT NOT NULL DEFAULT 'note',
	title TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	image_url TEXT NOT NULL DEFAULT '',
	tags JSONB NOT NULL DEFAULT '[]'::jsonb,
	visibility TEXT NOT NULL DEFAULT 'gm_only',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_by TEXT NOT NULL DEFAULT '',
	updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mesa_characters (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	system_id TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'pc',
	name TEXT NOT NULL,
	subtitle TEXT NOT NULL DEFAULT '',
	portrait_url TEXT NOT NULL DEFAULT '',
	owner_user_id TEXT,
	controlled_by JSONB NOT NULL DEFAULT '[]'::jsonb,
	resources JSONB NOT NULL DEFAULT '{}'::jsonb,
	conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
	system_data JSONB NOT NULL DEFAULT '{}'::jsonb,
	computed JSONB NOT NULL DEFAULT '{}'::jsonb,
	visibility TEXT NOT NULL DEFAULT 'all_players',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mesa_scenes (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	image_url TEXT NOT NULL DEFAULT '',
	width INT NOT NULL DEFAULT 1600,
	height INT NOT NULL DEFAULT 1200,
	grid_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	fog_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	tokens_json JSONB NOT NULL DEFAULT '[]'::jsonb,
	visibility TEXT NOT NULL DEFAULT 'all_players',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mesa_chat_messages (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	sender_user_id TEXT NOT NULL,
	sender_name TEXT NOT NULL,
	character_id TEXT NOT NULL DEFAULT '',
	character_name TEXT NOT NULL DEFAULT '',
	portrait_url TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL DEFAULT '',
	roll_json JSONB,
	actions_json JSONB,
	visibility TEXT NOT NULL DEFAULT 'all_players',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mesa_chat_campaign_created
	ON mesa_chat_messages (campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mesa_macros (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	icon TEXT NOT NULL DEFAULT '',
	color TEXT NOT NULL DEFAULT '',
	scope TEXT NOT NULL DEFAULT 'campaign',
	character_id TEXT NOT NULL DEFAULT '',
	script TEXT NOT NULL DEFAULT '',
	visibility TEXT NOT NULL DEFAULT 'all_players',
	visible_to JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mesa_voice_channels (
	id TEXT PRIMARY KEY,
	campaign_id TEXT NOT NULL REFERENCES mesa_campaigns(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	is_default BOOLEAN NOT NULL DEFAULT FALSE,
	locked_for_players BOOLEAN NOT NULL DEFAULT FALSE
);
`

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if _, err := pool.Exec(ctx, pgSchema); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() error {
	s.pool.Close()
	return nil
}

func mapPGError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return err
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// --- Campaigns ---

func (s *PostgresStore) ListCampaigns(ctx context.Context) ([]model.Campaign, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, system_id, cover_url, invite_code, privacy,
		       owner_user_id, active_scene_id, combat_json, settings_json, created_at, updated_at
		FROM mesa_campaigns ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []model.Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetCampaign(ctx context.Context, id string) (model.Campaign, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, description, system_id, cover_url, invite_code, privacy,
		       owner_user_id, active_scene_id, combat_json, settings_json, created_at, updated_at
		FROM mesa_campaigns WHERE id = $1`, id)
	c, err := scanCampaign(row)
	return c, mapPGError(err)
}

func (s *PostgresStore) GetCampaignByInviteCode(ctx context.Context, code string) (model.Campaign, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, description, system_id, cover_url, invite_code, privacy,
		       owner_user_id, active_scene_id, combat_json, settings_json, created_at, updated_at
		FROM mesa_campaigns WHERE UPPER(invite_code) = $1`, strings.ToUpper(strings.TrimSpace(code)))
	c, err := scanCampaign(row)
	return c, mapPGError(err)
}

func scanCampaign(row pgx.Row) (model.Campaign, error) {
	var c model.Campaign
	var combatRaw, settingsRaw []byte
	err := row.Scan(
		&c.ID, &c.Name, &c.Description, &c.SystemID, &c.CoverURL, &c.InviteCode, &c.Privacy,
		&c.OwnerUserID, &c.ActiveSceneID, &combatRaw, &settingsRaw, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return model.Campaign{}, err
	}
	_ = json.Unmarshal(combatRaw, &c.Combat)
	if c.Combat.Combatants == nil {
		c.Combat.Combatants = []model.Combatant{}
	}
	_ = json.Unmarshal(settingsRaw, &c.Settings)
	return c, nil
}

func (s *PostgresStore) CreateCampaign(ctx context.Context, c model.Campaign) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_campaigns
			(id, name, description, system_id, cover_url, invite_code, privacy, owner_user_id, active_scene_id, combat_json, settings_json, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		c.ID, c.Name, c.Description, c.SystemID, c.CoverURL, strings.ToUpper(c.InviteCode), c.Privacy,
		c.OwnerUserID, c.ActiveSceneID, mustJSON(c.Combat), mustJSON(c.Settings), c.CreatedAt, c.UpdatedAt,
	)
	return mapPGError(err)
}

func (s *PostgresStore) UpdateCampaign(ctx context.Context, c model.Campaign) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE mesa_campaigns
		SET name=$2, description=$3, system_id=$4, cover_url=$5, invite_code=$6, privacy=$7,
		    owner_user_id=$8, active_scene_id=$9, combat_json=$10, settings_json=$11, updated_at=$12
		WHERE id=$1`,
		c.ID, c.Name, c.Description, c.SystemID, c.CoverURL, strings.ToUpper(c.InviteCode), c.Privacy,
		c.OwnerUserID, c.ActiveSceneID, mustJSON(c.Combat), mustJSON(c.Settings), c.UpdatedAt,
	)
	if err != nil {
		return mapPGError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) DeleteCampaign(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_campaigns WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Members ---

func (s *PostgresStore) ListMembers(ctx context.Context, campaignID string) ([]model.CampaignMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT campaign_id, user_id, display_name, avatar_url, role, active_character_id, joined_at
		FROM mesa_members WHERE campaign_id=$1 ORDER BY joined_at ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.CampaignMember{}
	for rows.Next() {
		var m model.CampaignMember
		var role string
		if err := rows.Scan(&m.CampaignID, &m.UserID, &m.DisplayName, &m.AvatarURL, &role, &m.ActiveCharacterID, &m.JoinedAt); err != nil {
			return nil, err
		}
		m.Role = model.MemberRole(role)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetMember(ctx context.Context, campaignID, userID string) (model.CampaignMember, error) {
	var m model.CampaignMember
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT campaign_id, user_id, display_name, avatar_url, role, active_character_id, joined_at
		FROM mesa_members WHERE campaign_id=$1 AND user_id=$2`, campaignID, userID).
		Scan(&m.CampaignID, &m.UserID, &m.DisplayName, &m.AvatarURL, &role, &m.ActiveCharacterID, &m.JoinedAt)
	if err != nil {
		return model.CampaignMember{}, mapPGError(err)
	}
	m.Role = model.MemberRole(role)
	return m, nil
}

func (s *PostgresStore) UpsertMember(ctx context.Context, m model.CampaignMember) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_members (campaign_id, user_id, display_name, avatar_url, role, active_character_id, joined_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (campaign_id, user_id) DO UPDATE SET
			display_name=EXCLUDED.display_name,
			avatar_url=EXCLUDED.avatar_url,
			role=EXCLUDED.role,
			active_character_id=EXCLUDED.active_character_id`,
		m.CampaignID, m.UserID, m.DisplayName, m.AvatarURL, string(m.Role), m.ActiveCharacterID, m.JoinedAt,
	)
	return err
}

func (s *PostgresStore) DeleteMember(ctx context.Context, campaignID, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM mesa_members WHERE campaign_id=$1 AND user_id=$2`, campaignID, userID)
	return err
}

// --- Folders ---

func (s *PostgresStore) ListFolders(ctx context.Context, campaignID string) ([]model.Folder, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, parent_id, name, icon, sort_order, visibility, visible_to, created_by
		FROM mesa_folders WHERE campaign_id=$1 ORDER BY sort_order ASC, name ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Folder{}
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetFolder(ctx context.Context, campaignID, folderID string) (model.Folder, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, parent_id, name, icon, sort_order, visibility, visible_to, created_by
		FROM mesa_folders WHERE campaign_id=$1 AND id=$2`, campaignID, folderID)
	f, err := scanFolder(row)
	return f, mapPGError(err)
}

func scanFolder(row pgx.Row) (model.Folder, error) {
	var f model.Folder
	var vis string
	var visTo []byte
	if err := row.Scan(&f.ID, &f.CampaignID, &f.ParentID, &f.Name, &f.Icon, &f.SortOrder, &vis, &visTo, &f.CreatedBy); err != nil {
		return model.Folder{}, err
	}
	f.Visibility = model.Visibility(vis)
	_ = json.Unmarshal(visTo, &f.VisibleToUserIDs)
	return f, nil
}

func (s *PostgresStore) UpsertFolder(ctx context.Context, f model.Folder) error {
	visTo := f.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_folders (id, campaign_id, parent_id, name, icon, sort_order, visibility, visible_to, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (id) DO UPDATE SET
			parent_id=EXCLUDED.parent_id, name=EXCLUDED.name, icon=EXCLUDED.icon,
			sort_order=EXCLUDED.sort_order, visibility=EXCLUDED.visibility, visible_to=EXCLUDED.visible_to`,
		f.ID, f.CampaignID, f.ParentID, f.Name, f.Icon, f.SortOrder, string(f.Visibility), mustJSON(visTo), f.CreatedBy,
	)
	return err
}

func (s *PostgresStore) DeleteFolder(ctx context.Context, campaignID, folderID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_folders WHERE campaign_id=$1 AND id=$2`, campaignID, folderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Documents ---

func (s *PostgresStore) ListDocuments(ctx context.Context, campaignID string) ([]model.Document, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, folder_id, kind, title, content, image_url, tags, visibility, visible_to, created_by, updated_at
		FROM mesa_documents WHERE campaign_id=$1 ORDER BY title ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Document{}
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetDocument(ctx context.Context, campaignID, docID string) (model.Document, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, folder_id, kind, title, content, image_url, tags, visibility, visible_to, created_by, updated_at
		FROM mesa_documents WHERE campaign_id=$1 AND id=$2`, campaignID, docID)
	d, err := scanDocument(row)
	return d, mapPGError(err)
}

func scanDocument(row pgx.Row) (model.Document, error) {
	var d model.Document
	var kind, vis string
	var tagsRaw, visToRaw []byte
	if err := row.Scan(&d.ID, &d.CampaignID, &d.FolderID, &kind, &d.Title, &d.Content, &d.ImageURL, &tagsRaw, &vis, &visToRaw, &d.CreatedBy, &d.UpdatedAt); err != nil {
		return model.Document{}, err
	}
	d.Kind = model.DocumentKind(kind)
	d.Visibility = model.Visibility(vis)
	_ = json.Unmarshal(tagsRaw, &d.Tags)
	_ = json.Unmarshal(visToRaw, &d.VisibleToUserIDs)
	return d, nil
}

func (s *PostgresStore) UpsertDocument(ctx context.Context, d model.Document) error {
	tags := d.Tags
	if tags == nil {
		tags = []string{}
	}
	visTo := d.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_documents (id, campaign_id, folder_id, kind, title, content, image_url, tags, visibility, visible_to, created_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET
			folder_id=EXCLUDED.folder_id, kind=EXCLUDED.kind, title=EXCLUDED.title,
			content=EXCLUDED.content, image_url=EXCLUDED.image_url, tags=EXCLUDED.tags,
			visibility=EXCLUDED.visibility, visible_to=EXCLUDED.visible_to, updated_at=EXCLUDED.updated_at`,
		d.ID, d.CampaignID, d.FolderID, string(d.Kind), d.Title, d.Content, d.ImageURL,
		mustJSON(tags), string(d.Visibility), mustJSON(visTo), d.CreatedBy, d.UpdatedAt,
	)
	return err
}

func (s *PostgresStore) DeleteDocument(ctx context.Context, campaignID, docID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_documents WHERE campaign_id=$1 AND id=$2`, campaignID, docID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Characters ---

func (s *PostgresStore) ListCharacters(ctx context.Context, campaignID string) ([]model.Character, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, system_id, kind, name, subtitle, portrait_url, owner_user_id,
		       controlled_by, resources, conditions, system_data, computed, visibility, visible_to, updated_at
		FROM mesa_characters WHERE campaign_id=$1 ORDER BY kind ASC, name ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Character{}
	for rows.Next() {
		c, err := scanCharacter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetCharacter(ctx context.Context, campaignID, charID string) (model.Character, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, system_id, kind, name, subtitle, portrait_url, owner_user_id,
		       controlled_by, resources, conditions, system_data, computed, visibility, visible_to, updated_at
		FROM mesa_characters WHERE campaign_id=$1 AND id=$2`, campaignID, charID)
	c, err := scanCharacter(row)
	return c, mapPGError(err)
}

func scanCharacter(row pgx.Row) (model.Character, error) {
	var c model.Character
	var kind, vis string
	var ctrlRaw, resRaw, condRaw, sysRaw, compRaw, visToRaw []byte
	if err := row.Scan(
		&c.ID, &c.CampaignID, &c.SystemID, &kind, &c.Name, &c.Subtitle, &c.PortraitURL, &c.OwnerUserID,
		&ctrlRaw, &resRaw, &condRaw, &sysRaw, &compRaw, &vis, &visToRaw, &c.UpdatedAt,
	); err != nil {
		return model.Character{}, err
	}
	c.Kind = model.CharacterKind(kind)
	c.Visibility = model.Visibility(vis)
	_ = json.Unmarshal(ctrlRaw, &c.ControlledByUserIDs)
	_ = json.Unmarshal(resRaw, &c.Resources)
	_ = json.Unmarshal(condRaw, &c.Conditions)
	_ = json.Unmarshal(sysRaw, &c.SystemData)
	_ = json.Unmarshal(compRaw, &c.Computed)
	_ = json.Unmarshal(visToRaw, &c.VisibleToUserIDs)
	if c.ControlledByUserIDs == nil {
		c.ControlledByUserIDs = []string{}
	}
	if c.Resources == nil {
		c.Resources = map[string]model.ResourceBar{}
	}
	if c.Conditions == nil {
		c.Conditions = []model.ActiveCondition{}
	}
	if c.SystemData == nil {
		c.SystemData = map[string]any{}
	}
	if c.Computed == nil {
		c.Computed = map[string]any{}
	}
	return c, nil
}

func (s *PostgresStore) UpsertCharacter(ctx context.Context, c model.Character) error {
	ctrl := c.ControlledByUserIDs
	if ctrl == nil {
		ctrl = []string{}
	}
	conds := c.Conditions
	if conds == nil {
		conds = []model.ActiveCondition{}
	}
	res := c.Resources
	if res == nil {
		res = map[string]model.ResourceBar{}
	}
	sys := c.SystemData
	if sys == nil {
		sys = map[string]any{}
	}
	comp := c.Computed
	if comp == nil {
		comp = map[string]any{}
	}
	visTo := c.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_characters
			(id, campaign_id, system_id, kind, name, subtitle, portrait_url, owner_user_id,
			 controlled_by, resources, conditions, system_data, computed, visibility, visible_to, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		ON CONFLICT (id) DO UPDATE SET
			kind=EXCLUDED.kind, name=EXCLUDED.name, subtitle=EXCLUDED.subtitle, portrait_url=EXCLUDED.portrait_url,
			owner_user_id=EXCLUDED.owner_user_id, controlled_by=EXCLUDED.controlled_by,
			resources=EXCLUDED.resources, conditions=EXCLUDED.conditions, system_data=EXCLUDED.system_data,
			computed=EXCLUDED.computed, visibility=EXCLUDED.visibility, visible_to=EXCLUDED.visible_to,
			updated_at=EXCLUDED.updated_at`,
		c.ID, c.CampaignID, c.SystemID, string(c.Kind), c.Name, c.Subtitle, c.PortraitURL, c.OwnerUserID,
		mustJSON(ctrl), mustJSON(res), mustJSON(conds), mustJSON(sys), mustJSON(comp),
		string(c.Visibility), mustJSON(visTo), c.UpdatedAt,
	)
	return err
}

func (s *PostgresStore) DeleteCharacter(ctx context.Context, campaignID, charID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_characters WHERE campaign_id=$1 AND id=$2`, campaignID, charID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Scenes ---

func (s *PostgresStore) ListScenes(ctx context.Context, campaignID string) ([]model.Scene, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, name, image_url, width, height, grid_json, fog_json, tokens_json, visibility, visible_to, updated_at
		FROM mesa_scenes WHERE campaign_id=$1 ORDER BY name ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Scene{}
	for rows.Next() {
		sc, err := scanScene(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetScene(ctx context.Context, campaignID, sceneID string) (model.Scene, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, name, image_url, width, height, grid_json, fog_json, tokens_json, visibility, visible_to, updated_at
		FROM mesa_scenes WHERE campaign_id=$1 AND id=$2`, campaignID, sceneID)
	sc, err := scanScene(row)
	return sc, mapPGError(err)
}

func scanScene(row pgx.Row) (model.Scene, error) {
	var sc model.Scene
	var vis string
	var gridRaw, fogRaw, tokensRaw, visToRaw []byte
	if err := row.Scan(
		&sc.ID, &sc.CampaignID, &sc.Name, &sc.ImageURL, &sc.Width, &sc.Height,
		&gridRaw, &fogRaw, &tokensRaw, &vis, &visToRaw, &sc.UpdatedAt,
	); err != nil {
		return model.Scene{}, err
	}
	sc.Visibility = model.Visibility(vis)
	_ = json.Unmarshal(gridRaw, &sc.Grid)
	_ = json.Unmarshal(fogRaw, &sc.Fog)
	_ = json.Unmarshal(tokensRaw, &sc.Tokens)
	_ = json.Unmarshal(visToRaw, &sc.VisibleToUserIDs)
	if sc.Tokens == nil {
		sc.Tokens = []model.Token{}
	}
	return sc, nil
}

func (s *PostgresStore) UpsertScene(ctx context.Context, sc model.Scene) error {
	tokens := sc.Tokens
	if tokens == nil {
		tokens = []model.Token{}
	}
	visTo := sc.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_scenes
			(id, campaign_id, name, image_url, width, height, grid_json, fog_json, tokens_json, visibility, visible_to, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET
			name=EXCLUDED.name, image_url=EXCLUDED.image_url, width=EXCLUDED.width, height=EXCLUDED.height,
			grid_json=EXCLUDED.grid_json, fog_json=EXCLUDED.fog_json, tokens_json=EXCLUDED.tokens_json,
			visibility=EXCLUDED.visibility, visible_to=EXCLUDED.visible_to, updated_at=EXCLUDED.updated_at`,
		sc.ID, sc.CampaignID, sc.Name, sc.ImageURL, sc.Width, sc.Height,
		mustJSON(sc.Grid), mustJSON(sc.Fog), mustJSON(tokens), string(sc.Visibility), mustJSON(visTo), sc.UpdatedAt,
	)
	return err
}

func (s *PostgresStore) DeleteScene(ctx context.Context, campaignID, sceneID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_scenes WHERE campaign_id=$1 AND id=$2`, campaignID, sceneID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Chat Messages ---

func (s *PostgresStore) ListMessages(ctx context.Context, campaignID string, limit int) ([]model.ChatMessage, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, kind, sender_user_id, sender_name, character_id, character_name,
		       portrait_url, content, roll_json, actions_json, visibility, visible_to, created_at
		FROM (
			SELECT * FROM mesa_chat_messages WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT $2
		) sub ORDER BY created_at ASC`, campaignID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.ChatMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetMessage(ctx context.Context, campaignID, messageID string) (model.ChatMessage, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, kind, sender_user_id, sender_name, character_id, character_name,
		       portrait_url, content, roll_json, actions_json, visibility, visible_to, created_at
		FROM mesa_chat_messages WHERE campaign_id=$1 AND id=$2`, campaignID, messageID)
	m, err := scanMessage(row)
	return m, mapPGError(err)
}

func scanMessage(row pgx.Row) (model.ChatMessage, error) {
	var m model.ChatMessage
	var kind, vis string
	var rollRaw, actionsRaw, visToRaw []byte
	if err := row.Scan(
		&m.ID, &m.CampaignID, &kind, &m.SenderUserID, &m.SenderName, &m.CharacterID, &m.CharacterName,
		&m.PortraitURL, &m.Content, &rollRaw, &actionsRaw, &vis, &visToRaw, &m.CreatedAt,
	); err != nil {
		return model.ChatMessage{}, err
	}
	m.Kind = model.ChatMessageKind(kind)
	m.Visibility = model.Visibility(vis)
	if len(rollRaw) > 0 && string(rollRaw) != "null" {
		var r model.RollResult
		if err := json.Unmarshal(rollRaw, &r); err == nil {
			m.Roll = &r
		}
	}
	if len(actionsRaw) > 0 && string(actionsRaw) != "null" {
		_ = json.Unmarshal(actionsRaw, &m.Actions)
	}
	_ = json.Unmarshal(visToRaw, &m.VisibleToUserIDs)
	return m, nil
}

func (s *PostgresStore) CreateMessage(ctx context.Context, msg model.ChatMessage) error {
	var rollArg, actionsArg []byte
	if msg.Roll != nil {
		rollArg = mustJSON(msg.Roll)
	}
	if len(msg.Actions) > 0 {
		actionsArg = mustJSON(msg.Actions)
	}
	visTo := msg.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_chat_messages
			(id, campaign_id, kind, sender_user_id, sender_name, character_id, character_name,
			 portrait_url, content, roll_json, actions_json, visibility, visible_to, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		msg.ID, msg.CampaignID, string(msg.Kind), msg.SenderUserID, msg.SenderName,
		msg.CharacterID, msg.CharacterName, msg.PortraitURL, msg.Content,
		rollArg, actionsArg, string(msg.Visibility), mustJSON(visTo), msg.CreatedAt,
	)
	return err
}

func (s *PostgresStore) UpdateMessage(ctx context.Context, msg model.ChatMessage) error {
	var actionsArg []byte
	if len(msg.Actions) > 0 {
		actionsArg = mustJSON(msg.Actions)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE mesa_chat_messages SET content=$3, actions_json=$4
		WHERE campaign_id=$1 AND id=$2`,
		msg.CampaignID, msg.ID, msg.Content, actionsArg,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Macros ---

func (s *PostgresStore) ListMacros(ctx context.Context, campaignID string) ([]model.Macro, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, name, icon, color, scope, character_id, script, visibility, visible_to, created_by
		FROM mesa_macros WHERE campaign_id=$1 ORDER BY name ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Macro{}
	for rows.Next() {
		mc, err := scanMacro(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, mc)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetMacro(ctx context.Context, campaignID, macroID string) (model.Macro, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, name, icon, color, scope, character_id, script, visibility, visible_to, created_by
		FROM mesa_macros WHERE campaign_id=$1 AND id=$2`, campaignID, macroID)
	mc, err := scanMacro(row)
	return mc, mapPGError(err)
}

func scanMacro(row pgx.Row) (model.Macro, error) {
	var mc model.Macro
	var vis string
	var visToRaw []byte
	if err := row.Scan(&mc.ID, &mc.CampaignID, &mc.Name, &mc.Icon, &mc.Color, &mc.Scope, &mc.CharacterID, &mc.Script, &vis, &visToRaw, &mc.CreatedBy); err != nil {
		return model.Macro{}, err
	}
	mc.Visibility = model.Visibility(vis)
	_ = json.Unmarshal(visToRaw, &mc.VisibleToUserIDs)
	return mc, nil
}

func (s *PostgresStore) UpsertMacro(ctx context.Context, mc model.Macro) error {
	visTo := mc.VisibleToUserIDs
	if visTo == nil {
		visTo = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_macros (id, campaign_id, name, icon, color, scope, character_id, script, visibility, visible_to, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (id) DO UPDATE SET
			name=EXCLUDED.name, icon=EXCLUDED.icon, color=EXCLUDED.color, scope=EXCLUDED.scope,
			character_id=EXCLUDED.character_id, script=EXCLUDED.script,
			visibility=EXCLUDED.visibility, visible_to=EXCLUDED.visible_to`,
		mc.ID, mc.CampaignID, mc.Name, mc.Icon, mc.Color, mc.Scope, mc.CharacterID, mc.Script,
		string(mc.Visibility), mustJSON(visTo), mc.CreatedBy,
	)
	return err
}

func (s *PostgresStore) DeleteMacro(ctx context.Context, campaignID, macroID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_macros WHERE campaign_id=$1 AND id=$2`, campaignID, macroID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Voice Channels ---

func (s *PostgresStore) ListVoiceChannels(ctx context.Context, campaignID string) ([]model.VoiceChannel, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, campaign_id, name, is_default, locked_for_players
		FROM mesa_voice_channels WHERE campaign_id=$1 ORDER BY is_default DESC, name ASC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.VoiceChannel{}
	for rows.Next() {
		var ch model.VoiceChannel
		if err := rows.Scan(&ch.ID, &ch.CampaignID, &ch.Name, &ch.IsDefault, &ch.LockedForPlayers); err != nil {
			return nil, err
		}
		ch.Participants = []model.VoiceParticipant{}
		out = append(out, ch)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetVoiceChannel(ctx context.Context, campaignID, channelID string) (model.VoiceChannel, error) {
	var ch model.VoiceChannel
	err := s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, name, is_default, locked_for_players
		FROM mesa_voice_channels WHERE campaign_id=$1 AND id=$2`, campaignID, channelID).
		Scan(&ch.ID, &ch.CampaignID, &ch.Name, &ch.IsDefault, &ch.LockedForPlayers)
	if err != nil {
		return model.VoiceChannel{}, mapPGError(err)
	}
	ch.Participants = []model.VoiceParticipant{}
	return ch, nil
}

func (s *PostgresStore) UpsertVoiceChannel(ctx context.Context, ch model.VoiceChannel) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mesa_voice_channels (id, campaign_id, name, is_default, locked_for_players)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (id) DO UPDATE SET
			name=EXCLUDED.name, is_default=EXCLUDED.is_default, locked_for_players=EXCLUDED.locked_for_players`,
		ch.ID, ch.CampaignID, ch.Name, ch.IsDefault, ch.LockedForPlayers,
	)
	return err
}

func (s *PostgresStore) DeleteVoiceChannel(ctx context.Context, campaignID, channelID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mesa_voice_channels WHERE campaign_id=$1 AND id=$2`, campaignID, channelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
