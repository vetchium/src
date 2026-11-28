package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/hub/blocks"
	"github.com/vetchium/src/typespec/hub/posts"
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	hubsubscriptions "github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/hub/users"

	"backend/internal/service"
)

// Posts a seeded Silver user writes. The first gets the pinned shapes: an open
// post, a post that takes no replies, and a post the author locks.
var seedPostBodies = [3]string{
	"Three weeks into a new role. The first lesson: ask for the written history of a decision before you question it.",
	"A reminder for hiring managers: a clear Opening saves every candidate an hour of guessing.",
	"What helped you most in your first year at a new employer? Short answers are welcome.",
}

const (
	seedReplyBody    = "Thank you for sharing this. It matches what I saw on my own team."
	seedSubReplyBody = "Agreed. The written history also helps the next person who joins."
	seedHiddenBody   = "This reply is for the hidden-reply fixture."
	seedQuoteBody    = "Worth reading again before the next planning cycle."
	seedOpeningQuote = "This team is hiring. Share it with someone who fits."
	// seedReplyAttempts bounds the wait for a cross-region reply that the
	// post owner's tenant has not settled yet.
	seedReplyAttempts = 20
)

// postSeedUser is a seeded Hub user with the handle other users address.
type postSeedUser struct {
	seededApplicant
	handle string
}

// splitPostUsers separates the fixture users by plan, in file order. Only
// Silver users write top-level posts (PST-POS-001).
func splitPostUsers(tenant string, fixture []hubUserFixture) (silver, free []seededApplicant) {
	for _, user := range fixture {
		applicant := seededApplicant{email: user.Email, tenant: tenant}
		if hubsubscriptions.Plan(user.Plan) == hubsubscriptions.FreeTier {
			free = append(free, applicant)
		} else {
			silver = append(silver, applicant)
		}
	}
	return silver, free
}

type postSeeder struct {
	*applicationSeeder
	tenant string
}

// runPostSeed gives the tenant's Hub users posts, threads across two regions,
// quotes of a post and of a published Opening, one block, and one mute, all
// through the Hub APIs. It needs the Hub profiles and Orgs seeded.
func runPostSeed() error {
	tenant := strings.TrimSpace(os.Getenv("DEV_SEED_TENANT"))
	profilesDir := strings.TrimSpace(os.Getenv("DEV_SEED_HUB_PROFILES_DIR"))
	if tenant == "" || profilesDir == "" {
		return errors.New("missing DEV_SEED_TENANT or DEV_SEED_HUB_PROFILES_DIR")
	}
	origins, err := parseHubOrigins(os.Getenv("DEV_SEED_HUB_ORIGINS"))
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()
	seeder := &postSeeder{
		applicationSeeder: &applicationSeeder{
			orgSeeder: &orgSeeder{client: &http.Client{Timeout: hubProfileRequestTimeout}},
			settings: applicationSeedSettings{
				tenantID: tenant, profilesDir: profilesDir, hubOrigins: origins,
			},
			sessions: map[string]hubSession{},
		},
		tenant: tenant,
	}
	return seeder.seed(ctx)
}

func (s *postSeeder) loadUsers(ctx context.Context, tenant string) (silver, free []postSeedUser, err error) {
	fixture, err := loadHubProfileFixture(filepath.Join(s.settings.profilesDir, tenant+".json"))
	if err != nil {
		return nil, nil, err
	}
	silverApplicants, freeApplicants := splitPostUsers(tenant, fixture.Users)
	for _, group := range []struct {
		from []seededApplicant
		to   *[]postSeedUser
	}{{silverApplicants, &silver}, {freeApplicants, &free}} {
		for _, applicant := range group.from {
			handle, err := s.handleOf(ctx, applicant)
			if err != nil {
				return nil, nil, err
			}
			*group.to = append(*group.to, postSeedUser{applicant, handle})
		}
	}
	return silver, free, nil
}

