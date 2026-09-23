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
