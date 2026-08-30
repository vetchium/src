package hubsignupdomains

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/admin/authorization"
	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/problem"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/handlers/admin/internal/handlertest"
	adminruntime "backend/internal/admin"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
)

type hubSignupDomainsDBStub struct {
	sqlc.Querier
	permissions  []string
	authErr      error
	listRows     []sqlc.ListHubSignupDomainsRow
	listParams   sqlc.ListHubSignupDomainsParams
	listErr      error
	createRow    sqlc.CreateHubSignupDomainRow
	createParams sqlc.CreateHubSignupDomainParams
	createErr    error
	updateRow    sqlc.UpdateHubSignupDomainRow
	updateParams sqlc.UpdateHubSignupDomainParams
	updateErr    error
}

func (s *hubSignupDomainsDBStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	if s.authErr != nil {
		return sqlc.AuthenticateAdminSessionRow{}, s.authErr
	}
	return sqlc.AuthenticateAdminSessionRow{
		AdminUserID:     handlertest.UUID(10),
		AdminSessionID:  handlertest.UUID(11),
		AuthenticatedAt: pgtype.Timestamptz{Time: handlertest.Now, Valid: true},
		Permissions:     s.permissions,
	}, nil
}

func (s *hubSignupDomainsDBStub) ListHubSignupDomains(
	_ context.Context, params sqlc.ListHubSignupDomainsParams,
) ([]sqlc.ListHubSignupDomainsRow, error) {
	s.listParams = params
	return s.listRows, s.listErr
}

func (s *hubSignupDomainsDBStub) CreateHubSignupDomain(
	_ context.Context, params sqlc.CreateHubSignupDomainParams,
) (sqlc.CreateHubSignupDomainRow, error) {
	s.createParams = params
	return s.createRow, s.createErr
}

func (s *hubSignupDomainsDBStub) UpdateHubSignupDomain(
	_ context.Context, params sqlc.UpdateHubSignupDomainParams,
) (sqlc.UpdateHubSignupDomainRow, error) {
	s.updateParams = params
	return s.updateRow, s.updateErr
}

func hubSignupDomainRow(
	id int, domain string, state sqlc.VetchiumHubSignupDomainState,
	disabledComment ...string,
) sqlc.ListHubSignupDomainsRow {
	zone := time.FixedZone("test", 5*60*60+30*60)
	row := sqlc.ListHubSignupDomainsRow{
		HubSignupDomainID:    handlertest.UUID(byte(id)),
		Domain:               domain,
		HubSignupDomainState: state,
		CreatedAt: pgtype.Timestamptz{
			Time:  time.Date(2026, 8, 20, 12, 0, 0, 0, zone),
			Valid: true,
		},
		UpdatedAt: pgtype.Timestamptz{
			Time:  time.Date(2026, 8, 21, 12, 0, 0, 0, zone),
			Valid: true,
		},
	}
	if len(disabledComment) != 0 {
		row.DisabledComment = disabledComment[0]
	}
	return row
}

func hubSignupDomainHandler(
	db *hubSignupDomainsDBStub,
	permission authorization.AdminPermission,
	handler func(*adminruntime.Server) http.HandlerFunc,
) http.Handler {
	server := handlertest.Server(db, handlertest.Now)
	return middleware.AdminAuth(server)(
		middleware.RequireAdminPermission(server, string(permission))(
			handler(server),
		),
	)
}

