package fanout

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
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
