package dice

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/chadvictor/mesa-vtt/data"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

const (
	TagmarColorErroCritico = "erro_critico"
	TagmarColorFalha       = "falha"
	TagmarColorVerde       = "verde"
	TagmarColorAmarelo     = "amarelo"
	TagmarColorLaranja     = "laranja"
	TagmarColorVermelho    = "vermelho"
	TagmarColorAzul        = "azul"
)

var tagmarHitTiers = []string{
	TagmarColorVerde,
	TagmarColorAmarelo,
	TagmarColorLaranja,
	TagmarColorVermelho,
	TagmarColorAzul,
}

type tagmarRange [2]int

type tagmarColumnRow struct {
	ErroCritico *tagmarRange `json:"erroCritico"`
	Falha       *tagmarRange `json:"falha"`
	Verde       *tagmarRange `json:"verde"`
	Amarelo     *tagmarRange `json:"amarelo"`
	Laranja     *tagmarRange `json:"laranja"`
	Vermelho    *tagmarRange `json:"vermelho"`
	Azul        *tagmarRange `json:"azul"`
}

type tagmarRulesTables struct {
	ResolutionTable struct {
		MinColumn    int `json:"minColumn"`
		MaxColumn    int `json:"maxColumn"`
		OverflowRule struct {
			AboveMaxColumn struct {
				Step                    int `json:"step"`
				BonusDamageTiersPerStep int `json:"bonusDamageTiersPerStep"`
			} `json:"aboveMaxColumn"`
		} `json:"overflowRule"`
		ByColumn map[string]tagmarColumnRow `json:"byColumn"`
	} `json:"resolutionTable"`
	ResistanceTable struct {
		Matrix map[string]map[string]int `json:"matrix"`
	} `json:"resistanceTable"`
}

var (
	tagmarTablesOnce sync.Once
	tagmarTables     tagmarRulesTables
	tagmarTablesErr  error
)

func loadTagmarTables() (*tagmarRulesTables, error) {
	tagmarTablesOnce.Do(func() {
		raw, err := data.TagmarFS.ReadFile("tagmar/rules.json")
		if err != nil {
			tagmarTablesErr = fmt.Errorf("read embedded tagmar/rules.json: %w", err)
			return
		}
		if err := json.Unmarshal(raw, &tagmarTables); err != nil {
			tagmarTablesErr = fmt.Errorf("parse embedded tagmar/rules.json: %w", err)
			return
		}
		if tagmarTables.ResolutionTable.OverflowRule.AboveMaxColumn.Step <= 0 {
			tagmarTables.ResolutionTable.OverflowRule.AboveMaxColumn.Step = 20
		}
		if tagmarTables.ResolutionTable.OverflowRule.AboveMaxColumn.BonusDamageTiersPerStep <= 0 {
			tagmarTables.ResolutionTable.OverflowRule.AboveMaxColumn.BonusDamageTiersPerStep = 2
		}
	})
	if tagmarTablesErr != nil {
		return nil, tagmarTablesErr
	}
	return &tagmarTables, nil
}

// IsTagmarSystem reports whether systemID identifies Tagmar 3.0 (including canonical aliases).
func IsTagmarSystem(systemID string) bool {
	switch strings.ToLower(strings.TrimSpace(systemID)) {
	case "tagmar-3", "tagmar", "tagmar-3e", "tagmar-3.0":
		return true
	default:
		return false
	}
}

// TagmarResolution holds the authoritative evaluation of a 1d20 roll on Tagmar 3.0's Tabela de Resolução.
type TagmarResolution struct {
	D20             int
	Column          int
	EffectiveColumn int
	OverflowSteps   int
	OverflowTiers   int
	BaseColor       string
	Color           string
	DamageTier      int
	Percent         int
	Label           string
	OutcomeKind     string
	IsSuccess       bool
	IsCritical      bool
	IsFumble        bool
	DirectToEf      bool
}

func inTagmarRange(v int, r *tagmarRange) bool {
	return r != nil && v >= r[0] && v <= r[1]
}

