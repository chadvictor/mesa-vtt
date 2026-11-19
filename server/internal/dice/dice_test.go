package dice

import (
	"testing"
)

func seqRoller(vals ...int) DieRoller {
	idx := 0
	return func(sides int) (int, error) {
		v := vals[idx%len(vals)]
		idx++
		return v, nil
	}
}

func fixedSeed(s uint32) SeedGenerator {
	return func() (uint32, error) { return s, nil }
}

func TestMightyBlade2d6CritAndFumble(t *testing.T) {
	diff := 15
	crit, err := RollWithRoller("2d6+4", Options{Label: "Ataque", Difficulty: &diff}, seqRoller(6, 6), fixedSeed(99))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if crit.Total != 16 || crit.Modifier != 4 || crit.Seed != 99 {
		t.Fatalf("unexpected crit roll: %+v", crit)
	}
	if len(crit.Dice) != 2 || crit.Dice[0].Value != 6 || crit.Dice[1].Value != 6 {
		t.Fatalf("expected exact die faces [6,6], got %+v", crit.Dice)
	}
	if crit.Outcome == nil || crit.Outcome.Kind != "critical" {
		t.Fatalf("expected critical outcome on 6+6, got %+v", crit.Outcome)
	}

	fumble, err := RollWithRoller("2d6 + 3", Options{Label: "Esquiva"}, seqRoller(1, 1), fixedSeed(100))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fumble.Total != 5 {
		t.Fatalf("expected total 5, got %d", fumble.Total)
	}
	if fumble.Outcome == nil || fumble.Outcome.Kind != "fumble" {
		t.Fatalf("expected fumble outcome on 1+1, got %+v", fumble.Outcome)
	}
}

func TestKeepHighestAndLowest(t *testing.T) {
	res, err := RollWithRoller("3d6kh2+2", Options{}, seqRoller(2, 6, 4), fixedSeed(7))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Keep 6 and 4, drop 2 => 10 + 2 = 12
	if res.Total != 12 {
		t.Fatalf("expected total 12, got %d (dice=%+v)", res.Total, res.Dice)
	}
	if !res.Dice[0].Dropped || res.Dice[1].Dropped || res.Dice[2].Dropped {
		t.Fatalf("expected only index 0 (value 2) dropped, got %+v", res.Dice)
	}

	low, err := RollWithRoller("4d6kl3", Options{}, seqRoller(5, 1, 3, 2), fixedSeed(8))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Keep 1, 3, 2, drop 5 => total 6
	if low.Total != 6 {
		t.Fatalf("expected total 6, got %d (dice=%+v)", low.Total, low.Dice)
	}
	if !low.Dice[0].Dropped || low.Dice[1].Dropped || low.Dice[2].Dropped || low.Dice[3].Dropped {
		t.Fatalf("expected only index 0 (value 5) dropped, got %+v", low.Dice)
	}
}

func TestComplexFormulasAndTargetDefense(t *testing.T) {
	def := 14
	res, err := RollWithRoller("2d8+1d6+3-1", Options{
		Label:         "Dano Completo",
		TargetDefense: &def,
		TargetName:    "Goblin",
	}, seqRoller(7, 5, 4), fixedSeed(123))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 7 + 5 + 4 + 3 - 1 = 18
	if res.Total != 18 || res.Modifier != 2 || len(res.Dice) != 3 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.Outcome == nil || res.Outcome.Kind != "success" || res.Outcome.Margin == nil || *res.Outcome.Margin != 4 {
		t.Fatalf("expected success with margin 4, got %+v", res.Outcome)
	}

	// Real crypto/rand smoke test for 1d100 and d20
	for _, formula := range []string{"1d100", "d20+5", "2d6+4"} {
		r, err := Roll(formula, Options{})
		if err != nil {
			t.Fatalf("Roll(%q) failed: %v", formula, err)
		}
		for _, d := range r.Dice {
			if d.Value < 1 || d.Value > d.Sides {
				t.Fatalf("die face out of range: %+v", d)
			}
		}
	}
}

func TestMultiplierAndInapto1d6Fumble(t *testing.T) {
	// Critical follow-up damage roll: (2d6+4) * 2
	critDmg, err := RollWithRoller("(2d6+4) * 2", Options{Label: "Dano Crítico"}, seqRoller(5, 4), fixedSeed(55))
	if err != nil {
		t.Fatalf("unexpected error for (2d6+4) * 2: %v", err)
	}
	// (5 + 4 + 4) * 2 = 26
	if critDmg.Total != 26 || len(critDmg.Dice) != 2 {
		t.Fatalf("expected total 26 with 2 dice, got %+v", critDmg)
	}

	// Plain expr * N without parens
	doubleRoll, err := RollWithRoller("2d6+3 * 2", Options{}, seqRoller(3, 4), fixedSeed(56))
	if err != nil {
		t.Fatalf("unexpected error for 2d6+3 * 2: %v", err)
	}
	// (3 + 4 + 3) * 2 = 20
	if doubleRoll.Total != 20 {
		t.Fatalf("expected total 20, got %d", doubleRoll.Total)
	}

	// 1d6 Inapto fumble when rolling 1
	inapto, err := RollWithRoller("1d6+2", Options{Label: "Teste Inapto"}, seqRoller(1), fixedSeed(57))
	if err != nil {
		t.Fatalf("unexpected error for 1d6+2: %v", err)
	}
	if inapto.Total != 3 || inapto.Outcome == nil || inapto.Outcome.Kind != "fumble" {
		t.Fatalf("expected fumble outcome on 1d6 Inapto 1, got %+v", inapto)
	}
}

func TestInvalidFormulasRejected(t *testing.T) {
	bad := []string{"", "100d6", "2d1", "2d9999", "2d6+", "foo", "3d6kh5"}
	for _, f := range bad {
		if _, err := Roll(f, Options{}); err == nil {
			t.Fatalf("expected error for invalid formula %q", f)
		}
	}
}
