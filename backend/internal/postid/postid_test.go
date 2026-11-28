package postid

import (
	"strings"
	"testing"
	"time"

	"github.com/rs/xid"
)

func TestNewIsValid(t *testing.T) {
	id, err := New()
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != Length {
		t.Fatalf("len = %d, want %d", len(id), Length)
	}
	if !Valid(id) {
		t.Fatalf("New() = %q is not valid", id)
	}
}

func TestNewIsUnique(t *testing.T) {
	seen := make(map[string]struct{}, 10000)
	for i := 0; i < 10000; i++ {
		id, err := New()
		if err != nil {
			t.Fatal(err)
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("duplicate ID %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestSortsInCreationOrder(t *testing.T) {
	base := time.Unix(1_700_000_000, 0)
	tail := strings.Repeat("0", 20)
	earlier := xid.NewWithTime(base).String() + tail
	later := xid.NewWithTime(base.Add(time.Second)).String() + tail
	if !Valid(earlier) || !Valid(later) {
		t.Fatal("hand-built IDs are not valid")
	}
	if earlier >= later {
		t.Fatalf("%q should sort before %q", earlier, later)
	}
}

func TestValidRefuses(t *testing.T) {
	good := strings.Repeat("a", 20) + strings.Repeat("z", 20)
	if !Valid(good) {
		t.Fatal("good ID refused")
	}
	tests := map[string]string{
		"39 characters": good[:39],
		"41 characters": good + "a",
		"uppercase":     strings.Repeat("A", 20) + strings.Repeat("z", 20),
		"w in XID part": "w" + strings.Repeat("a", 19) + strings.Repeat("z", 20),
		"dash":          strings.Repeat("a", 19) + "-" + strings.Repeat("z", 20),
		"empty":         "",
	}
	for name, id := range tests {
		if Valid(id) {
			t.Errorf("%s: Valid(%q) = true", name, id)
		}
	}
}

func TestRandomPartCoversAlphabet(t *testing.T) {
	seen := map[byte]bool{}
	for i := 0; i < 5000; i++ {
		id, err := New()
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range []byte(id[20:]) {
			seen[c] = true
		}
	}
	for _, c := range []byte(alphabet) {
		if !seen[c] {
			t.Errorf("character %q never appeared in 100,000", c)
		}
	}
}
