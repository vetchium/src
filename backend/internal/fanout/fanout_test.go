package fanout

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
)

func TestDoRunsTenantsInParallel(t *testing.T) {
	t.Parallel()
	groups := map[string]int{"a": 1, "b": 2, "c": 3}
	start := time.Now()
	res := Do(context.Background(), groups,
		func(ctx context.Context, tenant string, g int) (int, error) {
			time.Sleep(100 * time.Millisecond)
			return g * 10, nil
		}, time.Second)
	if elapsed := time.Since(start); elapsed >= 250*time.Millisecond {
		t.Fatalf("calls were not parallel: %v", elapsed)
	}
	for tenant, g := range groups {
		if res[tenant].Err != nil || res[tenant].Value != g*10 {
			t.Fatalf("tenant %s: %+v", tenant, res[tenant])
		}
	}
}

func TestDoDeadline(t *testing.T) {
	t.Parallel()
	groups := map[string]struct{}{"slow": {}, "fast": {}}
	res := Do(context.Background(), groups,
		func(ctx context.Context, tenant string, _ struct{}) (string, error) {
			if tenant == "slow" {
				<-ctx.Done()
				return "", ctx.Err()
			}
			return "ok", nil
		}, 50*time.Millisecond)
	if !errors.Is(res["slow"].Err, context.DeadlineExceeded) {
		t.Fatalf("slow: %+v", res["slow"])
	}
	if res["fast"].Err != nil || res["fast"].Value != "ok" {
		t.Fatalf("fast: %+v", res["fast"])
	}
}

func TestDoDeadlineWhenReadIgnoresContext(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	defer close(release)
	res := Do(context.Background(), map[string]int{"x": 0},
		func(context.Context, string, int) (int, error) {
			<-release
			return 1, nil
		}, 50*time.Millisecond)
	if !errors.Is(res["x"].Err, context.DeadlineExceeded) {
		t.Fatalf("got %+v", res["x"])
	}
}

func TestRegroupReadsEachTenantOnce(t *testing.T) {
	t.Parallel()
	homes := map[string]string{"d1": "t1", "d2": "t2", "d3": "t1"}
	var mu sync.Mutex
	calls := map[string]int{}
	res, unresolved := Regroup(context.Background(),
		[]string{"d1", "d2", "d3", "gone"},
		func(_ context.Context, did string) (string, error) {
			if t, ok := homes[did]; ok {
				return t, nil
			}
			return "", errors.New("no home")
		},
		func(_ context.Context, tenant string, dids []string) (int, error) {
			mu.Lock()
			calls[tenant]++
			mu.Unlock()
			return len(dids), nil
		}, time.Second)
	if calls["t1"] != 1 || calls["t2"] != 1 || len(calls) != 2 {
		t.Fatalf("calls: %v", calls)
	}
	if res["t1"].Value != 2 || res["t2"].Value != 1 {
		t.Fatalf("results: %+v", res)
	}
	if len(unresolved) != 1 || unresolved[0].DID != "gone" {
		t.Fatalf("unresolved: %+v", unresolved)
	}
}

func TestCursorRoundTrip(t *testing.T) {
	t.Parallel()
	in := Cursor{"sgp": "k1", "usa1": ""}
	key, err := EncodeCursor(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := DecodeCursor(key)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out["sgp"] != "k1" || out["usa1"] != "" {
		t.Fatalf("got %v", out)
	}
}

func TestCursorRejectsBadKeys(t *testing.T) {
	t.Parallel()
	good, _ := EncodeCursor(Cursor{"sgp": "k"})
	for name, key := range map[string]string{
		"tampered":   string(good) + "!",
		"not json":   "bm90IGpzb24",
		"array":      "W10",
		"empty map":  "e30",
		"wrong type": "eyJhIjoxfQ",
	} {
		if _, err := DecodeCursor(common.PaginationKey(key)); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

type item struct {
	ts int
}

func lessItem(a, b item) bool { return a.ts > b.ts } // newest first

func page(prev string, done bool, next string, ts ...int) Page[item] {
	p := Page[item]{Prev: prev, Done: done, Next: next}
	for _, v := range ts {
		p.Items = append(p.Items, item{v})
		p.Keys = append(p.Keys, "k"+string(rune('0'+v%10))+"@"+prev)
	}
	return p
}

func TestMerge(t *testing.T) {
	t.Parallel()
	pages := map[string]Page[item]{
		"a": page("pa", false, "na", 9, 6, 3),
		"b": page("pb", true, "nb", 8, 5),
		"c": page("pc", false, "nc", 7, 4, 2),
	}
	items, next, partial := Merge(pages, lessItem, 5)
	want := []int{9, 8, 7, 6, 5}
	for i, w := range want {
		if items[i].ts != w {
			t.Fatalf("items: %v", items)
		}
	}
	if len(items) != 5 || partial {
		t.Fatalf("len %d partial %v", len(items), partial)
	}
	// a: took 9,6 of 3 -> resume after 6. b: took 8,5 of 2 and done -> drop.
	// c: took 7 of 3 -> resume after 7.
	if _, ok := next["b"]; ok {
		t.Fatalf("done tenant stays: %v", next)
	}
	if next["a"] != pages["a"].Keys[1] || next["c"] != pages["c"].Keys[0] {
		t.Fatalf("next: %v", next)
	}
}

func TestMergeKeepsTenantWhenNoneTaken(t *testing.T) {
	t.Parallel()
	pages := map[string]Page[item]{
		"a": page("pa", false, "na", 9, 8, 7),
		"b": page("pb", false, "nb", 2, 1),
	}
	_, next, _ := Merge(pages, lessItem, 3)
	if next["b"] != "pb" {
		t.Fatalf("next: %v", next)
	}
	if _, ok := next["a"]; !ok || next["a"] != "na" {
		t.Fatalf("a: %v", next)
	}
}

func TestMergeErroredTenant(t *testing.T) {
	t.Parallel()
	pages := map[string]Page[item]{
		"a": page("pa", true, "", 5),
		"b": {Prev: "pb", Err: errors.New("timeout")},
	}
	items, next, partial := Merge(pages, lessItem, 10)
	if len(items) != 1 || !partial || next["b"] != "pb" {
		t.Fatalf("items %v next %v partial %v", items, next, partial)
	}
	if _, ok := next["a"]; ok {
		t.Fatalf("done tenant stays: %v", next)
	}
}

func TestMergeAllDone(t *testing.T) {
	t.Parallel()
	pages := map[string]Page[item]{
		"a": page("", true, "", 2),
		"b": page("", true, "", 1),
	}
	_, next, partial := Merge(pages, lessItem, 5)
	if next != nil || partial {
		t.Fatalf("next %v partial %v", next, partial)
	}
}
