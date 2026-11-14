package openings

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
	"backend/internal/openingsearch"
	"backend/internal/publicopeningclient"
	"backend/internal/regions"
)

type searchQueries struct {
	sqlc.Querier
	idealJob      pgtype.Text
	idealJobError error
	idealJobReads atomic.Int32
	searches      atomic.Int32
	searched      sqlc.SearchOpeningsParams
}

func (*searchQueries) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid:      pgtype.UUID{Bytes: [16]byte{6: 0x40, 8: 0x80, 15: 1}, Valid: true},
		HubSessionID:    pgtype.UUID{Bytes: [16]byte{6: 0x40, 8: 0x80, 15: 2}, Valid: true},
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}, nil
}

func (q *searchQueries) GetHubIdealJob(context.Context, pgtype.UUID) (pgtype.Text, error) {
	q.idealJobReads.Add(1)
	return q.idealJob, q.idealJobError
}

func (q *searchQueries) SearchOpenings(
	_ context.Context, params sqlc.SearchOpeningsParams,
) ([]sqlc.SearchOpeningsRow, error) {
	q.searches.Add(1)
	q.searched = params
	return nil, nil
}

func (*searchQueries) SuggestOpeningOrgs(
	context.Context, sqlc.SuggestOpeningOrgsParams,
) ([]sqlc.SuggestOpeningOrgsRow, error) {
	return nil, nil
}

// relay records each relay body and answers an empty page.
type relay struct {
	server *httptest.Server
	calls  atomic.Int32
	body   atomic.Value
}

func newRelay(t *testing.T) *relay {
	t.Helper()
	r := &relay{}
	r.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.calls.Add(1)
		data, _ := io.ReadAll(req.Body)
		r.body.Store(string(data))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openings":[]}`))
	}))
	t.Cleanup(r.server.Close)
	return r
}

func callSearch(
	t *testing.T, queries *searchQueries, relay *relay, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	catalog, err := regions.Load(filepath.Join(
		"..", "..", "..", "..", "config", "ci", "signup-regions.json"))
	if err != nil {
		t.Fatal(err)
	}
	s := &hubruntime.Server{
		Runtime:       apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Queries:       queries,
		Regions:       catalog,
		TenantID:      "sgp",
		OpeningSearch: openingsearch.Reader{Queries: queries, TenantID: "sgp"},
		Openings:      publicopeningclient.NewRelay(relay.server.URL, "relay-secret", time.Second),
	}
	request := httptest.NewRequest(http.MethodPost, "/api/hub/search-openings",
		strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	middleware.HubAuth(s)(Search(s)).ServeHTTP(response, request)
	return response
}

func TestSearchWithoutIdealJobIsRefusedBeforeRouting(t *testing.T) {
	t.Parallel()
	for _, body := range []string{
		`{"sort":"ideal_job_match"}`,
		`{"sort":"ideal_job_match","region":"usa1"}`,
	} {
		queries := &searchQueries{}
		relay := newRelay(t)
		response := callSearch(t, queries, relay, body)
		var details problem.Details
		if err := json.Unmarshal(response.Body.Bytes(), &details); err != nil ||
			response.Code != http.StatusUnprocessableEntity ||
			details.Type != hubproblem.IdealJobMissingError.Type {
			t.Fatalf("%s: status=%d body=%s", body, response.Code, response.Body.String())
		}
		if queries.searches.Load() != 0 || relay.calls.Load() != 0 {
			t.Fatalf("%s: searched locally %d times, relayed %d times",
				body, queries.searches.Load(), relay.calls.Load())
		}
	}
}

func TestSearchSendsIdealJobTextOnlyUnderTheMatchSort(t *testing.T) {
	t.Parallel()
	const text = "Go backend engineer"
	saved := pgtype.Text{String: text, Valid: true}

	queries := &searchQueries{idealJob: saved}
	response := callSearch(t, queries, newRelay(t), `{"sort":"ideal_job_match"}`)
	if response.Code != http.StatusOK ||
		queries.searched.IdealJobText != (pgtype.Text{String: text, Valid: true}) {
		t.Fatalf("local match: status=%d params=%+v", response.Code, queries.searched)
	}

	queries = &searchQueries{idealJob: saved}
	relay := newRelay(t)
	response = callSearch(t, queries, relay, `{"sort":"ideal_job_match","region":"usa1"}`)
	var sent openingsspec.RelaySearchOpeningsRequest
	if response.Code != http.StatusOK ||
		json.Unmarshal([]byte(relay.body.Load().(string)), &sent) != nil ||
		sent.TenantID != "usa1" || sent.Query.EffectiveSort() != openingsspec.SortIdealJobMatch ||
		sent.Query.IdealJobText == nil || *sent.Query.IdealJobText != text {
		t.Fatalf("remote match: status=%d body=%v", response.Code, relay.body.Load())
	}

	for _, body := range []string{`{}`, `{"sort":"newest","region":"usa1"}`} {
		queries = &searchQueries{idealJob: saved}
		relay = newRelay(t)
		response = callSearch(t, queries, relay, body)
		if response.Code != http.StatusOK || queries.idealJobReads.Load() != 0 ||
			queries.searched.IdealJobText.Valid {
			t.Fatalf("%s: status=%d params=%+v", body, response.Code, queries.searched)
		}
		if sentBody, ok := relay.body.Load().(string); ok &&
			strings.Contains(sentBody, "ideal_job_text") {
			t.Fatalf("%s: relay body %s", body, sentBody)
		}
	}
}

func TestSearchIdealJobReadFailures(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		err  error
		code int
	}{
		{pgx.ErrNoRows, http.StatusUnauthorized},
		{errors.New("database unavailable"), http.StatusInternalServerError},
	} {
		queries := &searchQueries{idealJobError: tc.err}
		response := callSearch(t, queries, newRelay(t), `{"sort":"ideal_job_match"}`)
		if response.Code != tc.code || queries.searches.Load() != 0 {
			t.Fatalf("%v: status=%d body=%s", tc.err, response.Code, response.Body.String())
		}
	}
}