func performHubSignupDomainRequest(
	handler http.Handler, body string, authenticated bool,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/hub-signup-domain-test",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	if authenticated {
		request.Header.Set("Authorization", "Bearer session-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestListHubSignupDomainsNormalizesFiltersAndPaginates(t *testing.T) {
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ViewHubSignupDomains)},
		listRows: []sqlc.ListHubSignupDomainsRow{
			hubSignupDomainRow(
				20, "example.com", sqlc.VetchiumHubSignupDomainStateActive,
			),
			hubSignupDomainRow(
				21, "example.org", sqlc.VetchiumHubSignupDomainStateDisabled,
				"Temporarily suspended",
			),
		},
	}
	handler := hubSignupDomainHandler(
		db, authorization.ViewHubSignupDomains, ListHubSignupDomains,
	)
	response := performHubSignupDomainRequest(
		handler,
		`{"limit":1,"filter_search":"  EXAMPLE  ","filter_state":"active"}`,
		true,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if !db.listParams.FilterSearch.Valid ||
		db.listParams.FilterSearch.String != "example" ||
		!db.listParams.FilterState.Valid ||
		db.listParams.PageLimit != 2 {
		t.Fatalf("list params = %+v", db.listParams)
	}
	var listed hubsignupdomains.ListResponse
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Domains) != 1 || listed.NextPaginationKey == nil {
		t.Fatalf("list response = %+v", listed)
	}
	if listed.Domains[0].CreatedAt.Location() != time.UTC ||
		listed.Domains[0].UpdatedAt.Location() != time.UTC {
		t.Fatalf("timestamps are not UTC: %+v", listed.Domains[0])
	}

	continued := performHubSignupDomainRequest(
		handler,
		`{"limit":1,"filter_search":"example","filter_state":"active",`+
			`"pagination_key":"`+string(*listed.NextPaginationKey)+`"}`,
		true,
	)
	if continued.Code != http.StatusOK ||
		!db.listParams.BeforeCreatedAt.Valid ||
		!db.listParams.BeforeDomainID.Valid {
		t.Fatalf("continued status = %d, params = %+v",
			continued.Code, db.listParams)
	}

	changed := performHubSignupDomainRequest(
		handler,
		`{"limit":1,"filter_search":"other","filter_state":"active",`+
			`"pagination_key":"`+string(*listed.NextPaginationKey)+`"}`,
		true,
	)
	handlertest.AssertProblemResponse(
		t, changed, http.StatusBadRequest,
		problem.InvalidPaginationKeyError.Type, nil,
	)
}

func TestListHubSignupDomainsReturnsAnEmptyArray(t *testing.T) {
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ViewHubSignupDomains)},
	}
	response := performHubSignupDomainRequest(hubSignupDomainHandler(
		db, authorization.ViewHubSignupDomains, ListHubSignupDomains,
	), `{}`, true)
	if response.Code != http.StatusOK ||
		strings.TrimSpace(response.Body.String()) != "{\"domains\":[]}" {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestListHubSignupDomainsRejectsInvalidRequestsAndFailures(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		problemType string
		fields      []string
	}{
		{name: "malformed", body: `{`, problemType: problem.InvalidJSONError.Type},
		{
			name: "unknown field", body: `{"unknown":true}`,
			problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "invalid fields",
			body: `{"limit":0,"pagination_key":"","filter_search":" ",` +
				`"filter_state":"retired"}`,
			problemType: problem.ValidationFailedError.Type,
			fields: []string{
				"limit", "pagination_key", "filter_search", "filter_state",
			},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			db := &hubSignupDomainsDBStub{
				permissions: []string{
					string(authorization.ViewHubSignupDomains),
				},
			}
			response := performHubSignupDomainRequest(hubSignupDomainHandler(
				db, authorization.ViewHubSignupDomains, ListHubSignupDomains,
			), testCase.body, true)
			handlertest.AssertProblemResponse(
				t, response, http.StatusBadRequest,
				testCase.problemType, testCase.fields,
			)
		})
	}

	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ViewHubSignupDomains)},
		listErr:     errors.New("database unavailable"),
	}
	response := performHubSignupDomainRequest(hubSignupDomainHandler(
		db, authorization.ViewHubSignupDomains, ListHubSignupDomains,
	), `{}`, true)
	handlertest.AssertProblemResponse(
		t, response, http.StatusInternalServerError,
		problem.InternalServerError.Type, nil,
	)
}

