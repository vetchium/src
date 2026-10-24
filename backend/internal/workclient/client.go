// Package workclient reads a provider's routed work and assigned Openings
// from a client's tenant, through the local relay or a tenant's mutually
// authenticated peer listener.
package workclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 4 << 20

var ErrInvalidResponse = errors.New("invalid provider work response")

// Outcome is a tenant's answer: a result, or the problem it declared.
type Outcome[T any] struct {
	Result  *T
	Problem *problem.Details
}

type Client struct {
	baseURL    string
	credential string
	baseTLS    *tls.Config
	timeout    time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		credential: credential, timeout: timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

// The relay and peer paths of the four reads.
const (
	listWork         = "provider-work/list"
	getWork          = "provider-work/get"
	listJobs         = "provider-jobs/list"
	getJob           = "provider-jobs/get"
	listAttribution  = "provider-attribution/list"
	countAttribution = "provider-attribution/count"
	getStatement     = "provider-statements/get"
)

func (c *Client) RelayListWork(
	ctx context.Context, request work.RelayListWorkRequest,
) (Outcome[work.PeerListWorkResponse], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+listWork, request, nil,
		func(r work.PeerListWorkResponse) bool { return validList(r, request.Request) })
}

func (c *Client) PeerListWork(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerListWorkRequest,
) (Outcome[work.PeerListWorkResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, listWork)
	if err != nil {
		return Outcome[work.PeerListWorkResponse]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.PeerListWorkResponse) bool { return validList(r, request) })
}

func (c *Client) RelayGetWork(
	ctx context.Context, request work.RelayGetWorkRequest,
) (Outcome[work.WorkDetail], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+getWork, request, nil,
		func(r work.WorkDetail) bool { return validDetail(r, request.Request) })
}

func (c *Client) PeerGetWork(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerGetWorkRequest,
) (Outcome[work.WorkDetail], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, getWork)
	if err != nil {
		return Outcome[work.WorkDetail]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.WorkDetail) bool { return validDetail(r, request) })
}

func (c *Client) RelayListJobs(
	ctx context.Context, request work.RelayListJobsRequest,
) (Outcome[work.PeerListJobsResponse], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+listJobs, request, nil,
		func(r work.PeerListJobsResponse) bool { return validJobs(r, request.Request) })
}

func (c *Client) PeerListJobs(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerListJobsRequest,
) (Outcome[work.PeerListJobsResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, listJobs)
	if err != nil {
		return Outcome[work.PeerListJobsResponse]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.PeerListJobsResponse) bool { return validJobs(r, request) })
}

func (c *Client) RelayGetJob(
	ctx context.Context, request work.RelayGetJobRequest,
) (Outcome[work.JobDetail], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+getJob, request, nil,
		func(r work.JobDetail) bool { return validJob(r, request.Request) })
}

func (c *Client) PeerGetJob(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerGetJobRequest,
) (Outcome[work.JobDetail], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, getJob)
	if err != nil {
		return Outcome[work.JobDetail]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.JobDetail) bool { return validJob(r, request) })
}

func (c *Client) RelayListCreditedApplications(
	ctx context.Context, request work.RelayListCreditedApplicationsRequest,
) (Outcome[work.PeerListCreditedApplicationsResponse], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+listAttribution, request, nil,
		func(r work.PeerListCreditedApplicationsResponse) bool {
			return validAttribution(r, request.Request)
		})
}

func (c *Client) PeerListCreditedApplications(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerListCreditedApplicationsRequest,
) (Outcome[work.PeerListCreditedApplicationsResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, listAttribution)
	if err != nil {
		return Outcome[work.PeerListCreditedApplicationsResponse]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.PeerListCreditedApplicationsResponse) bool {
			return validAttribution(r, request)
		})
}

func (c *Client) RelayCountCreditedApplications(
	ctx context.Context, request work.RelayCountCreditedApplicationsRequest,
) (Outcome[work.PeerCountCreditedApplicationsResponse], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+countAttribution, request, nil,
		func(r work.PeerCountCreditedApplicationsResponse) bool {
			return validCounts(r, request.Request)
		})
}

