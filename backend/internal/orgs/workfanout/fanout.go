// Package workfanout asks every tenant for a provider's routed work or
// assigned Openings in parallel, under one deadline, and merges the answers
// into one ordered page that names the tenants that did not answer.
package workfanout

import (
	"context"
	"slices"
	"sync"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"

	"backend/internal/workclient"
)

// Peers reads one tenant through the local relay.
type Peers interface {
	RelayListWork(
		context.Context, work.RelayListWorkRequest,
	) (workclient.Outcome[work.PeerListWorkResponse], error)
	RelayListJobs(
		context.Context, work.RelayListJobsRequest,
	) (workclient.Outcome[work.PeerListJobsResponse], error)
	RelayListCreditedApplications(
		context.Context, work.RelayListCreditedApplicationsRequest,
	) (workclient.Outcome[work.PeerListCreditedApplicationsResponse], error)
}

type Fanout struct {
	Peers Peers
	// Tenants is every tenant on the mesh, this one included.
	Tenants []directoryspec.TenantID
	// Deadline bounds the whole fan-out; a tenant still silent then is
	// unavailable.
	Deadline time.Duration
}

// WorkPage is one merged page of the work queue.
type WorkPage struct {
	Entries     []work.PeerWorkEntry
	HasMore     bool
	Unavailable []directoryspec.TenantID
}

// JobsPage is one merged page of jobs.
type JobsPage struct {
	Entries     []work.PeerJobEntry
	HasMore     bool
	Unavailable []directoryspec.TenantID
}

// gather runs ask for every tenant at once and returns each answer, or nil
// for a tenant that gave no usable one, in tenant order.
func gather[T any](
	ctx context.Context, f Fanout,
	ask func(context.Context, directoryspec.TenantID) (workclient.Outcome[T], error),
) ([]*T, []directoryspec.TenantID) {
	ctx, cancel := context.WithTimeout(ctx, f.Deadline)
	defer cancel()
	answers := make([]*T, len(f.Tenants))
	var wait sync.WaitGroup
	for index, tenant := range f.Tenants {
		wait.Add(1)
		go func() {
			defer wait.Done()
			outcome, err := ask(ctx, tenant)
			if err == nil && outcome.Problem == nil {
				answers[index] = outcome.Result
			}
		}()
	}
	wait.Wait()
	unavailable := []directoryspec.TenantID{}
	for index, answer := range answers {
		if answer == nil {
			unavailable = append(unavailable, f.Tenants[index])
		}
	}
	slices.Sort(unavailable)
	return answers, unavailable
}

// ListWork asks each tenant for up to request.Limit entries after
// request.After and keeps the first request.Limit of their union. A full
// page from each tenant holds the true next entries whichever tenant they
// come from.
func (f Fanout) ListWork(
	ctx context.Context, request work.PeerListWorkRequest,
) WorkPage {
	answers, unavailable := gather(ctx, f, func(
		ctx context.Context, tenant directoryspec.TenantID,
	) (workclient.Outcome[work.PeerListWorkResponse], error) {
		return f.Peers.RelayListWork(ctx, work.RelayListWorkRequest{
			Tenant: tenant, Request: request,
		})
	})
	page := WorkPage{Entries: []work.PeerWorkEntry{}, Unavailable: unavailable}
	for _, answer := range answers {
		if answer != nil {
			page.Entries = append(page.Entries, answer.Items...)
			page.HasMore = page.HasMore || answer.HasMore
		}
	}
	slices.SortFunc(page.Entries, func(a, b work.PeerWorkEntry) int {
		switch {
		case workclient.PositionAfter(a.Position, b.Position):
			return 1
		case workclient.PositionAfter(b.Position, a.Position):
			return -1
		}
		return 0
	})
	if len(page.Entries) > int(request.Limit) {
		page.Entries = page.Entries[:request.Limit]
		page.HasMore = true
	}
	return page
}

// ListJobs is ListWork for assigned Openings, newest assignment first.
func (f Fanout) ListJobs(
	ctx context.Context, request work.PeerListJobsRequest,
) JobsPage {
	answers, unavailable := gather(ctx, f, func(
		ctx context.Context, tenant directoryspec.TenantID,
	) (workclient.Outcome[work.PeerListJobsResponse], error) {
		return f.Peers.RelayListJobs(ctx, work.RelayListJobsRequest{
			Tenant: tenant, Request: request,
		})
	})
	page := JobsPage{Entries: []work.PeerJobEntry{}, Unavailable: unavailable}
	for _, answer := range answers {
		if answer != nil {
			page.Entries = append(page.Entries, answer.Jobs...)
			page.HasMore = page.HasMore || answer.HasMore
		}
	}
	slices.SortFunc(page.Entries, func(a, b work.PeerJobEntry) int {
		switch {
		case workclient.JobAfter(a.Position, b.Position):
			return 1
		case workclient.JobAfter(b.Position, a.Position):
			return -1
		}
		return 0
	})
	if len(page.Entries) > int(request.Limit) {
		page.Entries = page.Entries[:request.Limit]
		page.HasMore = true
	}
	return page
}

// CreditedApplicationsPage is one merged page of credited applications.
type CreditedApplicationsPage struct {
	Items       []work.CreditedApplicationSummary
	Unavailable []directoryspec.TenantID
}

// ListCreditedApplications asks each tenant for credited applications.
func (f Fanout) ListCreditedApplications(
	ctx context.Context, request work.PeerListCreditedApplicationsRequest,
) CreditedApplicationsPage {
	answers, unavailable := gather(ctx, f, func(
		ctx context.Context, tenant directoryspec.TenantID,
	) (workclient.Outcome[work.PeerListCreditedApplicationsResponse], error) {
		return f.Peers.RelayListCreditedApplications(ctx, work.RelayListCreditedApplicationsRequest{
			Tenant: tenant, Request: request,
		})
	})
	page := CreditedApplicationsPage{Items: []work.CreditedApplicationSummary{}, Unavailable: unavailable}
	for _, answer := range answers {
		if answer != nil {
			page.Items = append(page.Items, answer.Items...)
		}
	}
	slices.SortFunc(page.Items, func(a, b work.CreditedApplicationSummary) int {
		if !a.AppliedAt.Equal(b.AppliedAt) {
			if a.AppliedAt.After(b.AppliedAt) {
				return -1
			}
			return 1
		}
		if a.ApplicationNumber > b.ApplicationNumber {
			return -1
		}
		if a.ApplicationNumber < b.ApplicationNumber {
			return 1
		}
		return 0
	})
	if len(page.Items) > int(request.Limit) {
		page.Items = page.Items[:request.Limit]
	}
	return page
}
