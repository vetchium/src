// Package domainverification keeps proving that each Org still controls its
// domain (agent-guides/orgs.md). The scheduled worker and a superadmin's
// check-now share it, and every state write is guarded by the state that was
// read, so the two can never apply a stale result.
package domainverification

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/appconfig"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	"backend/internal/dnsverify"
	"backend/internal/orgs/orgmail"
)

// ErrNotFound reports that the Org has no domain that can be checked.
var ErrNotFound = errors.New("org domain not found")

type Checker interface {
	Check(ctx context.Context, domain, token string) (dnsverify.Result, error)
}

type Directory interface {
	ReleaseOrgDomain(
		context.Context, directoryspec.ReleaseOrgDomainRequest,
	) (directoryclient.OrgOutcome, error)
	ClaimOrgDomain(
		context.Context, directoryspec.ClaimOrgDomainRequest,
	) (directoryclient.OrgOutcome, error)
}

type Queries interface {
	ListDueOrgDomains(context.Context) ([]sqlc.ListDueOrgDomainsRow, error)
	GetOrgDomainForCheck(
		context.Context, pgtype.UUID,
	) (sqlc.GetOrgDomainForCheckRow, error)
	RecordOrgDomainPresent(
		context.Context, sqlc.RecordOrgDomainPresentParams,
	) (bool, error)
	RecordOrgDomainAbsent(
		context.Context, sqlc.RecordOrgDomainAbsentParams,
	) (sqlc.RecordOrgDomainAbsentRow, error)
	RecordOrgDomainInconclusive(
		context.Context, sqlc.RecordOrgDomainInconclusiveParams,
	) (bool, error)
	RecordReleasedOrgDomainAbsent(
		context.Context, sqlc.RecordReleasedOrgDomainAbsentParams,
	) (bool, error)
	ListOrgDomainsPastGrace(
		context.Context, pgtype.Timestamptz,
	) ([]sqlc.ListOrgDomainsPastGraceRow, error)
	BeginOrgDomainRelease(
		context.Context, sqlc.BeginOrgDomainReleaseParams,
	) (bool, error)
	ListPendingOrgDomainCommands(
		context.Context,
	) ([]sqlc.ListPendingOrgDomainCommandsRow, error)
	CompleteOrgDomainRelease(
		context.Context, sqlc.CompleteOrgDomainReleaseParams,
	) (bool, error)
	BeginOrgDomainReclaim(
		context.Context, sqlc.BeginOrgDomainReclaimParams,
	) (bool, error)
	CompleteOrgDomainReclaim(
		context.Context, sqlc.CompleteOrgDomainReclaimParams,
	) (bool, error)
	RejectOrgDomainReclaim(
		context.Context, sqlc.RejectOrgDomainReclaimParams,
	) (bool, error)
}

// Policy holds the tenant's re-verification timings.
type Policy struct {
	CheckInterval      time.Duration
	FailureThreshold   int
	FailingGracePeriod time.Duration
	InconclusiveRetry  time.Duration
	InconclusiveLimit  time.Duration
}

func PolicyFrom(config appconfig.OrgDomainVerification) Policy {
	return Policy{
		CheckInterval:      config.CheckInterval,
		FailureThreshold:   config.FailureThreshold,
		FailingGracePeriod: config.FailingGracePeriod,
		InconclusiveRetry:  config.InconclusiveRetry,
		InconclusiveLimit:  config.InconclusiveLimit,
	}
}

// Actor identifies who caused a check, for the audit trail.
type Actor struct {
	Type   string
	ID     string
	Source string
}

var Worker = Actor{Type: "worker", ID: "verify-org-domains", Source: "workers"}

type Service struct {
	queries   Queries
	directory Directory
	checker   Checker
	policy    Policy
	tenantID  string
	outboxKey [32]byte
	log       *slog.Logger
	now       func() time.Time
	jitter    func(time.Duration) time.Duration
}

func New(
	queries Queries, directory Directory, checker Checker, policy Policy,
	tenantID string, outboxKey [32]byte, log *slog.Logger,
) *Service {
	return &Service{
		queries: queries, directory: directory, checker: checker,
		policy: policy, tenantID: tenantID, outboxKey: outboxKey, log: log,
		now: time.Now, jitter: randomJitter,
	}
}

// ReleaseAfter is when a domain failing since failingSince will be released
// unless its record returns.
func (s *Service) ReleaseAfter(failingSince time.Time) time.Time {
	return failingSince.Add(s.policy.FailingGracePeriod)
}

