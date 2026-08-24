package globalcoordinator

import "testing"

func TestIsShortID(t *testing.T) {
	for _, test := range []struct {
		value ShortID
		want  bool
	}{
		{"00000000000", true},
		{"7zzzzzzzzzz", true},
		{"0000000000", false},
		{"0000000000o", false},
		{"0000000000U", false},
	} {
		if got := IsShortID(test.value); got != test.want {
			t.Errorf("IsShortID(%q) = %v, want %v", test.value, got, test.want)
		}
	}
}
