package aicredits

import "testing"

func TestCostRoundsUpToWholeCredits(t *testing.T) {
	t.Parallel()
	rates := Rates{InputPerMillion: 20_000, OutputPerMillion: 60_000}
	cases := []struct {
		name          string
		input, output int64
		want          int64
	}{
		{"nothing", 0, 0, 0},
		{"one token", 1, 0, 1},
		{"exact", 1_000_000, 0, 20_000},
		{"mixed", 1500, 1500, 120},
		{"fraction rounds up", 1, 1, 1},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := Cost(rates, testCase.input, testCase.output); got != testCase.want {
				t.Fatalf("Cost() = %d, want %d", got, testCase.want)
			}
		})
	}
	if Cost(Rates{}, 1000, 1000) != 0 {
		t.Fatal("a free model costs nothing")
	}
}

func TestReservationBoundsTheCost(t *testing.T) {
	t.Parallel()
	rates := Rates{InputPerMillion: 20_000, OutputPerMillion: 60_000}
	reserved := Reservation(rates, 4000, 2, 3072)
	// The actual cost of a call within those bounds never exceeds it.
	if worst := Cost(rates, 4000+2*64, 3072); reserved < worst {
		t.Fatalf("Reservation() = %d, below worst case %d", reserved, worst)
	}
	if Reservation(Rates{}, 10, 1, 256) != 1 {
		t.Fatal("a reservation holds at least one credit")
	}
}
