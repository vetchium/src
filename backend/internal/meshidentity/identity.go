// Package meshidentity carries tenant identity derived from a verified mesh
// client certificate. Request data must never populate this context value.
package meshidentity

import (
	"context"

	directoryspec "github.com/vetchium/src/typespec/directory"
)

type contextKey struct{}

func WithTenant(
	ctx context.Context, tenantID directoryspec.TenantID,
) context.Context {
	return context.WithValue(ctx, contextKey{}, tenantID)
}

func TenantFromContext(
	ctx context.Context,
) (directoryspec.TenantID, bool) {
	tenantID, ok := ctx.Value(contextKey{}).(directoryspec.TenantID)
	return tenantID, ok && directoryspec.IsTenantID(tenantID)
}