func (c *Client) PeerCountCreditedApplications(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerCountCreditedApplicationsRequest,
) (Outcome[work.PeerCountCreditedApplicationsResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, countAttribution)
	if err != nil {
		return Outcome[work.PeerCountCreditedApplicationsResponse]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.PeerCountCreditedApplicationsResponse) bool {
			return validCounts(r, request)
		})
}

func (c *Client) RelayGetActivityStatement(
	ctx context.Context, request work.RelayGetActivityStatementRequest,
) (Outcome[work.PeerGetActivityStatementResponse], error) {
	return call(ctx, c, c.baseURL+"/mesh/"+getStatement, request, nil,
		func(r work.PeerGetActivityStatementResponse) bool {
			return validStatement(r, request.Request)
		})
}

func (c *Client) PeerGetActivityStatement(
	ctx context.Context, tenant directoryspec.TenantID,
	request work.PeerGetActivityStatementRequest,
) (Outcome[work.PeerGetActivityStatementResponse], error) {
	endpoint, tlsConfig, err := c.peerEndpoint(tenant, getStatement)
	if err != nil {
		return Outcome[work.PeerGetActivityStatementResponse]{}, err
	}
	return call(ctx, c, endpoint, request, tlsConfig,
		func(r work.PeerGetActivityStatementResponse) bool {
			return validStatement(r, request)
		})
}

func (c *Client) peerEndpoint(
	tenant directoryspec.TenantID, path string,
) (string, *tls.Config, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return "", nil, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return "https://" + name + ":8443/api/mesh/" + path, tlsConfig, nil
}

// call posts payload and holds the answer to its contract through valid.
func call[T any](
	ctx context.Context, c *Client, endpoint string, payload any,
	tlsConfig *tls.Config, valid func(T) bool,
) (Outcome[T], error) {
	var result T
	details, err := c.read(ctx, endpoint, payload, tlsConfig, &result)
	if err != nil || details != nil {
		return Outcome[T]{Problem: details}, err
	}
	if !valid(result) {
		return Outcome[T]{}, ErrInvalidResponse
	}
	return Outcome[T]{Result: &result}, nil
}

