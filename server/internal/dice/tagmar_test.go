package dice

import (
	"testing"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

func TestTagmarResolutionTableExhaustiveAndSpotChecks(t *testing.T) {
	// Every single column -7..20 and d20 1..20 must resolve cleanly with monotonic non-decreasing tiers.
	for col := -7; col <= 20; col++ {
		prevTier := -1
		for d20 := 1; d20 <= 20; d20++ {
			res, err := ResolveTagmarColumn(d20, col)
			if err != nil {
				t.Fatalf("ResolveTagmarColumn(d20=%d, col=%d) error: %v", d20, col, err)
			}
			if res.Color == "" {
				t.Fatalf("empty color for d20=%d col=%d", d20, col)
			}
			if res.DamageTier < prevTier {
				t.Fatalf("non-monotonic damageTier at col=%d d20=%d: got %d < prev %d", col, d20, res.DamageTier, prevTier)
			}
			prevTier = res.DamageTier
			if res.Color == TagmarColorAzul && !res.DirectToEf {
				t.Fatalf("azul must set DirectToEf=true at col=%d d20=%d", col, d20)
			}
			if res.Color != TagmarColorAzul && res.DirectToEf {
				t.Fatalf("non-azul (%s) must not set DirectToEf=true", res.Color)
			}
		}
	}

	// Exact official spot checks from embedded tagmar/rules.json
	cases := []struct {
		name       string
		col        int
		d20        int
		wantColor  string
		wantTier   int
		wantDirect bool
	}{
		{"col -7 nat 2 erro_critico", -7, 2, TagmarColorErroCritico, 0, false},
		{"col -7 d20 14 falha", -7, 14, TagmarColorFalha, 0, false},
		{"col -7 d20 15 verde", -7, 15, TagmarColorVerde, 1, false},
		{"col -7 d20 17 amarelo", -7, 17, TagmarColorAmarelo, 2, false},
		{"col -7 d20 19 laranja", -7, 19, TagmarColorLaranja, 3, false},
		{"col -7 d20 20 azul", -7, 20, TagmarColorAzul, 5, true},
		{"col -15 clamped to -7", -15, 15, TagmarColorVerde, 1, false},
		{"col 0 d20 1 erro_critico", 0, 1, TagmarColorErroCritico, 0, false},
		{"col 0 d20 11 falha", 0, 11, TagmarColorFalha, 0, false},
		{"col 0 d20 12 verde", 0, 12, TagmarColorVerde, 1, false},
		{"col 0 d20 18 vermelho", 0, 18, TagmarColorVermelho, 4, false},
		{"col 10 d20 6 falha", 10, 6, TagmarColorFalha, 0, false},
		{"col 10 d20 7 verde", 10, 7, TagmarColorVerde, 1, false},
		{"col 10 d20 12 amarelo", 10, 12, TagmarColorAmarelo, 2, false},
		{"col 10 d20 15 laranja", 10, 15, TagmarColorLaranja, 3, false},
		{"col 10 d20 19 vermelho", 10, 19, TagmarColorVermelho, 4, false},
		{"col 10 d20 20 azul", 10, 20, TagmarColorAzul, 5, true},
		{"col 20 d20 1 erro_critico", 20, 1, TagmarColorErroCritico, 0, false},
		{"col 20 d20 2 verde (no falha)", 20, 2, TagmarColorVerde, 1, false},
		{"col 20 d20 18 azul", 20, 18, TagmarColorAzul, 5, true},
		// >20 Overflow: Col 24 -> Effective Col 4 + 2 tiers (+50%)
		{"col 24 overflow nat 1 still erro_critico", 24, 1, TagmarColorErroCritico, 0, false},
		{"col 24 overflow d20 5 (falha on 4 -> amarelo)", 24, 5, TagmarColorAmarelo, 2, false},
		{"col 24 overflow d20 10 (verde on 4 -> laranja)", 24, 10, TagmarColorLaranja, 3, false},
		{"col 24 overflow d20 12 (amarelo on 4 -> vermelho)", 24, 12, TagmarColorVermelho, 4, false},
		{"col 24 overflow d20 15 (laranja on 4 -> azul)", 24, 15, TagmarColorAzul, 5, true},
		{"col 24 overflow d20 18 (vermelho on 4 -> azul+1 tier)", 24, 18, TagmarColorAzul, 6, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolveTagmarColumn(tc.d20, tc.col)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Color != tc.wantColor || got.DamageTier != tc.wantTier || got.DirectToEf != tc.wantDirect {
				t.Fatalf("col=%d d20=%d: got color=%s tier=%d direct=%v, want color=%s tier=%d direct=%v",
					tc.col, tc.d20, got.Color, got.DamageTier, got.DirectToEf, tc.wantColor, tc.wantTier, tc.wantDirect)
			}
		})
	}
}