// CheckDue checks every domain whose next check is due, one batch per call.
func (s *Service) CheckDue(ctx context.Context) error {
	rows, err := s.queries.ListDueOrgDomains(ctx)
	if err != nil {
		return fmt.Errorf("list due Org domains: %w", err)
	}
	for _, row := range rows {
		if _, err := s.check(ctx, domainRow(row), Worker); err != nil {
			return err
		}
	}
	return nil
}

// CheckNow checks one Org's domain immediately, whatever its schedule.
//
//vetchium:multiple-commits a re-claim commits its start, calls the global coordinator, then commits the outcome
func (s *Service) CheckNow(
	ctx context.Context, orgDID pgtype.UUID, actor Actor,
) (dnsverify.Result, error) {
	row, err := s.queries.GetOrgDomainForCheck(ctx, orgDID)
	if errors.Is(err, pgx.ErrNoRows) {
		return dnsverify.Inconclusive, ErrNotFound
	}
	if err != nil {
		return dnsverify.Inconclusive, fmt.Errorf("get Org domain: %w", err)
	}
	return s.check(ctx, fromCheckRow(row), actor)
}

// ReleaseExpired starts the release of every domain that stayed failing past
// the grace period, then drives the directory commands.
func (s *Service) ReleaseExpired(ctx context.Context) error {
	now := s.now().UTC()
	rows, err := s.queries.ListOrgDomainsPastGrace(
		ctx, dbvalue.Timestamp(now.Add(-s.policy.FailingGracePeriod)),
	)
	if err != nil {
		return fmt.Errorf("list Org domains past grace: %w", err)
	}
	for _, row := range rows {
		notice, err := orgmail.Encrypt(s.outboxKey, orgmail.Payload{
			Domain:      row.Domain,
			RecordName:  dnsverify.RecordName(row.Domain),
			RecordValue: dnsverify.RecordValue(row.VerificationToken),
		})
		if err != nil {
			return err
		}
		commandID, err := dbvalue.NewUUID()
		if err != nil {
			return err
		}
		if _, err := s.queries.BeginOrgDomainRelease(
			ctx, sqlc.BeginOrgDomainReleaseParams{
				OrgDid: row.OrgDid, DirectoryCommandID: commandID,
				FailingBefore: dbvalue.Timestamp(
					now.Add(-s.policy.FailingGracePeriod),
				),
				NoticePayloadCiphertext: notice, TenantID: s.tenantID,
			},
		); err != nil {
			return fmt.Errorf("begin Org domain release: %w", err)
		}
	}
	return s.DriveDirectoryCommands(ctx)
}

