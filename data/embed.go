package data

import "embed"

// MightyBladeFS embeds all verified Mighty Blade 3ª Edição compendium JSON files.
//
//go:embed mighty-blade/*.json
var MightyBladeFS embed.FS

// TagmarFS embeds all verified Tagmar 3.0 + Expansions compendium JSON files and license notice.
//
//go:embed tagmar/*.json tagmar/LICENSE.md
var TagmarFS embed.FS
