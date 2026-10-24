package hubapplications

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/db/sqlc"
)

// TestSQLStatusAgreesWithStatusIntegration keeps vetchium.hub_application_status,
// which reads filter by, in step with Status for every state and stage kind
// the schema defines, so neither authority drifts from the other.
func TestSQLStatusAgreesWithStatusIntegration(t *testing.T) {
	databaseURL := os.Getenv("TENANT_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TENANT_DATABASE_URL is not set")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })
	enum := func(sql string) []string {
		rows, err := conn.Query(ctx, sql)
		if err != nil {
			t.Fatal(err)
		}
		values, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return values
	}
	states := enum(`SELECT unnest(enum_range(NULL::vetchium.org_application_state))::text`)
	kinds := enum(`SELECT unnest(enum_range(NULL::vetchium.pipeline_stage_kind))::text`)
	stages := []sqlc.NullVetchiumPipelineStageKind{{}}
	for _, kind := range kinds {
		stages = append(stages, sqlc.NullVetchiumPipelineStageKind{
			VetchiumPipelineStageKind: sqlc.VetchiumPipelineStageKind(kind), Valid: true,
		})
	}
	for _, state := range states {
		for _, stage := range stages {
			want, err := Status(sqlc.VetchiumOrgApplicationState(state), stage)
			if err != nil {
				t.Fatalf("Status(%s, %v): %v", state, stage, err)
			}
			kind := pgtype.Text{
				String: string(stage.VetchiumPipelineStageKind), Valid: stage.Valid,
			}
			var got pgtype.Text
			if err := conn.QueryRow(ctx, `SELECT vetchium.hub_application_status(
                $1::text::vetchium.org_application_state,
                $2::text::vetchium.pipeline_stage_kind)`, state, kind).
				Scan(&got); err != nil {
				t.Fatal(err)
			}
			if !got.Valid || got.String != string(want) {
				t.Fatalf("hub_application_status(%s, %v) = %v, want %s",
					state, stage, got, want)
			}
		}
	}
}
