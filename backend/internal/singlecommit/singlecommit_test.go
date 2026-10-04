package singlecommit_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"

	"backend/internal/singlecommit"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), singlecommit.Analyzer,
		"backend/handlers/example", "backend/internal/worker")
}

func TestWritesData(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		sql    string
		writes bool
	}{
		{"SELECT 1", false},
		{"SELECT id FROM t FOR UPDATE", false},
		{"SELECT id FROM t FOR NO KEY UPDATE", false},
		{"SELECT 'DELETE' AS word", false},
		{"-- name: X :one\nSELECT 1 -- then UPDATE", false},
		{"INSERT INTO t VALUES (1)", true},
		{"insert into t values (1) on conflict do update set x = 1", true},
		{"WITH d AS (DELETE FROM t RETURNING id) SELECT id FROM d", true},
		{"UPDATE t SET x = 1", true},
	} {
		if got := singlecommit.WritesData(test.sql); got != test.writes {
			t.Errorf("WritesData(%q) = %v, want %v", test.sql, got, test.writes)
		}
	}
}
