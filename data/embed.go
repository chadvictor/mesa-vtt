package data

import "embed"

// MightyBladeFS embeds all verified Mighty Blade 3ª Edição compendium JSON files.
//
//go:embed mighty-blade/*.json
var MightyBladeFS embed.FS