// ResolveTagmarColumn resolves a 1d20 roll against Tagmar 3.0's embedded Tabela de Resolução (-7..20 + >20 overflow).
func ResolveTagmarColumn(d20, column int) (TagmarResolution, error) {
	tbl, err := loadTagmarTables()
	if err != nil {
		return TagmarResolution{}, err
	}

	if d20 < 1 {
		d20 = 1
	} else if d20 > 20 {
		d20 = 20
	}

	minCol := tbl.ResolutionTable.MinColumn
	maxCol := tbl.ResolutionTable.MaxColumn
	step := tbl.ResolutionTable.OverflowRule.AboveMaxColumn.Step
	bonusTiersPerStep := tbl.ResolutionTable.OverflowRule.AboveMaxColumn.BonusDamageTiersPerStep

	effectiveCol := column
	overflowSteps := 0
	if effectiveCol < minCol {
		effectiveCol = minCol
	} else if effectiveCol > maxCol {
		for effectiveCol > maxCol {
			effectiveCol -= step
			overflowSteps++
		}
		if effectiveCol < 1 {
			effectiveCol = 1
		}
	}

	overflowTiers := overflowSteps * bonusTiersPerStep
	row, ok := tbl.ResolutionTable.ByColumn[strconv.Itoa(effectiveCol)]
	if !ok {
		row = tbl.ResolutionTable.ByColumn[strconv.Itoa(minCol)]
	}

	baseColor := TagmarColorFalha
	switch {
	case inTagmarRange(d20, row.ErroCritico):
		baseColor = TagmarColorErroCritico
	case inTagmarRange(d20, row.Falha):
		baseColor = TagmarColorFalha
	case inTagmarRange(d20, row.Verde):
		baseColor = TagmarColorVerde
	case inTagmarRange(d20, row.Amarelo):
		baseColor = TagmarColorAmarelo
	case inTagmarRange(d20, row.Laranja):
		baseColor = TagmarColorLaranja
	case inTagmarRange(d20, row.Vermelho):
		baseColor = TagmarColorVermelho
	case inTagmarRange(d20, row.Azul):
		baseColor = TagmarColorAzul
	}

	finalColor := baseColor
	excessOverflow := 0

	if overflowTiers > 0 && baseColor != TagmarColorErroCritico {
		if baseColor == TagmarColorFalha {
			idx := overflowTiers - 1
			if idx >= len(tagmarHitTiers) {
				finalColor = TagmarColorAzul
				excessOverflow = idx - (len(tagmarHitTiers) - 1)
			} else {
				finalColor = tagmarHitTiers[idx]
			}
		} else {
			baseIdx := tagmarHitTierIndex(baseColor)
			promoted := baseIdx + overflowTiers
			if promoted >= len(tagmarHitTiers) {
				finalColor = TagmarColorAzul
				excessOverflow = promoted - (len(tagmarHitTiers) - 1)
			} else {
				finalColor = tagmarHitTiers[promoted]
			}
		}
	}

	damageTier := 0
	if finalColor != TagmarColorErroCritico && finalColor != TagmarColorFalha {
		damageTier = tagmarHitTierIndex(finalColor) + 1 + excessOverflow
	}
	percent := damageTier * 25

	res := TagmarResolution{
		D20:             d20,
		Column:          column,
		EffectiveColumn: effectiveCol,
		OverflowSteps:   overflowSteps,
		OverflowTiers:   overflowTiers,
		BaseColor:       baseColor,
		Color:           finalColor,
		DamageTier:      damageTier,
		Percent:         percent,
		IsSuccess:       damageTier > 0,
		IsCritical:      finalColor == TagmarColorAzul,
		IsFumble:        finalColor == TagmarColorErroCritico,
		DirectToEf:      finalColor == TagmarColorAzul,
	}

	switch finalColor {
	case TagmarColorErroCritico:
		res.OutcomeKind = "fumble"
		res.Label = "ERRO CRÍTICO!"
	case TagmarColorFalha:
		res.OutcomeKind = "failure"
		res.Label = "FALHA"
	case TagmarColorVerde:
		res.OutcomeKind = "success"
		res.Label = "VERDE (25%)"
	case TagmarColorAmarelo:
		res.OutcomeKind = "success"
		res.Label = "AMARELO (50%)"
	case TagmarColorLaranja:
		res.OutcomeKind = "success"
		res.Label = "LARANJA (75%)"
	case TagmarColorVermelho:
		res.OutcomeKind = "success"
		res.Label = "VERMELHO (100%)"
	case TagmarColorAzul:
		res.OutcomeKind = "critical"
		if excessOverflow > 0 {
			res.Label = fmt.Sprintf("AZUL — CRÍTICO! (%d%% · EF)", percent)
		} else {
			res.Label = "AZUL — CRÍTICO! (125% · EF)"
		}
	}

	return res, nil
}

