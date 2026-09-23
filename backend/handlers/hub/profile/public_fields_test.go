package profile

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/db/sqlc"
)

type publicFieldsQueryStub struct {
	params sqlc.SetHubPublicProfileParams
	err    error
}

func (q *publicFieldsQueryStub) SetHubPublicProfile(
	_ context.Context, params sqlc.SetHubPublicProfileParams,
) (sqlc.SetHubPublicProfileRow, error) {
	q.params = params
	return sqlc.SetHubPublicProfileRow{}, q.err
}

func TestSetPublicFieldsUsesOwnedAuditedQuery(t *testing.T) {
	did := pgtype.UUID{Bytes: [16]byte{1, 2, 3}, Valid: true}
	biography := profilespec.ProfileLongText("Developer")
	q := &publicFieldsQueryStub{}
	result, apiProblem, err := setPublicFields(
		context.Background(), q, did, "sgp", common.IdempotencyKey("key-1"),
		profilespec.SetPublicFieldsRequest{
			DisplayName: "Ada", Biography: &biography,
		},
	)
	if err != nil || apiProblem != nil || result.Status != http.StatusNoContent {
		t.Fatalf("result = %+v, problem = %+v, error = %v", result, apiProblem, err)
	}
	if q.params.HubUserDid != did || q.params.TenantID != "sgp" ||
		q.params.DisplayName != "Ada" || q.params.Biography.String != "Developer" ||
		!q.params.Biography.Valid || q.params.IdempotencyKey.String != "key-1" {
		t.Fatalf("query parameters = %+v", q.params)
	}
	q.err = pgx.ErrNoRows
	result, apiProblem, err = setPublicFields(
		context.Background(), q, did, "sgp", "key-2",
		profilespec.SetPublicFieldsRequest{DisplayName: "Ada"},
	)
	if err != nil || apiProblem != nil || result.Status != http.StatusNoContent ||
		q.params.Biography.Valid {
		t.Fatalf("no-op result = %+v, problem = %+v, error = %v", result, apiProblem, err)
	}
	q.err = errors.New("database unavailable")
	_, _, err = setPublicFields(
		context.Background(), q, did, "sgp", "key-3",
		profilespec.SetPublicFieldsRequest{DisplayName: "Ada"},
	)
	if err == nil {
		t.Fatal("database failure was ignored")
	}
}
