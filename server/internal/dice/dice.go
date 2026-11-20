package dice

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

const (
	MaxDiceCount  = 50
	MaxDiceSides  = 1000
	MinDiceSides  = 2
	MaxFormulaLen = 128
)

// Options customizes roll evaluation metadata (system, label, difficulty/DC, target defense, Tagmar resolution/resistance).
type Options struct {
	SystemID         string
	Label            string
	Difficulty       *int
	TargetDefense    *int
	TargetName       string
	SystemMeta       map[string]any
	TagmarColumn     *int
	TagmarResistance *model.TagmarResistanceRequest
}

type term struct {
	sign      int // +1 or -1
	isDice    bool
	count     int
	sides     int
	keepMode  string // "", "kh", "kl", "dh", "dl"
	keepCount int
	constant  int
}

var (
	diceTermRe = regexp.MustCompile(`^(\d*)[dD](\d+)(?:(kh|kl|dh|dl)(\d*))?$`)
	intTermRe  = regexp.MustCompile(`^\d+$`)
)

// Roll evaluates a dice formula authoritatively using crypto/rand.
func Roll(formula string, opts Options) (model.RollResult, error) {
	return RollWithRoller(formula, opts, cryptoDieRoller, cryptoSeed)
}

// DieRoller returns a value in [1, sides].
type DieRoller func(sides int) (int, error)

// SeedGenerator returns a uint32 seed for deterministic client 3D physics playback.
type SeedGenerator func() (uint32, error)

// RollWithRoller enables deterministic unit tests while production uses crypto/rand.
func RollWithRoller(formula string, opts Options, roller DieRoller, seedGen SeedGenerator) (model.RollResult, error) {
	raw := strings.TrimSpace(formula)
	if raw == "" {
		return model.RollResult{}, errors.New("formula is empty")
	}
	if len(raw) > MaxFormulaLen {
		return model.RollResult{}, fmt.Errorf("formula exceeds maximum length of %d", MaxFormulaLen)
	}

	terms, multiplier, err := parseFormula(raw)
	if err != nil {
		return model.RollResult{}, err
	}

	totalDiceCount := 0
	for _, t := range terms {
		if t.isDice {
			totalDiceCount += t.count
		}
	}
	if totalDiceCount > MaxDiceCount {
		return model.RollResult{}, fmt.Errorf("too many dice (max %d)", MaxDiceCount)
	}

	seed, err := seedGen()
	if err != nil {
		return model.RollResult{}, err
	}

	rolled := make([]model.RolledDie, 0, totalDiceCount)
	modifier := 0
	total := 0

	for _, t := range terms {
		if !t.isDice {
			delta := t.sign * t.constant
			modifier += delta
			total += delta
			continue
		}

		group := make([]model.RolledDie, t.count)
		for i := 0; i < t.count; i++ {
			v, err := roller(t.sides)
			if err != nil {
				return model.RollResult{}, err
			}
			if v < 1 || v > t.sides {
				return model.RollResult{}, fmt.Errorf("rolled value %d out of range 1..%d", v, t.sides)
			}
			group[i] = model.RolledDie{
				Sides: t.sides,
				Value: v,
			}
		}

		applyKeepDrop(group, t.keepMode, t.keepCount)

		for _, d := range group {
			if !d.Dropped {
				total += t.sign * d.Value
			}
			rolled = append(rolled, d)
		}
	}

	if multiplier != 1 {
		total *= multiplier
	}

	label := strings.TrimSpace(opts.Label)
	if label == "" {
		label = "Rolagem " + raw
	}

	var sysMeta map[string]any
	if len(opts.SystemMeta) > 0 {
		sysMeta = make(map[string]any, len(opts.SystemMeta)+4)
		for k, v := range opts.SystemMeta {
			sysMeta[k] = v
		}
	}

	res := model.RollResult{
		RollID:     newRollID(),
		Formula:    raw,
		Label:      label,
		Dice:       rolled,
		Modifier:   modifier,
		Total:      total,
		Seed:       seed,
		SystemMeta: sysMeta,
	}

	if handled, err := applyTagmarEvaluation(&res, rolled, opts); err != nil {
		return model.RollResult{}, err
	} else if !handled {
		res.Outcome = evaluateOutcome(rolled, total, opts)
	}

	return res, nil
}

