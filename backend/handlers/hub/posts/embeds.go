package posts

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/handlers/hub/blocks"
	"backend/internal/fanout"
	hubruntime "backend/internal/hub"
	"backend/internal/publicopenings"
)

// userLocation is where a Hub user lives, as the global directory says.
type userLocation struct {
	did    hubspec.HubUserDID
	tenant directoryspec.TenantID
}

// embedRef is one timeline embed to read: the index of the quote post and
// what the owner's tenant needs to answer.
type embedRef struct {
	index int
	item  postsspec.MeshEmbedReference
}

type openingKey struct {
	domain orgs.OrgDomain
	number openingsspec.OpeningNumber
}

// embedPlan holds the reads one page of posts needs. A post it names in
// neither map has an embed that is `unavailable` already.
type embedPlan struct {
	byTenant map[directoryspec.TenantID][]embedRef
	openings map[openingKey][]int
}

// handlesToResolve lists the permanent handles a page needs to find: the
// target owner and the quoter of each timeline quote. It leaves out the
// handles in known.
func handlesToResolve(
	posts []postsspec.Post, known map[string]userLocation,
) map[string]struct{} {
	need := map[string]struct{}{}
	for _, post := range posts {
		target := post.QuoteTarget
		if target == nil || target.Type != postsspec.QuoteTargetTimelinePost {
			continue
		}
		for _, handle := range []string{
			string(target.Owner), string(post.Owner.Handle),
		} {
			if _, ok := known[handle]; !ok {
				need[handle] = struct{}{}
			}
		}
	}
	return need
}

// planEmbeds groups the quotes of a page by the home tenant of the target
// owner (PST-QTE-009), one read for each tenant. Opening targets group by
// Opening. A post whose handles did not resolve stays `unavailable`.
func planEmbeds(
	posts []postsspec.Post, resolved map[string]userLocation,
) embedPlan {
	plan := embedPlan{
		byTenant: map[directoryspec.TenantID][]embedRef{},
		openings: map[openingKey][]int{},
	}
	for index, post := range posts {
		target := post.QuoteTarget
		if target == nil {
			continue
		}
		switch target.Type {
		case postsspec.QuoteTargetOpening:
			key := openingKey{target.OrgDomain, target.OpeningNumber}
			plan.openings[key] = append(plan.openings[key], index)
		case postsspec.QuoteTargetTimelinePost:
			owner, ownerOK := resolved[string(target.Owner)]
			quoter, quoterOK := resolved[string(post.Owner.Handle)]
			if !ownerOK || !quoterOK {
				continue
			}
			plan.byTenant[owner.tenant] = append(plan.byTenant[owner.tenant],
				embedRef{index: index, item: postsspec.MeshEmbedReference{
					OwnerHubUserDID:  owner.did,
					TargetPostID:     target.PostID,
					QuotePostID:      post.PostID,
					QuoterHubUserDID: quoter.did,
				}})
		}
	}
	return plan
}

var unavailable = &postsspec.PostEmbed{State: postsspec.EmbedUnavailable}

// attachEmbeds sets the embed of each quote post in posts (PST-QTE-009). A
// region that does not answer makes only its own embeds `unavailable`.
// known holds handles the caller already resolved; it may be nil. The
// embedded post keeps no embed of its own (PST-QTE-010).
func attachEmbeds(
	ctx context.Context, s *hubruntime.Server, viewer pgtype.UUID,
	posts []postsspec.Post, known map[string]userLocation,
) error {
	for index := range posts {
		if posts[index].QuoteTarget != nil {
			posts[index].Embed = unavailable
		}
	}
	need := handlesToResolve(posts, known)
	resolved := map[string]userLocation{}
	for handle, found := range known {
		resolved[handle] = found
	}
	lookups := fanout.Do(ctx, need, func(
		ctx context.Context, handle string, _ struct{},
	) (userLocation, error) {
		entry, failure := blocks.Lookup(ctx, s,
			profilespec.ProfileAddress(handle))
		if failure != blocks.Resolved {
			return userLocation{}, errors.New("handle not resolved")
		}
		return userLocation{
			did:    hubspec.HubUserDID(entry.HubUserDID),
			tenant: entry.HomeTenantID,
		}, nil
	}, fanout.DefaultDeadline)
	for handle, answer := range lookups {
		if answer.Err == nil {
			resolved[handle] = answer.Value
		}
	}
	plan := planEmbeds(posts, resolved)
	if len(plan.byTenant) > 0 {
		viewerDID, viewerHandle, err := viewerFields(ctx, s, viewer)
		if err != nil {
			return err
		}
		reads := fanout.Do(ctx, plan.byTenant, func(
			ctx context.Context, _ directoryspec.TenantID, refs []embedRef,
		) ([]postsspec.MeshEmbedResult, error) {
			return readEmbeds(ctx, s, viewerDID, viewerHandle, refs)
		}, fanout.DefaultDeadline)
		for tenant, refs := range plan.byTenant {
			answer := reads[tenant]
			if answer.Err != nil || len(answer.Value) != len(refs) {
				continue
			}
			for position, ref := range refs {
				result := answer.Value[position]
				if result.Status == postsspec.MeshEmbedPost {
					embedded := result.Post.Embedded()
					posts[ref.index].Embed = &postsspec.PostEmbed{
						State: postsspec.EmbedPost, Post: &embedded,
					}
				}
			}
		}
	}
	attachOpenings(ctx, s, posts, plan.openings)
	return nil
}