func (s *postSeeder) handleOf(ctx context.Context, applicant seededApplicant) (string, error) {
	session, err := s.hubLogin(ctx, applicant)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, session.origin+"/api/hub/my-info", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+session.token)
	var info users.MyInfoResponse
	if err := s.do(request, http.StatusOK, &info); err != nil {
		return "", fmt.Errorf("read my-info of %s: %w", applicant.email, err)
	}
	return string(info.Handle), nil
}

func (s *postSeeder) seed(ctx context.Context) error {
	next := applicationSeedTenants[0]
	for index, tenant := range applicationSeedTenants {
		if tenant == s.tenant {
			next = applicationSeedTenants[(index+1)%len(applicationSeedTenants)]
		}
	}
	silver, free, err := s.loadUsers(ctx, s.tenant)
	if err != nil {
		return err
	}
	_, remote, err := s.loadUsers(ctx, next)
	if err != nil {
		return err
	}
	if len(silver) < 3 || len(free) < 4 || len(remote) < 2 {
		return fmt.Errorf("tenant %s needs 3 Silver and 4 Free users, and %s 2 Free users", s.tenant, next)
	}
	var existing posts.ListPostsResponse
	if err := s.hubPost(ctx, silver[0].seededApplicant, "posts/list", posts.ListPostsRequest{
		Owner: hubprofile.ProfileAddress(silver[0].handle),
	}, http.StatusOK, &existing); err != nil {
		return fmt.Errorf("list posts of %s: %w", silver[0].email, err)
	}
	if len(existing.Posts) > 0 {
		log.Printf("posts of %s already seeded; skipping", s.tenant)
		return nil
	}

	written := make([][]posts.Post, len(silver))
	for index, author := range silver {
		for number, body := range seedPostBodies {
			request := posts.CreatePostRequest{Body: body}
			if index == 0 && number == 1 {
				nobody := posts.ReplyNobody
				request.ReplyPolicy = &nobody
			}
			var post posts.Post
			if err := s.hubPostWithKey(ctx, author.seededApplicant, "posts/create", request, http.StatusCreated, &post); err != nil {
				return fmt.Errorf("create post of %s: %w", author.email, err)
			}
			written[index] = append(written[index], post)
		}
	}
	open, locked := written[0][0], written[0][2]

	// The thread under the first open post: replies from both regions, a
	// sub-reply from another author, and one hidden reply.
	local, err := s.reply(ctx, free[0], silver[0], open, nil, seedReplyBody)
	if err != nil {
		return err
	}
	if _, err := s.reply(ctx, remote[0], silver[0], open, nil, seedReplyBody); err != nil {
		return err
	}
	if _, err := s.reply(ctx, silver[1], silver[0], open, &local.ReplyID, seedSubReplyBody); err != nil {
		return err
	}
	if _, err := s.reply(ctx, remote[1], silver[0], open, &local.ReplyID, seedSubReplyBody); err != nil {
		return err
	}
	hidden, err := s.reply(ctx, free[1], silver[0], open, nil, seedHiddenBody)
	if err != nil {
		return err
	}
	if err := s.hubPost(ctx, silver[0].seededApplicant, "posts/hide-reply", posts.HideReplyRequest{
		PostID: open.PostID, ReplyID: hidden.ReplyID,
	}, http.StatusNoContent, nil); err != nil {
		return fmt.Errorf("hide reply: %w", err)
	}

	// A reply, then the lock: the thread stays and takes no more replies.
	if _, err := s.reply(ctx, free[0], silver[0], locked, nil, seedReplyBody); err != nil {
		return err
	}
	everyone, quoteEveryone := posts.ReplyEveryone, posts.QuoteEveryone
	if err := s.hubPost(ctx, silver[0].seededApplicant, "posts/set-policies", posts.SetPostPoliciesRequest{
		PostID: locked.PostID, ReplyPolicy: everyone, QuotePolicy: quoteEveryone, Locked: true,
	}, http.StatusOK, nil); err != nil {
		return fmt.Errorf("lock post: %w", err)
	}

	// A thread under the second Silver author's post, answered by the author.
	second := written[1][0]
	reply, err := s.reply(ctx, free[2], silver[1], second, nil, seedReplyBody)
	if err != nil {
		return err
	}
	if _, err := s.reply(ctx, silver[1], silver[1], second, &reply.ReplyID, seedSubReplyBody); err != nil {
		return err
	}

	// Quotes: a post by a local user and by a remote user, and an Opening.
	quotes := []struct {
		author seededApplicant
		target posts.QuoteTarget
		body   string
	}{
		{free[0].seededApplicant, posts.QuoteTarget{
			Type: posts.QuoteTargetTimelinePost, Owner: hubprofile.ProfileAddress(silver[1].handle), PostID: second.PostID,
		}, seedQuoteBody},
		{remote[1].seededApplicant, posts.QuoteTarget{
			Type: posts.QuoteTargetTimelinePost, Owner: hubprofile.ProfileAddress(silver[0].handle), PostID: open.PostID,
		}, seedQuoteBody},
		{free[1].seededApplicant, posts.QuoteTarget{
			Type:          posts.QuoteTargetOpening,
			OrgDomain:     seededOrgDomain(hiringCompanyKind, 1, s.tenant),
			OpeningNumber: engineeringOpening,
		}, seedOpeningQuote},
	}
	for _, quote := range quotes {
		if err := s.hubPostWithKey(ctx, quote.author, "posts/create-quote", posts.CreateQuoteRequest{
			Target: quote.target, Body: quote.body,
		}, http.StatusCreated, nil); err != nil {
			return fmt.Errorf("quote as %s: %w", quote.author.email, err)
		}
	}

	// A block and a mute: the first Silver author blocks one Free user, and
	// another Free user mutes that user.
	if err := s.hubPost(ctx, silver[0].seededApplicant, "blocks/block", blocks.BlockUserRequest{
		User: hubprofile.ProfileAddress(free[3].handle),
	}, http.StatusNoContent, nil); err != nil {
		return fmt.Errorf("block: %w", err)
	}
	if err := s.hubPost(ctx, free[2].seededApplicant, "mutes/mute", blocks.BlockUserRequest{
		User: hubprofile.ProfileAddress(free[3].handle),
	}, http.StatusNoContent, nil); err != nil {
		return fmt.Errorf("mute: %w", err)
	}
	log.Printf("seeded posts of %s", s.tenant)
	return nil
}