func (c *Client) read(
	ctx context.Context, endpoint string, payload any,
	tlsConfig *tls.Config, result any,
) (*problem.Details, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout: c.timeout, Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read provider work: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponseBytes {
		return nil, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode == http.StatusOK && mediaType == "application/json" {
		return nil, decode(data, result)
	}
	if mediaType != problem.MediaType {
		return nil, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(data, &details); err != nil {
		return nil, err
	}
	if details.Status != response.StatusCode || details.Type == "" {
		return nil, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return &details, nil
}

func decode(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}

// validList holds a tenant to its contract: the merge in orgs-api trusts the
// order, the page size, and the filters.
func validList(result work.PeerListWorkResponse, asked work.PeerListWorkRequest) bool {
	if result.Items == nil || len(result.Items) > int(asked.Limit) {
		return false
	}
	var previous *work.Position
	if asked.After != nil {
		after := *asked.After
		previous = &after
	}
	for _, entry := range result.Items {
		if !entry.Item.Valid() || !entry.Position.Valid() ||
			entry.Position.WorkID != entry.Item.WorkID {
			return false
		}
		if asked.ClientDomain != nil && entry.Item.Client.Domain != *asked.ClientDomain {
			return false
		}
		if asked.Status != nil && entry.Item.Status != *asked.Status {
			return false
		}
		if previous != nil && !PositionAfter(entry.Position, *previous) {
			return false
		}
		previous = &entry.Position
	}
	return true
}

// PositionAfter reports whether a sorts strictly after b.
func PositionAfter(a, b work.Position) bool {
	if a.Bucket != b.Bucket {
		return a.Bucket > b.Bucket
	}
	if a.Sort != b.Sort {
		return a.Sort > b.Sort
	}
	return a.WorkID > b.WorkID
}

func validDetail(result work.WorkDetail, asked work.PeerGetWorkRequest) bool {
	return result.Item.Valid() && result.Item.WorkID == asked.WorkID &&
		result.Item.EngagementID == asked.EngagementID &&
		result.Interviews != nil && result.Snapshot.DisplayName != ""
}

func validJobs(result work.PeerListJobsResponse, asked work.PeerListJobsRequest) bool {
	if result.Jobs == nil || len(result.Jobs) > int(asked.Limit) {
		return false
	}
	var previous *work.JobPosition
	if asked.After != nil {
		after := *asked.After
		previous = &after
	}
	for _, entry := range result.Jobs {
		if !entry.Job.Valid() || !entry.Position.Valid() ||
			entry.Job.State != asked.State {
			return false
		}
		if previous != nil && !JobAfter(entry.Position, *previous) {
			return false
		}
		previous = &entry.Position
	}
	return true
}

// JobAfter reports whether a lists strictly after b: newest assignment first,
// then the larger assignment id first.
func JobAfter(a, b work.JobPosition) bool {
	if !a.AssignedAt.Equal(b.AssignedAt) {
		return a.AssignedAt.Before(b.AssignedAt)
	}
	return a.AssignmentID < b.AssignmentID
}

func validJob(result work.JobDetail, asked work.PeerGetJobRequest) bool {
	return result.Job.Valid() && result.Job.EngagementID == asked.EngagementID &&
		result.Job.Opening.Number == asked.OpeningNumber
}

func validAttribution(result work.PeerListCreditedApplicationsResponse, asked work.PeerListCreditedApplicationsRequest) bool {
	if result.Items == nil || len(result.Items) > int(asked.Limit) {
		return false
	}
	var previous *work.CreditedPosition
	if asked.After != nil {
		after := *asked.After
		previous = &after
	}
	for _, entry := range result.Items {
		item := entry.Item
		if !item.Valid() || !entry.Position.Valid() ||
			!hub.IsHubUserDID(entry.ApplicantDID) ||
			entry.Position.EngagementID != item.EngagementID ||
			!entry.Position.AppliedAt.Equal(item.AppliedAt) ||
			entry.Position.OpeningNumber != item.Opening.Number ||
			entry.Position.ApplicationNumber != item.ApplicationNumber {
			return false
		}
		if (asked.ClientDomain != nil && item.Client.Domain != *asked.ClientDomain) ||
			(asked.Status != nil && item.Status != *asked.Status) ||
			(asked.Route != nil && item.Route != *asked.Route) ||
			(asked.ApplicantDIDs != nil && !slices.Contains(asked.ApplicantDIDs, entry.ApplicantDID)) {
			return false
		}
		if previous != nil && !CreditedAfter(entry.Position, *previous) {
			return false
		}
		previous = &entry.Position
	}
	return true
}

// CreditedAfter reports whether a lists strictly after b: newest application
// first, then the larger engagement id, opening number, and application
// number first.
func CreditedAfter(a, b work.CreditedPosition) bool {
	switch {
	case !a.AppliedAt.Equal(b.AppliedAt):
		return a.AppliedAt.Before(b.AppliedAt)
	case a.EngagementID != b.EngagementID:
		return a.EngagementID < b.EngagementID
	case a.OpeningNumber != b.OpeningNumber:
		return a.OpeningNumber < b.OpeningNumber
	}
	return a.ApplicationNumber < b.ApplicationNumber
}

func validCounts(result work.PeerCountCreditedApplicationsResponse, asked work.PeerCountCreditedApplicationsRequest) bool {
	if result.Counts == nil || len(result.Counts) > len(asked.ApplicantDIDs) {
		return false
	}
	for _, count := range result.Counts {
		if count.Count < 1 || !slices.Contains(asked.ApplicantDIDs, count.ApplicantDID) {
			return false
		}
	}
	return true
}

func validStatement(result work.PeerGetActivityStatementResponse, asked work.PeerGetActivityStatementRequest) bool {
	return result.EngagementID == asked.EngagementID && result.Month == asked.Month
}