func parseFormula(raw string) ([]term, int, error) {
	compact := strings.ReplaceAll(raw, " ", "")
	compact = strings.ReplaceAll(compact, "\t", "")
	if compact == "" {
		return nil, 1, errors.New("formula is empty")
	}

	multiplier := 1
	// Support optional outer multiplier: "(expr)*N", "expr*N", or "N*(expr)"
	if idx := strings.LastIndexByte(compact, '*'); idx > 0 {
		left := compact[:idx]
		right := compact[idx+1:]
		if mult, err := strconv.Atoi(right); err == nil && mult >= 1 && mult <= 10 {
			multiplier = mult
			compact = left
		} else if mult, err := strconv.Atoi(left); err == nil && mult >= 1 && mult <= 10 {
			multiplier = mult
			compact = right
		} else {
			return nil, 1, fmt.Errorf("unsupported multiplier in formula %q", raw)
		}
	}
	// Strip balanced outer parentheses if present
	for strings.HasPrefix(compact, "(") && strings.HasSuffix(compact, ")") {
		inner := compact[1 : len(compact)-1]
		if inner == "" {
			return nil, 1, fmt.Errorf("empty parentheses in formula %q", raw)
		}
		compact = inner
	}

	var terms []term
	i := 0
	n := len(compact)
	for i < n {
		sign := 1
		if compact[i] == '+' {
			sign = 1
			i++
		} else if compact[i] == '-' {
			sign = -1
			i++
		} else if len(terms) > 0 {
			return nil, 1, fmt.Errorf("expected '+' or '-' at position %d in %q", i, raw)
		}

		if i >= n {
			return nil, 1, fmt.Errorf("trailing operator in formula %q", raw)
		}

		start := i
		for i < n && compact[i] != '+' && compact[i] != '-' {
			i++
		}
		tok := compact[start:i]
		if tok == "" {
			return nil, 1, fmt.Errorf("empty term in formula %q", raw)
		}

		if m := diceTermRe.FindStringSubmatch(tok); m != nil {
			count := 1
			if m[1] != "" {
				c, err := strconv.Atoi(m[1])
				if err != nil || c < 1 || c > MaxDiceCount {
					return nil, 1, fmt.Errorf("invalid dice count in %q", tok)
				}
				count = c
			}
			sides, err := strconv.Atoi(m[2])
			if err != nil || sides < MinDiceSides || sides > MaxDiceSides {
				return nil, 1, fmt.Errorf("invalid die sides in %q (must be %d..%d)", tok, MinDiceSides, MaxDiceSides)
			}
			keepMode := strings.ToLower(m[3])
			keepCount := 0
			if keepMode != "" {
				if m[4] == "" {
					keepCount = 1
				} else {
					kc, err := strconv.Atoi(m[4])
					if err != nil || kc < 0 || kc > count {
						return nil, 1, fmt.Errorf("invalid keep/drop count in %q", tok)
					}
					keepCount = kc
				}
			}
			terms = append(terms, term{
				sign:      sign,
				isDice:    true,
				count:     count,
				sides:     sides,
				keepMode:  keepMode,
				keepCount: keepCount,
			})
			continue
		}

		if intTermRe.MatchString(tok) {
			val, err := strconv.Atoi(tok)
			if err != nil || val > 100000 {
				return nil, 1, fmt.Errorf("invalid modifier %q", tok)
			}
			terms = append(terms, term{
				sign:     sign,
				isDice:   false,
				constant: val,
			})
			continue
		}

		return nil, 1, fmt.Errorf("unsupported token %q in formula %q", tok, raw)
	}

	if len(terms) == 0 {
		return nil, 1, errors.New("no valid terms in formula")
	}
	return terms, multiplier, nil
}