// readEmbeds sends the refs of one region to the local relay, at most 50 in
// each call.
func readEmbeds(
	ctx context.Context, s *hubruntime.Server, viewer hubspec.HubUserDID,
	handle hubspec.HubHandle, refs []embedRef,
) ([]postsspec.MeshEmbedResult, error) {
	var results []postsspec.MeshEmbedResult
	for start := 0; start < len(refs); start += postsspec.MaxGetMany {
		end := min(start+postsspec.MaxGetMany, len(refs))
		items := make([]postsspec.MeshEmbedReference, 0, end-start)
		for _, ref := range refs[start:end] {
			items = append(items, ref.item)
		}
		outcome, err := s.Posts.ReadEmbeds(ctx, postsspec.MeshReadEmbedsRequest{
			ViewerHubUserDID: viewer, ViewerHandle: handle, Items: items,
		})
		if err != nil {
			return nil, err
		}
		if outcome.Problem != nil {
			return nil, errors.New(outcome.Problem.Type)
		}
		results = append(results, outcome.Value.Results...)
	}
	return results, nil
}

func attachOpenings(
	ctx context.Context, s *hubruntime.Server, posts []postsspec.Post,
	wanted map[openingKey][]int,
) {
	reads := fanout.Do(ctx, wanted, func(
		ctx context.Context, key openingKey, _ []int,
	) (postsspec.EmbeddedOpening, error) {
		found, status := readOpening(ctx, s, key.domain, key.number)
		if status != openingRead {
			return found, errors.New("opening not available")
		}
		return found, nil
	}, fanout.DefaultDeadline)
	for key, indexes := range wanted {
		answer := reads[key]
		if answer.Err != nil {
			continue
		}
		for _, index := range indexes {
			opening := answer.Value
			posts[index].Embed = &postsspec.PostEmbed{
				State: postsspec.EmbedOpening, Opening: &opening,
			}
		}
	}
}

type openingStatus int

const (
	openingRead openingStatus = iota
	// openingGone is an Org or an Opening that does not exist or is not
	// published.
	openingGone
	// openingFailed is a read that did not answer.
	openingFailed
)

// readOpening reads a public Opening from the Org's home tenant and keeps it
// only when it is `published` (PST-QTE-011).
func readOpening(
	ctx context.Context, s *hubruntime.Server, domain orgs.OrgDomain,
	number openingsspec.OpeningNumber,
) (postsspec.EmbeddedOpening, openingStatus) {
	request := openingsspec.GetOrgOpeningRequest{
		Domain: domain, OpeningNumber: number,
	}
	result, err := s.PublicOpenings.Get(ctx, request)
	switch {
	case errors.Is(err, publicopenings.ErrOrgNotFound):
		outcome, relayErr := s.Openings.RelayGet(ctx, request)
		if relayErr != nil {
			return postsspec.EmbeddedOpening{}, openingFailed
		}
		if outcome.Problem != nil {
			switch outcome.Problem.Type {
			case hubproblem.OrgNotFoundError.Type,
				hubproblem.OpeningNotFoundError.Type:
				return postsspec.EmbeddedOpening{}, openingGone
			}
			return postsspec.EmbeddedOpening{}, openingFailed
		}
		result = *outcome.Result
	case errors.Is(err, publicopenings.ErrOpeningNotFound):
		return postsspec.EmbeddedOpening{}, openingGone
	case err != nil:
		return postsspec.EmbeddedOpening{}, openingFailed
	}
	embedded, ok := summarize(result)
	if !ok {
		return postsspec.EmbeddedOpening{}, openingGone
	}
	return embedded, openingRead
}

// summarize shapes the embed of a published Opening. It refuses an Opening
// that is not published or lacks a field of the summary.
func summarize(
	result openingsspec.GetOrgOpeningResponse,
) (postsspec.EmbeddedOpening, bool) {
	opening, content := result.Opening, result.Opening.Content
	if opening.State != openingsspec.Published || content == nil ||
		content.Title == nil || content.EmployingCountry == nil ||
		content.WorkArrangement == nil || content.EmploymentType == nil ||
		opening.FirstPublishedAt == nil {
		return postsspec.EmbeddedOpening{}, false
	}
	return postsspec.EmbeddedOpening{
		Org: result.Org,
		Opening: openingsspec.PublicOpeningSummary{
			OpeningNumber:    opening.OpeningNumber,
			Title:            *content.Title,
			EmployingCountry: *content.EmployingCountry,
			WorkArrangement:  *content.WorkArrangement,
			EmploymentType:   *content.EmploymentType,
			FirstPublishedAt: opening.FirstPublishedAt.UTC(),
			Tags:             content.Tags,
			Salary:           content.Salary,
		},
	}, true
}

func openingTargetID(number openingsspec.OpeningNumber) string {
	return strconv.Itoa(int(number))
}
