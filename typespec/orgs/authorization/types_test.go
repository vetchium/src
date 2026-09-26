package authorization

import "testing"

func TestHolds(t *testing.T) {
	t.Parallel()
	if !Holds([]OrgPermissionID{"org:future", "org:superadmin"}, Superadmin) {
		t.Fatal("held permission not found")
	}
	if Holds([]OrgPermissionID{"org:future"}, Superadmin) {
		t.Fatal("unheld permission reported as held")
	}
}