func tagmarHitTierIndex(color string) int {
	for i, c := range tagmarHitTiers {
		if c == color {
			return i
		}
	}
	return 0
}

// TagmarResistanceTarget returns the official Tagmar 3.0 1d20 target number for Force of Attack (fa) vs Force of Defense (fd).
func TagmarResistanceTarget(fa, fd int) (int, error) {
	tbl, err := loadTagmarTables()
	if err != nil {
		return 0, err
	}
	if row, ok := tbl.ResistanceTable.Matrix[strconv.Itoa(fd)]; ok {
		if target, exists := row[strconv.Itoa(fa)]; exists {
			return target, nil
		}
	}

	// Exact Tagmar 3.0 piecewise formula outside matrix bounds (matches all 460 matrix cells).
	d := fa - fd
	var target int
	switch {
	case d >= -4 && d <= 4:
		target = 11 + d
	case d > 4:
		target = 15 + (d-4)/2
	default:
		target = 7 - (-d-4)/2
	}
	if target < 2 {
		target = 2
	} else if target > 20 {
		target = 20
	}
	return target, nil
}

// ResolveTagmarResistance evaluates a 1d20 RF/RM resistance roll against Tagmar 3.0's embedded Tabela de Resistências.
func ResolveTagmarResistance(d20 int, req model.TagmarResistanceRequest) (model.TagmarResistanceResult, error) {
	if d20 < 1 {
		d20 = 1
	} else if d20 > 20 {
		d20 = 20
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if kind != "rm" {
		kind = "rf"
	}
	target, err := TagmarResistanceTarget(req.FA, req.FD)
	if err != nil {
		return model.TagmarResistanceResult{}, err
	}

	var resisted bool
	switch {
	case d20 == 20:
		resisted = true
	case d20 == 1:
		resisted = false
	default:
		resisted = d20 >= target
	}

	return model.TagmarResistanceResult{
		Kind:     kind,
		FA:       req.FA,
		FD:       req.FD,
		Target:   target,
		Resisted: resisted,
	}, nil
}

// extractTagmarFromMeta parses optional tagmarColumn / tagmarResistance keys from systemMeta when not set top-level.
func extractTagmarFromMeta(meta map[string]any) (*int, *model.TagmarResistanceRequest) {
	if len(meta) == 0 {
		return nil, nil
	}
	var col *int
	for _, key := range []string{"tagmarColumn", "column"} {
		if raw, ok := meta[key]; ok {
			if n, valid := toInt(raw); valid {
				col = &n
				break
			}
		}
	}
	var resReq *model.TagmarResistanceRequest
	for _, key := range []string{"tagmarResistance", "resistance"} {
		if raw, ok := meta[key]; ok {
			if m, isMap := raw.(map[string]any); isMap {
				kind, _ := m["kind"].(string)
				fa, hasFA := toInt(m["fa"])
				fd, hasFD := toInt(m["fd"])
				if hasFA || hasFD || kind != "" {
					resReq = &model.TagmarResistanceRequest{
						Kind: kind,
						FA:   fa,
						FD:   fd,
					}
					break
				}
			}
		}
	}
	return col, resReq
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i), true
		}
	}
	return 0, false
}