func TestTagmarResistanceTableAndFormulaFallback(t *testing.T) {
	cases := []struct {
		name         string
		kind         string
		fa           int
		fd           int
		d20          int
		wantTarget   int
		wantResisted bool
	}{
		{"equal FA=FD target 11 pass", "rf", 5, 5, 11, 11, true},
		{"equal FA=FD target 11 fail", "rf", 5, 5, 10, 11, false},
		{"FA 10 vs FD 1 target 17", "rm", 10, 1, 17, 17, true},
		{"FA 10 vs FD 1 fail on 16", "rm", 10, 1, 16, 17, false},
		{"nat 1 always fails even when target 2", "rf", 1, 15, 1, 2, false},
		{"d20 2 succeeds when target 2", "rf", 1, 15, 2, 2, true},
		{"nat 20 always succeeds when target 20", "rm", 20, -2, 20, 20, true},
		{"out of bounds high FA clamps target to 20", "rf", 30, 0, 19, 20, false},
		{"out of bounds high FD clamps target to 2", "rm", 1, 30, 2, 2, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolveTagmarResistance(tc.d20, model.TagmarResistanceRequest{
				Kind: tc.kind,
				FA:   tc.fa,
				FD:   tc.fd,
			})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Target != tc.wantTarget || got.Resisted != tc.wantResisted || got.Kind != tc.kind {
				t.Fatalf("got %+v, want kind=%s target=%d resisted=%v", got, tc.kind, tc.wantTarget, tc.wantResisted)
			}
		})
	}
}

func TestRollWithRollerTagmarResolutionAndResistance(t *testing.T) {
	col := 6
	// Col 6, d20=20 -> Azul (Crítico, DirectToEf=true, Tier 5)
	res, err := RollWithRoller("1d20", Options{
		SystemID:     "tagmar-3",
		Label:        "Ataque Espada Longa",
		TagmarColumn: &col,
		TargetName:   "Orc Saqueador",
	}, seqRoller(20), fixedSeed(777))
	if err != nil {
		t.Fatalf("RollWithRoller Tagmar column failed: %v", err)
	}
	if res.TagmarColumn == nil || *res.TagmarColumn != 6 {
		t.Fatalf("expected tagmarColumn=6, got %v", res.TagmarColumn)
	}
	if res.TagmarColor != TagmarColorAzul || res.TagmarDamageTier != 5 || !res.TagmarDirectToEf {
		t.Fatalf("expected azul tier 5 directToEf, got %+v", res)
	}
	if res.Outcome == nil || res.Outcome.Kind != "critical" {
		t.Fatalf("expected critical outcome, got %+v", res.Outcome)
	}

	// Via SystemMeta fallback (Col 6, d20=15 -> Laranja tier 3)
	metaRoll, err := RollWithRoller("1d20", Options{
		SystemID:   "tagmar-3",
		Label:      "Teste de Habilidade",
		SystemMeta: map[string]any{"tagmarColumn": 6},
	}, seqRoller(15), fixedSeed(778))
	if err != nil {
		t.Fatalf("RollWithRoller meta column failed: %v", err)
	}
	if metaRoll.TagmarColor != TagmarColorLaranja || metaRoll.TagmarDamageTier != 3 || metaRoll.TagmarDirectToEf {
		t.Fatalf("expected laranja tier 3, got %+v", metaRoll)
	}

	// Tagmar Resistance test via RollWithRoller
	resRoll, err := RollWithRoller("1d20", Options{
		SystemID: "tagmar-3",
		Label:    "Teste de RM",
		TagmarResistance: &model.TagmarResistanceRequest{
			Kind: "rm",
			FA:   6,
			FD:   6,
		},
	}, seqRoller(12), fixedSeed(779))
	if err != nil {
		t.Fatalf("RollWithRoller Tagmar resistance failed: %v", err)
	}
	if resRoll.TagmarResistance == nil || resRoll.TagmarResistance.Target != 11 || !resRoll.TagmarResistance.Resisted {
		t.Fatalf("expected resisted vs target 11, got %+v", resRoll.TagmarResistance)
	}
	if resRoll.Outcome == nil || resRoll.Outcome.Kind != "success" {
		t.Fatalf("expected success outcome on resisted RM, got %+v", resRoll.Outcome)
	}

	// Non-Tagmar system MUST ignore tagmarColumn
	mbRoll, err := RollWithRoller("1d20", Options{
		SystemID:     "mighty-blade-3e",
		TagmarColumn: &col,
	}, seqRoller(15), fixedSeed(780))
	if err != nil {
		t.Fatalf("non-Tagmar roll failed: %v", err)
	}
	if mbRoll.TagmarColor != "" || mbRoll.TagmarColumn != nil {
		t.Fatalf("mighty-blade-3e should not attach Tagmar metadata, got %+v", mbRoll)
	}
}
