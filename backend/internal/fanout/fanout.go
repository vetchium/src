// Package fanout reads from many regions in parallel and merges the answers.
// It holds mechanism only: it knows no post, profile, or handler types.
//
// The P4 rule (PST-RD-001): one call to each region in each round. A caller
// groups all its targets by tenant first, then calls [Do] once. [Regroup]
// adds exactly one more round, for principals that a region reported as
// not-homed. No code path in this package loops a third time.
package fanout

import (
	"context"
	"sync"
	"time"
)

// DefaultDeadline is the time each region has to answer one round.
const DefaultDeadline = 2 * time.Second

// Result is the answer of one region: a value or an error.
type Result[R any] struct {
	Value R
	Err   error
}

// Do runs read once for each tenant in groups, in parallel. Each call gets
// its own context with the deadline. A deadline of zero or less means
// [DefaultDeadline]. A slow or failing tenant never blocks the others past
// the deadline.
func Do[K comparable, G any, R any](
	ctx context.Context,
	groups map[K]G,
	read func(ctx context.Context, tenant K, group G) (R, error),
	deadline time.Duration,
) map[K]Result[R] {
	if deadline <= 0 {
		deadline = DefaultDeadline
	}
	results := make(map[K]Result[R], len(groups))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for tenant, group := range groups {
		wg.Add(1)
		go func() {
			defer wg.Done()
			callCtx, cancel := context.WithTimeout(ctx, deadline)
			defer cancel()
			type outcome struct {
				value R
				err   error
			}
			done := make(chan outcome, 1)
			go func() {
				v, err := read(callCtx, tenant, group)
				done <- outcome{v, err}
			}()
			var res Result[R]
			select {
			case o := <-done:
				res = Result[R]{Value: o.value, Err: o.err}
			case <-callCtx.Done():
				// A read that ignores its context must not hold the round.
				res = Result[R]{Err: callCtx.Err()}
			}
			mu.Lock()
			results[tenant] = res
			mu.Unlock()
		}()
	}
	wg.Wait()
	return results
}

// Unresolved is a not-homed principal whose new tenant could not be found.
type Unresolved struct {
	DID string
	Err error
}

// Regroup re-resolves principals that a region reported as not-homed. It
// groups them by their new tenant and calls [Do] once. It never runs a
// second re-resolution: a principal that is not-homed again stays unread.
func Regroup[R any](
	ctx context.Context,
	notHomed []string,
	resolve func(ctx context.Context, did string) (string, error),
	read func(ctx context.Context, tenant string, dids []string) (R, error),
	deadline time.Duration,
) (map[string]Result[R], []Unresolved) {
	unique := make(map[string]struct{}, len(notHomed))
	for _, did := range notHomed {
		unique[did] = struct{}{}
	}
	// The lookups run in parallel, so many moved principals cost one round.
	homes := Do(ctx, unique, func(
		ctx context.Context, did string, _ struct{},
	) (string, error) {
		return resolve(ctx, did)
	}, deadline)
	groups := make(map[string][]string)
	var unresolved []Unresolved
	for _, did := range notHomed {
		home := homes[did]
		if home.Err != nil {
			unresolved = append(unresolved, Unresolved{DID: did, Err: home.Err})
			continue
		}
		groups[home.Value] = append(groups[home.Value], did)
	}
	return Do(ctx, groups, read, deadline), unresolved
}