// hubPostWithKey is hubPost for a write that takes an Idempotency-Key.
func (s *postSeeder) hubPostWithKey(
	ctx context.Context, applicant seededApplicant, path string, body any, want int, out any,
) error {
	session, err := s.hubLogin(ctx, applicant)
	if err != nil {
		return err
	}
	return s.postAtWithKey(ctx, session.origin, "/api/hub/"+path, body, session.token,
		newIdempotencyKey(), want, out)
}

// reply sends a reply as one user and waits until it settles. A reply to a
// post in another region answers 202 while the owner's tenant is busy; the
// same Idempotency-Key replays the result.
func (s *postSeeder) reply(
	ctx context.Context, author postSeedUser, owner postSeedUser, post posts.Post,
	parent *posts.PostID, body string,
) (posts.Reply, error) {
	session, err := s.hubLogin(ctx, author.seededApplicant)
	if err != nil {
		return posts.Reply{}, err
	}
	key := newIdempotencyKey()
	request := posts.ReplyRequest{
		Owner: hubprofile.ProfileAddress(owner.handle), PostID: post.PostID,
		ParentReplyID: parent, Body: body,
	}
	for attempt := 0; attempt < seedReplyAttempts; attempt++ {
		var reply posts.Reply
		err = s.postAtWithKey(ctx, session.origin, "/api/hub/posts/reply", request, session.token, key, http.StatusOK, &reply)
		var status *statusError
		if err == nil {
			return reply, nil
		}
		if !errors.As(err, &status) || status.status != http.StatusAccepted {
			return posts.Reply{}, fmt.Errorf("reply as %s: %w", author.email, err)
		}
		select {
		case <-ctx.Done():
			return posts.Reply{}, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return posts.Reply{}, fmt.Errorf("reply as %s stayed pending", author.email)
}
