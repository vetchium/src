package profile

import (
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

func TestProfileMutationHelpers(t *testing.T) {
	problem, err := conflictOnNoRows(pgx.ErrNoRows)
	if err != nil || problem == nil ||
		!reflect.DeepEqual(problem.Details, hubproblem.ProfileConflictError) {
		t.Fatalf("missing row = %+v, %v", problem, err)
	}
	databaseError := errors.New("database failed")
	problem, err = conflictOnNoRows(databaseError)
	if problem != nil || !errors.Is(err, databaseError) {
		t.Fatalf("database failure = %+v, %v", problem, err)
	}
	if got := profileMonth("2020-06"); !got.Valid ||
		got.Time.Format("2006-01-02") != "2020-06-01" {
		t.Fatalf("month = %+v", got)
	}
	if got := optionalProfileMonth(nil); got.Valid {
		t.Fatalf("nil month = %+v", got)
	}
	text := profilespec.ProfileLongText("Developer")
	if got := optionalProfileText(&text); !got.Valid || got.String != "Developer" {
		t.Fatalf("text = %+v", got)
	}
	if got := optionalProfileText((*profilespec.ProfileLongText)(nil)); got.Valid {
		t.Fatalf("nil text = %+v", got)
	}
}

func TestProfessionalEmailConflictMapping(t *testing.T) {
	if !professionalEmailConflict(pgx.ErrNoRows) ||
		!professionalEmailConflict(&pgconn.PgError{Code: "23505"}) ||
		professionalEmailConflict(&pgconn.PgError{Code: "23514"}) {
		t.Fatal("professional email conflict classification changed")
	}
}

func TestWebsiteConflictMapping(t *testing.T) {
	for name, err := range map[string]error{
		"no row: missing entry, full profile, or duplicate": pgx.ErrNoRows,
		"racing duplicate reached the unique index": &pgconn.PgError{
			Code: "23505", ConstraintName: "hub_websites_user_url_key",
		},
		"racing insert reached the limit trigger": &pgconn.PgError{
			Code:    "23514",
			Message: "hub_websites profile entry limit is 10",
		},
	} {
		problem, unexpected := websiteConflict(err)
		if unexpected != nil || problem == nil ||
			!reflect.DeepEqual(problem.Details, hubproblem.ProfileConflictError) {
			t.Errorf("%s = %+v, %v", name, problem, unexpected)
		}
	}
	for name, err := range map[string]error{
		"another unique constraint": &pgconn.PgError{
			Code: "23505", ConstraintName: "audit_events_pkey",
		},
		"the URL check constraint": &pgconn.PgError{
			Code: "23514", ConstraintName: "hub_websites_url_check",
			Message: `new row violates check constraint "hub_websites_url_check"`,
		},
		"another table's limit trigger": &pgconn.PgError{
			Code:    "23514",
			Message: "hub_certifications profile entry limit is 50",
		},
		"a database failure": errors.New("database failed"),
	} {
		problem, unexpected := websiteConflict(err)
		if problem != nil || unexpected == nil {
			t.Errorf("%s = %+v, %v; want a passed-through error",
				name, problem, unexpected)
		}
	}
}
