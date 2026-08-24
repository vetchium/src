package globalcoordinator

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
)

func TestGeneratorProducesUniqueFixedWidthIDs(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "last-id")
	now := func() time.Time { return shortIDEpoch.Add(12 * time.Hour) }
	generator, err := openGenerator(statePath, now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := generator.Close(); closeErr != nil {
			t.Errorf("Close() error = %v", closeErr)
		}
	})

	const count = 1000
	ids := make(chan coordinatorspec.ShortID, count)
	var group sync.WaitGroup
	for range count {
		group.Add(1)
		go func() {
			defer group.Done()
			id, generateErr := generator.Generate()
			if generateErr != nil {
				t.Errorf("Generate() error = %v", generateErr)
				return
			}
			ids <- id
		}()
	}
	group.Wait()
	close(ids)

	seen := make(map[coordinatorspec.ShortID]struct{}, count)
	for id := range ids {
		if !coordinatorspec.IsShortID(id) {
			t.Errorf("Generate() = %q, want valid short ID", id)
		}
		if _, exists := seen[id]; exists {
			t.Errorf("duplicate short ID %q", id)
		}
		seen[id] = struct{}{}
	}
	if len(seen) != count {
		t.Fatalf("generated %d unique IDs, want %d", len(seen), count)
	}
}

func TestGeneratorContinuesAfterRestartAndClockRegression(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "last-id")
	firstClock := func() time.Time { return shortIDEpoch.Add(time.Hour) }
	first, err := openGenerator(statePath, firstClock)
	if err != nil {
		t.Fatal(err)
	}
	firstID, err := first.Generate()
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	regressedClock := func() time.Time { return shortIDEpoch.Add(30 * time.Minute) }
	second, err := openGenerator(statePath, regressedClock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := second.Close(); closeErr != nil {
			t.Errorf("Close() error = %v", closeErr)
		}
	})
	secondID, err := second.Generate()
	if err != nil {
		t.Fatal(err)
	}
	if firstID >= secondID {
		t.Fatalf("IDs = %q then %q, want monotonically increasing", firstID, secondID)
	}
}

func TestGeneratorRejectsSecondWriter(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "last-id")
	first, err := OpenGenerator(statePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := first.Close(); closeErr != nil {
			t.Errorf("Close() error = %v", closeErr)
		}
	})
	second, err := OpenGenerator(statePath)
	if err == nil {
		if closeErr := second.Close(); closeErr != nil {
			t.Errorf("Close() error = %v", closeErr)
		}
		t.Fatal("OpenGenerator() succeeded for a second writer")
	}
}