func applyKeepDrop(group []model.RolledDie, mode string, count int) {
	if mode == "" || len(group) == 0 {
		return
	}
	type indexed struct {
		idx int
		val int
	}
	sorted := make([]indexed, len(group))
	for i, d := range group {
		sorted[i] = indexed{idx: i, val: d.Value}
	}

	switch mode {
	case "kh": // keep highest `count` -> drop the lowest (len - count)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].val > sorted[j].val })
		for i := count; i < len(sorted); i++ {
			group[sorted[i].idx].Dropped = true
		}
	case "kl": // keep lowest `count` -> drop the highest (len - count)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].val < sorted[j].val })
		for i := count; i < len(sorted); i++ {
			group[sorted[i].idx].Dropped = true
		}
	case "dh": // drop highest `count`
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].val > sorted[j].val })
		for i := 0; i < count && i < len(sorted); i++ {
			group[sorted[i].idx].Dropped = true
		}
	case "dl": // drop lowest `count`
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].val < sorted[j].val })
		for i := 0; i < count && i < len(sorted); i++ {
			group[sorted[i].idx].Dropped = true
		}
	}
}

func activeRolledDice(rolled []model.RolledDie) []model.RolledDie {
	active := make([]model.RolledDie, 0, len(rolled))
	for _, d := range rolled {
		if !d.Dropped {
			active = append(active, d)
		}
	}
	return active
}

func applyTagmarEvaluation(res *model.RollResult, rolled []model.RolledDie, opts Options) (bool, error) {
	if opts.SystemID != "" && !IsTagmarSystem(opts.SystemID) {
		return false, nil
	}

	active := activeRolledDice(rolled)
	if len(active) != 1 || active[0].Sides != 20 {
		return false, nil
	}

	metaCol, metaRes := extractTagmarFromMeta(opts.SystemMeta)
	tagmarCol := opts.TagmarColumn
	if tagmarCol == nil && metaCol != nil {
		tagmarCol = metaCol
	}
	tagmarResReq := opts.TagmarResistance
	if tagmarResReq == nil && metaRes != nil {
		tagmarResReq = metaRes
	}

	if tagmarResReq == nil && tagmarCol == nil {
		return false, nil
	}

	d20Val := active[0].Value
	ensureMeta := func() map[string]any {
		if res.SystemMeta == nil {
			res.SystemMeta = map[string]any{}
		}
		return res.SystemMeta
	}

	if tagmarResReq != nil {
		tr, err := ResolveTagmarResistance(d20Val, *tagmarResReq)
		if err != nil {
			return false, err
		}
		res.TagmarResistance = &tr
		kindUpper := strings.ToUpper(tr.Kind)
		target := tr.Target
		margin := d20Val - tr.Target

		var outcomeKind, badge string
		switch {
		case d20Val == 20:
			outcomeKind = "critical"
			badge = fmt.Sprintf("RESISTIU! (%s Crítico vs %d)", kindUpper, target)
		case d20Val == 1:
			outcomeKind = "fumble"
			badge = fmt.Sprintf("FALHA CRÍTICA (%s vs %d)", kindUpper, target)
		case tr.Resisted:
			outcomeKind = "success"
			badge = fmt.Sprintf("RESISTIU! (%s vs %d)", kindUpper, target)
		default:
			outcomeKind = "failure"
			badge = fmt.Sprintf("AFETADO (%s vs %d)", kindUpper, target)
		}
		res.Outcome = &model.RollOutcome{
			Kind:       outcomeKind,
			BadgeText:  badge,
			Difficulty: &target,
			TargetName: opts.TargetName,
			Margin:     &margin,
		}
		m := ensureMeta()
		m["tagmarResistance"] = tr
		return true, nil
	}

	// Tabela de Resolução de Ações (1d20 vs Column)
	tr, err := ResolveTagmarColumn(d20Val, *tagmarCol)
	if err != nil {
		return false, err
	}
	colCopy := *tagmarCol
	res.TagmarColumn = &colCopy
	res.TagmarColor = tr.Color
	res.TagmarDamageTier = tr.DamageTier
	res.TagmarDirectToEf = tr.DirectToEf
	badge := fmt.Sprintf("%s · Col %d", tr.Label, colCopy)
	if opts.TargetName != "" {
		badge = fmt.Sprintf("%s vs %s (Col %d)", tr.Label, opts.TargetName, colCopy)
	}
	res.Outcome = &model.RollOutcome{
		Kind:       tr.OutcomeKind,
		BadgeText:  badge,
		TargetName: opts.TargetName,
	}
	m := ensureMeta()
	m["tagmarColumn"] = colCopy
	m["tagmarColor"] = tr.Color
	m["tagmarDamageTier"] = tr.DamageTier
	m["tagmarDirectToEf"] = tr.DirectToEf
	return true, nil
}