func TestCreateHubSignupDomainHandlesSuccessConflictAndFailure(t *testing.T) {
	row := hubSignupDomainRow(
		30, "example.com", sqlc.VetchiumHubSignupDomainStateActive,
	)
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ManageHubSignupDomains)},
		createRow: sqlc.CreateHubSignupDomainRow{
			Result:               "ok",
			HubSignupDomainID:    row.HubSignupDomainID,
			Domain:               row.Domain,
			HubSignupDomainState: row.HubSignupDomainState,
			DisabledComment:      row.DisabledComment,
			CreatedAt:            row.CreatedAt,
			UpdatedAt:            row.UpdatedAt,
		},
	}
	handler := hubSignupDomainHandler(
		db, authorization.ManageHubSignupDomains, CreateHubSignupDomain,
	)
	response := performHubSignupDomainRequest(
		handler, `{"domain":"  EXAMPLE.COM.  "}`, true,
	)
	if response.Code != http.StatusCreated ||
		db.createParams.Domain != "example.com" ||
		db.createParams.State != sqlc.VetchiumHubSignupDomainStateActive {
		t.Fatalf("response = %d %s, params = %+v",
			response.Code, response.Body.String(), db.createParams)
	}
	// The audit event is written by the same statement, so the tenant and the
	// acting administrator have to reach the query.
	if db.createParams.TenantID != "test" ||
		db.createParams.ActorAdminUserID != handlertest.UUID(10) {
		t.Fatalf("audit context = %+v", db.createParams)
	}

	db.createRow = sqlc.CreateHubSignupDomainRow{Result: "already_exists"}
	response = performHubSignupDomainRequest(
		handler, `{"domain":"example.com","state":"disabled",`+
			`"disabled_comment":"Contract ended"}`, true,
	)
	handlertest.AssertProblemResponse(
		t, response, http.StatusConflict,
		adminproblem.HubSignupDomainAlreadyExistsError.Type, nil,
	)

	db.createErr = errors.New("database unavailable")
	response = performHubSignupDomainRequest(
		handler, `{"domain":"other.example"}`, true,
	)
	handlertest.AssertProblemResponse(
		t, response, http.StatusInternalServerError,
		problem.InternalServerError.Type, nil,
	)
}

func TestCreateHubSignupDomainReportsEveryInvalidField(t *testing.T) {
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ManageHubSignupDomains)},
	}
	response := performHubSignupDomainRequest(hubSignupDomainHandler(
		db, authorization.ManageHubSignupDomains, CreateHubSignupDomain,
	), `{"domain":"*.example.com","state":"retired"}`, true)
	handlertest.AssertProblemResponse(
		t, response, http.StatusBadRequest,
		problem.ValidationFailedError.Type, []string{"domain", "state"},
	)
}

func TestHubSignupDomainStateRequiresMatchingDisableComment(t *testing.T) {
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ManageHubSignupDomains)},
	}
	handler := hubSignupDomainHandler(
		db, authorization.ManageHubSignupDomains, CreateHubSignupDomain,
	)
	for _, body := range []string{
		`{"domain":"example.com","state":"disabled"}`,
		`{"domain":"example.com","state":"disabled",` +
			`"disabled_comment":"   "}`,
		`{"domain":"example.com","state":"active",` +
			`"disabled_comment":"Not applicable"}`,
	} {
		response := performHubSignupDomainRequest(handler, body, true)
		handlertest.AssertProblemResponse(
			t, response, http.StatusBadRequest,
			problem.ValidationFailedError.Type, []string{"disabled_comment"},
		)
	}
}

