package fanout

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"slices"
	"sort"

	"github.com/vetchium/src/typespec/common"
)

// ErrInvalidCursor means a pagination key is not one that [EncodeCursor]
// made.
var ErrInvalidCursor = errors.New("fanout: invalid cursor")

// Cursor maps a tenant ID to that tenant's pagination key. A tenant that is
// absent is done. An empty key means "from the start".
type Cursor map[string]string

// EncodeCursor returns the opaque pagination key for c.
func EncodeCursor(c Cursor) (common.PaginationKey, error) {
	raw, err := json.Marshal(map[string]string(c))
	if err != nil {
		return "", err
	}
	key := common.PaginationKey(base64.RawURLEncoding.EncodeToString(raw))
	if !common.IsPaginationKey(key) {
		return "", ErrInvalidCursor
	}
	return key, nil
}

// DecodeCursor reverses [EncodeCursor]. It refuses any other shape.
func DecodeCursor(key common.PaginationKey) (Cursor, error) {
	if !common.IsPaginationKey(key) {
		return nil, ErrInvalidCursor
	}
	raw, err := base64.RawURLEncoding.DecodeString(string(key))
	if err != nil {
		return nil, ErrInvalidCursor
	}
	var c map[string]string
	if err := json.Unmarshal(raw, &c); err != nil || len(c) == 0 {
		return nil, ErrInvalidCursor
	}
	return Cursor(c), nil
}

// Page is one tenant's answer to a sorted list read.
type Page[T any] struct {
	// Items are in the sort order of the merge.
	Items []T
	// Keys[i] is the tenant's pagination key that resumes after Items[i].
	Keys []string
	// Prev is the key the tenant was asked to resume from.
	Prev string
	// Next is the key that resumes after the last item of Items.
	Next string
	// Done is true when the tenant has no more items after Items.
	Done bool
	Err  error
}

// Merge takes the first limit items of all pages in the order of less
// (PST-RD-002). It sets a tenant's cursor to its last taken item and keeps
// the old cursor when none was taken. It drops a tenant only when the tenant
// answered Done and all its items were taken. A tenant with an error keeps
// its old cursor and sets partial. next is nil when every tenant is done.
func Merge[T any](
	pages map[string]Page[T],
	less func(a, b T) bool,
	limit int,
) (items []T, next Cursor, partial bool) {
	type entry struct {
		item   T
		tenant string
		index  int
	}
	tenants := make([]string, 0, len(pages))
	for tenant := range pages {
		tenants = append(tenants, tenant)
	}
	sort.Strings(tenants)

	var all []entry
	for _, tenant := range tenants {
		page := pages[tenant]
		if page.Err != nil {
			continue
		}
		for i, item := range page.Items {
			all = append(all, entry{item, tenant, i})
		}
	}
	slices.SortStableFunc(all, func(a, b entry) int {
		switch {
		case less(a.item, b.item):
			return -1
		case less(b.item, a.item):
			return 1
		}
		return 0
	})
	if limit < 0 {
		limit = 0
	}
	if len(all) > limit {
		all = all[:limit]
	}

	taken := make(map[string]int, len(pages))
	for _, e := range all {
		items = append(items, e.item)
		taken[e.tenant]++
	}

	next = Cursor{}
	for _, tenant := range tenants {
		page := pages[tenant]
		if page.Err != nil {
			partial = true
			next[tenant] = page.Prev
			continue
		}
		n := taken[tenant]
		switch {
		case n == len(page.Items) && page.Done:
			// Finished: leave the tenant out of the cursor.
		case n == len(page.Items) && n > 0:
			next[tenant] = page.Next
		case n == len(page.Items):
			// Nothing came back and more may exist.
			next[tenant] = page.Next
			if page.Next == "" {
				next[tenant] = page.Prev
			}
		case n == 0:
			next[tenant] = page.Prev
		case len(page.Keys) < n:
			// A page without keys cannot resume mid-page. Repeating items
			// is safer than skipping them.
			next[tenant] = page.Prev
		default:
			next[tenant] = page.Keys[n-1]
		}
	}
	if len(next) == 0 {
		next = nil
	}
	return items, next, partial
}