func evaluateOutcome(rolled []model.RolledDie, total int, opts Options) *model.RollOutcome {
	active := activeRolledDice(rolled)

	var outcome *model.RollOutcome

	// Mighty Blade 3e automatic critical (6+6) and critical failure (1+1) on 2d6,
	// plus 1d6 Inapto fumble (1).
	if len(active) == 2 && active[0].Sides == 6 && active[1].Sides == 6 {
		if active[0].Value == 6 && active[1].Value == 6 {
			outcome = &model.RollOutcome{
				Kind:      "critical",
				BadgeText: "CRÍTICO! (6+6)",
			}
		} else if active[0].Value == 1 && active[1].Value == 1 {
			outcome = &model.RollOutcome{
				Kind:      "fumble",
				BadgeText: "FALHA CRÍTICA (1+1)",
			}
		}
	} else if len(active) == 1 && active[0].Sides == 6 && active[0].Value == 1 {
		outcome = &model.RollOutcome{
			Kind:      "fumble",
			BadgeText: "FALHA CRÍTICA (1 — Inapto)",
		}
	} else if len(active) == 1 && active[0].Sides == 20 {
		// Generic RPG d20 critical / fumble support.
		if active[0].Value == 20 {
			outcome = &model.RollOutcome{
				Kind:      "critical",
				BadgeText: "CRÍTICO NATURAL! (20)",
			}
		} else if active[0].Value == 1 {
			outcome = &model.RollOutcome{
				Kind:      "fumble",
				BadgeText: "FALHA CRÍTICA (1)",
			}
		}
	}

	targetVal := 0
	isDefense := false
	hasTarget := false
	if opts.TargetDefense != nil && *opts.TargetDefense > 0 {
		targetVal = *opts.TargetDefense
		isDefense = true
		hasTarget = true
	} else if opts.Difficulty != nil && *opts.Difficulty > 0 {
		targetVal = *opts.Difficulty
		hasTarget = true
	}

	if hasTarget {
		margin := total - targetVal
		if outcome == nil {
			outcome = &model.RollOutcome{}
			if total >= targetVal {
				outcome.Kind = "success"
				if isDefense {
					if opts.TargetName != "" {
						outcome.BadgeText = fmt.Sprintf("ACERTO vs %s (%d)", opts.TargetName, targetVal)
					} else {
						outcome.BadgeText = fmt.Sprintf("ACERTO vs Defesa %d", targetVal)
					}
				} else {
					outcome.BadgeText = fmt.Sprintf("SUCESSO (vs CD %d)", targetVal)
				}
			} else {
				outcome.Kind = "failure"
				if isDefense {
					if opts.TargetName != "" {
						outcome.BadgeText = fmt.Sprintf("ERRO vs %s (%d)", opts.TargetName, targetVal)
					} else {
						outcome.BadgeText = fmt.Sprintf("ERRO vs Defesa %d", targetVal)
					}
				} else {
					outcome.BadgeText = fmt.Sprintf("FALHA (vs CD %d)", targetVal)
				}
			}
		}
		if opts.Difficulty != nil {
			d := *opts.Difficulty
			outcome.Difficulty = &d
		}
		if opts.TargetDefense != nil {
			td := *opts.TargetDefense
			outcome.TargetDefense = &td
		}
		outcome.TargetName = opts.TargetName
		outcome.Margin = &margin
	}

	return outcome
}

func cryptoDieRoller(sides int) (int, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(sides)))
	if err != nil {
		return 0, err
	}
	return int(n.Int64()) + 1, nil
}

func cryptoSeed() (uint32, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(b[:]), nil
}

func newRollID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "roll_" + hex.EncodeToString(b[:])
}