// DriveDirectoryCommands sends every pending release or re-claim to the
// global directory with its stored command id. An uncertain outcome leaves
// the command pending, and the next run sends the identical command again.
func (s *Service) DriveDirectoryCommands(ctx context.Context) error {
	rows, err := s.queries.ListPendingOrgDomainCommands(ctx)
	if err != nil {
		return fmt.Errorf("list pending Org domain commands: %w", err)
	}
	for _, row := range rows {
		switch row.DomainState {
		case sqlc.VetchiumOrgDomainStateReleasing:
			if err := s.release(
				ctx, row.OrgDid, row.Domain, row.DirectoryCommandID, Worker,
			); err != nil {
				return err
			}
		case sqlc.VetchiumOrgDomainStateReclaiming:
			if err := s.reclaim(
				ctx, row.OrgDid, row.Domain, row.DirectoryCommandID, Worker,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

type domain struct {
	orgDID            pgtype.UUID
	name              string
	token             string
	state             sqlc.VetchiumOrgDomainState
	lastConclusiveAt  time.Time
	inconclusiveCount int32
	// commandID is the stored directory command of a release or re-claim in
	// flight.
	commandID pgtype.UUID
}

func domainRow(row sqlc.ListDueOrgDomainsRow) domain {
	return fromCheckRow(sqlc.GetOrgDomainForCheckRow(row))
}

func fromCheckRow(row sqlc.GetOrgDomainForCheckRow) domain {
	return domain{
		orgDID: row.OrgDid, name: row.Domain, token: row.VerificationToken,
		state: row.DomainState, lastConclusiveAt: row.LastConclusiveAt.Time,
		inconclusiveCount: row.ConsecutiveInconclusive,
		commandID:         row.DirectoryCommandID,
	}
}

func (s *Service) check(
	ctx context.Context, d domain, actor Actor,
) (dnsverify.Result, error) {
	result, lookupErr := s.checker.Check(ctx, d.name, d.token)
	now := s.now().UTC()
	if result == dnsverify.Inconclusive {
		s.log.WarnContext(
			ctx, "Org domain lookup inconclusive",
			"event", "org_domain_lookup_inconclusive",
			"orgDID", dbvalue.FormatUUID(d.orgDID),
			"error", lookupErr,
		)
		// Permanently broken DNS must not hold a domain forever, so a
		// domain with no conclusive answer for too long counts as absent.
		if now.Sub(d.lastConclusiveAt) >= s.policy.InconclusiveLimit {
			return s.apply(ctx, d, dnsverify.Absent, actor, now)
		}
	}
	return s.apply(ctx, d, result, actor, now)
}

func (s *Service) apply(
	ctx context.Context, d domain, result dnsverify.Result, actor Actor,
	now time.Time,
) (dnsverify.Result, error) {
	actorID := dbvalue.Text(actor.ID)
	nextCheck := dbvalue.Timestamp(
		now.Add(s.policy.CheckInterval + s.jitter(s.policy.CheckInterval)),
	)
	switch {
	case result == dnsverify.Inconclusive:
		retry := s.inconclusiveRetry(d.inconclusiveCount)
		_, err := s.queries.RecordOrgDomainInconclusive(
			ctx, sqlc.RecordOrgDomainInconclusiveParams{
				OrgDid: d.orgDID, ExpectedState: d.state,
				NextCheckAt: dbvalue.Timestamp(now.Add(retry)),
				TenantID:    s.tenantID, ActorType: actor.Type,
				ActorID: actorID, Source: actor.Source,
			},
		)
		return result, wrap("record inconclusive Org domain check", err)
	case d.state == sqlc.VetchiumOrgDomainStateReleased &&
		result == dnsverify.Present:
		commandID, err := dbvalue.NewUUID()
		if err != nil {
			return result, err
		}
		started, err := s.queries.BeginOrgDomainReclaim(
			ctx, sqlc.BeginOrgDomainReclaimParams{
				OrgDid: d.orgDID, DirectoryCommandID: commandID,
				TenantID: s.tenantID, ActorType: actor.Type,
				ActorID: actorID, Source: actor.Source,
			},
		)
		if err != nil {
			return result, wrap("begin Org domain reclaim", err)
		}
		if started {
			return result, s.reclaim(ctx, d.orgDID, d.name, commandID, actor)
		}
		// A concurrent check began the re-claim first; finish it.
		row, err := s.queries.GetOrgDomainForCheck(ctx, d.orgDID)
		if err != nil {
			return result, wrap("reload Org domain", err)
		}
		if row.DomainState != sqlc.VetchiumOrgDomainStateReclaiming {
			return result, nil
		}
		return result, s.reclaim(
			ctx, d.orgDID, d.name, row.DirectoryCommandID, actor,
		)
	case d.state == sqlc.VetchiumOrgDomainStateReclaiming &&
		result == dnsverify.Present:
		// The directory replays a command by its id, so this finishes the
		// re-claim another check began instead of reporting the Org still
		// suspended while it completes.
		return result, s.reclaim(ctx, d.orgDID, d.name, d.commandID, actor)
	case d.state == sqlc.VetchiumOrgDomainStateReleased:
		_, err := s.queries.RecordReleasedOrgDomainAbsent(
			ctx, sqlc.RecordReleasedOrgDomainAbsentParams{
				OrgDid: d.orgDID, NextCheckAt: nextCheck,
				TenantID: s.tenantID, ActorType: actor.Type,
				ActorID: actorID, Source: actor.Source,
			},
		)
		return result, wrap("record absent released Org domain", err)
	case result == dnsverify.Present:
		_, err := s.queries.RecordOrgDomainPresent(
			ctx, sqlc.RecordOrgDomainPresentParams{
				OrgDid: d.orgDID, ExpectedState: d.state,
				NextCheckAt: nextCheck, TenantID: s.tenantID,
				ActorType: actor.Type, ActorID: actorID, Source: actor.Source,
			},
		)
		return result, wrap("record present Org domain", err)
	default:
		notice, err := orgmail.Encrypt(s.outboxKey, orgmail.Payload{
			Domain:       d.name,
			RecordName:   dnsverify.RecordName(d.name),
			RecordValue:  dnsverify.RecordValue(d.token),
			ReleaseAfter: now.Add(s.policy.FailingGracePeriod),
		})
		if err != nil {
			return result, err
		}
		_, err = s.queries.RecordOrgDomainAbsent(
			ctx, sqlc.RecordOrgDomainAbsentParams{
				OrgDid: d.orgDID, ExpectedState: d.state,
				FailureThreshold:        int32(s.policy.FailureThreshold),
				NextCheckAt:             nextCheck,
				NoticePayloadCiphertext: notice,
				TenantID:                s.tenantID, ActorType: actor.Type,
				ActorID: actorID, Source: actor.Source,
			},
		)
		return dnsverify.Absent, wrap("record absent Org domain", err)
	}
}

func (s *Service) release(
	ctx context.Context, orgDID pgtype.UUID, name string,
	commandID pgtype.UUID, actor Actor,
) error {
	outcome, err := s.directory.ReleaseOrgDomain(
		ctx, directoryspec.ReleaseOrgDomainRequest{
			CommandID: directoryspec.CommandID(dbvalue.FormatUUID(commandID)),
			OrgDID:    orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
			Domain:    orgs.OrgDomain(name),
		},
	)
	if err != nil || outcome.Problem != nil {
		s.logPending(ctx, "release", orgDID, err, outcome.Problem)
		return nil
	}
	_, err = s.queries.CompleteOrgDomainRelease(
		ctx, sqlc.CompleteOrgDomainReleaseParams{
			OrgDid: orgDID, DirectoryCommandID: commandID,
			NextCheckAt: dbvalue.Timestamp(s.nextCheck()),
			TenantID:    s.tenantID, ActorType: actor.Type,
			ActorID: dbvalue.Text(actor.ID), Source: actor.Source,
		},
	)
	return wrap("complete Org domain release", err)
}

func (s *Service) reclaim(
	ctx context.Context, orgDID pgtype.UUID, name string,
	commandID pgtype.UUID, actor Actor,
) error {
	outcome, err := s.directory.ClaimOrgDomain(
		ctx, directoryspec.ClaimOrgDomainRequest{
			CommandID: directoryspec.CommandID(dbvalue.FormatUUID(commandID)),
			OrgDID:    orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
			Domain:    orgs.OrgDomain(name),
		},
	)
	if err == nil && outcome.Problem != nil &&
		outcome.Problem.Type == coordinatorproblem.DirectoryClaimConflictError.Type {
		_, err := s.queries.RejectOrgDomainReclaim(
			ctx, sqlc.RejectOrgDomainReclaimParams{
				OrgDid: orgDID, DirectoryCommandID: commandID,
				NextCheckAt: dbvalue.Timestamp(s.nextCheck()),
				TenantID:    s.tenantID, ActorType: actor.Type,
				ActorID: dbvalue.Text(actor.ID), Source: actor.Source,
			},
		)
		return wrap("reject Org domain reclaim", err)
	}
	if err != nil || outcome.Problem != nil {
		s.logPending(ctx, "reclaim", orgDID, err, outcome.Problem)
		return nil
	}
	_, err = s.queries.CompleteOrgDomainReclaim(
		ctx, sqlc.CompleteOrgDomainReclaimParams{
			OrgDid: orgDID, DirectoryCommandID: commandID,
			NextCheckAt: dbvalue.Timestamp(s.nextCheck()),
			TenantID:    s.tenantID, ActorType: actor.Type,
			ActorID: dbvalue.Text(actor.ID), Source: actor.Source,
		},
	)
	return wrap("complete Org domain reclaim", err)
}

// logPending records a directory command that has to be sent again. A
// transport failure or unexpected problem is never a reason to guess the
// outcome, so the stored command stays pending.
func (s *Service) logPending(
	ctx context.Context, command string, orgDID pgtype.UUID, err error,
	details *problem.Details,
) {
	attributes := []any{
		"event", "org_domain_directory_command_pending",
		"command", command,
		"orgDID", dbvalue.FormatUUID(orgDID),
	}
	if err != nil {
		attributes = append(attributes, "error", err)
	}
	if details != nil {
		attributes = append(attributes, "problemType", details.Type)
	}
	s.log.WarnContext(ctx, "Org domain directory command pending", attributes...)
}

func (s *Service) nextCheck() time.Time {
	return s.now().UTC().Add(
		s.policy.CheckInterval + s.jitter(s.policy.CheckInterval),
	)
}

// inconclusiveRetry backs off from the configured retry up to the regular
// check interval.
func (s *Service) inconclusiveRetry(previous int32) time.Duration {
	retry := s.policy.InconclusiveRetry
	for range min(previous, 16) {
		if retry >= s.policy.CheckInterval/2 {
			break
		}
		retry *= 2
	}
	return min(retry, s.policy.CheckInterval)
}

// randomJitter spreads checks over up to a tenth of the interval, so Orgs
// that signed up together are not all checked at the same moment.
func randomJitter(interval time.Duration) time.Duration {
	spread := int64(interval / 10)
	if spread <= 0 {
		return 0
	}
	value, err := rand.Int(rand.Reader, big.NewInt(spread))
	if err != nil {
		return 0
	}
	return time.Duration(value.Int64())
}

func wrap(operation string, err error) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}