func TestUpdateHubSignupDomainHandlesEveryOutcome(t *testing.T) {
	row := hubSignupDomainRow(
		40, "updated.example", sqlc.VetchiumHubSignupDomainStateDisabled,
		"  Partner access suspended  ",
	)
	db := &hubSignupDomainsDBStub{
		permissions: []string{string(authorization.ManageHubSignupDomains)},
		updateRow: sqlc.UpdateHubSignupDomainRow{
			Result:               "ok",
			HubSignupDomainID:    row.HubSignupDomainID,
			Domain:               row.Domain,
			HubSignupDomainState: row.HubSignupDomainState,
			DisabledComment:      "Partner access suspended",
			CreatedAt:            row.CreatedAt,
			UpdatedAt:            row.UpdatedAt,
		},
	}
	handler := hubSignupDomainHandler(
		db, authorization.ManageHubSignupDomains, UpdateHubSignupDomain,
	)
	id := dbvalue.FormatUUID(row.HubSignupDomainID)
	body := `{"hub_signup_domain_id":"` + id +
		`","domain":" UPDATED.EXAMPLE. ","state":"disabled",` +
		`"disabled_comment":"  Partner access suspended  "}`
	response := performHubSignupDomainRequest(handler, body, true)
	if response.Code != http.StatusOK ||
		db.updateParams.TargetDomain != "updated.example" ||
		db.updateParams.State != sqlc.VetchiumHubSignupDomainStateDisabled ||
		!db.updateParams.DisabledComment.Valid ||
		db.updateParams.DisabledComment.String != "Partner access suspended" {
		t.Fatalf("response = %d %s, params = %+v",
			response.Code, response.Body.String(), db.updateParams)
	}
	if db.updateParams.TenantID != "test" ||
		db.updateParams.ActorAdminUserID != handlertest.UUID(10) {
		t.Fatalf("audit context = %+v", db.updateParams)
	}

	for result, details := range map[string]problem.Details{
		"not_found":      adminproblem.HubSignupDomainNotFoundError,
		"already_exists": adminproblem.HubSignupDomainAlreadyExistsError,
	} {
		db.updateRow = sqlc.UpdateHubSignupDomainRow{Result: result}
		response = performHubSignupDomainRequest(handler, body, true)
		handlertest.AssertProblemResponse(t, response, details.Status, details.Type, nil)
	}

	db.updateErr = errors.New("database unavailable")
	response = performHubSignupDomainRequest(handler, body, true)
	handlertest.AssertProblemResponse(
		t, response, http.StatusInternalServerError,
		problem.InternalServerError.Type, nil,
	)

	db.updateErr = &pgconn.PgError{
		Code: "23505", ConstraintName: "hub_signup_domains_domain_key",
	}
	response = performHubSignupDomainRequest(handler, body, true)
	handlertest.AssertProblemResponse(
		t, response, http.StatusConflict,
		adminproblem.HubSignupDomainAlreadyExistsError.Type, nil,
	)

	db.updateErr = nil
	response = performHubSignupDomainRequest(
		handler,
		`{"hub_signup_domain_id":"bad","domain":"bad","state":"retired"}`,
		true,
	)
	handlertest.AssertProblemResponse(
		t, response, http.StatusBadRequest,
		problem.ValidationFailedError.Type,
		[]string{"hub_signup_domain_id", "domain", "state"},
	)
}

func TestHubSignupDomainOperationsRequireAuthenticationAndPermission(
	t *testing.T,
) {
	operations := []struct {
		name       string
		permission authorization.AdminPermission
		handler    func(*adminruntime.Server) http.HandlerFunc
		body       string
	}{
		{
			name: "list", permission: authorization.ViewHubSignupDomains,
			handler: ListHubSignupDomains, body: `{}`,
		},
		{
			name: "create", permission: authorization.ManageHubSignupDomains,
			handler: CreateHubSignupDomain, body: `{"domain":"example.com"}`,
		},
		{
			name: "update", permission: authorization.ManageHubSignupDomains,
			handler: UpdateHubSignupDomain,
			body: `{"hub_signup_domain_id":` +
				`"00000000-0000-4000-8000-000000000001",` +
				`"domain":"example.com","state":"active"}`,
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			db := &hubSignupDomainsDBStub{}
			handler := hubSignupDomainHandler(
				db, operation.permission, operation.handler,
			)
			unauthenticated := performHubSignupDomainRequest(
				handler, operation.body, false,
			)
			handlertest.AssertProblemResponse(
				t, unauthenticated, http.StatusUnauthorized,
				adminproblem.AdminAuthenticationRequiredError.Type, nil,
			)
			forbidden := performHubSignupDomainRequest(
				handler, operation.body, true,
			)
			handlertest.AssertProblemResponse(
				t, forbidden, http.StatusForbidden,
				adminproblem.AdminPermissionRequiredError.Type, nil,
			)
		})
	}
}

func TestHubSignupDomainPermissionsAreDistinct(t *testing.T) {
	if slices.Contains(
		authorization.Implies(authorization.ManageUsers),
		authorization.ViewHubSignupDomains,
	) {
		t.Fatal("managing administrators must not imply domain access")
	}
}
