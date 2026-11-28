package posts

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
)

type QuoteTargetType string

const (
	QuoteTargetTimelinePost QuoteTargetType = "timeline_post"
	QuoteTargetOpening      QuoteTargetType = "opening"
)

func IsQuoteTargetType(value QuoteTargetType) bool {
	return value == QuoteTargetTimelinePost || value == QuoteTargetOpening
}

// QuoteTarget is discriminated on Type. A timeline target sets Owner and
// PostID; an Opening target sets OrgDomain and OpeningNumber. The other pair
// stays empty, so a copy never shares storage. In a response the Owner of a
// timeline target is the permanent handle (PST-OWN-004).
type QuoteTarget struct {
	Type          QuoteTargetType        `json:"type"`
	Owner         profile.ProfileAddress `json:"owner,omitempty"`
	PostID        PostID                 `json:"post_id,omitempty"`
	OrgDomain     orgs.OrgDomain         `json:"org_domain,omitempty"`
	OpeningNumber openings.OpeningNumber `json:"opening_number,omitempty"`
}

func (t *QuoteTarget) Normalize() {
	t.Owner = profile.ProfileAddress(strings.TrimSpace(string(t.Owner)))
	t.OrgDomain = orgs.NormalizeOrgDomain(t.OrgDomain)
}

// Valid reports whether Type is known and exactly its own fields are set.
func (t QuoteTarget) Valid() bool {
	switch t.Type {
	case QuoteTargetTimelinePost:
		return profile.IsProfileAddress(t.Owner) && IsPostID(t.PostID) &&
			t.OrgDomain == "" && t.OpeningNumber == 0
	case QuoteTargetOpening:
		return orgs.IsOrgDomain(t.OrgDomain) && t.OpeningNumber >= 1 &&
			t.Owner == "" && t.PostID == ""
	default:
		return false
	}
}

// EmbeddedOpening is the published Opening an embed shows.
type EmbeddedOpening struct {
	Org     openings.PublicOrg            `json:"org"`
	Opening openings.PublicOpeningSummary `json:"opening"`
}

// EmbeddedPost is a Post without its own embed (PST-QTE-010). A quote inside
// an embed keeps only its QuoteTarget.
type EmbeddedPost struct {
	PostID      PostID       `json:"post_id"`
	Owner       PostOwner    `json:"owner"`
	Kind        PostKind     `json:"kind"`
	Body        string       `json:"body"`
	ReplyPolicy ReplyPolicy  `json:"reply_policy"`
	QuotePolicy QuotePolicy  `json:"quote_policy"`
	Locked      bool         `json:"locked"`
	ReplyCount  int32        `json:"reply_count"`
	QuoteCount  int32        `json:"quote_count"`
	Revision    int32        `json:"revision"`
	Edited      bool         `json:"edited"`
	CreatedAt   time.Time    `json:"created_at"`
	EditedAt    *time.Time   `json:"edited_at,omitempty"`
	QuoteTarget *QuoteTarget `json:"quote_target,omitempty"`
}

// Embedded returns the post as an embed shows it, without its embed.
func (p Post) Embedded() EmbeddedPost {
	return EmbeddedPost{
		PostID: p.PostID, Owner: p.Owner, Kind: p.Kind, Body: p.Body,
		ReplyPolicy: p.ReplyPolicy, QuotePolicy: p.QuotePolicy,
		Locked: p.Locked, ReplyCount: p.ReplyCount, QuoteCount: p.QuoteCount,
		Revision: p.Revision, Edited: p.Edited, CreatedAt: p.CreatedAt,
		EditedAt: p.EditedAt, QuoteTarget: p.QuoteTarget,
	}
}

type PostEmbedState string

const (
	EmbedPost        PostEmbedState = "post"
	EmbedOpening     PostEmbedState = "opening"
	EmbedUnavailable PostEmbedState = "unavailable"
)

// PostEmbed is discriminated on State. Post is set only for `post` and
// Opening only for `opening`.
type PostEmbed struct {
	State   PostEmbedState   `json:"state"`
	Post    *EmbeddedPost    `json:"post,omitempty"`
	Opening *EmbeddedOpening `json:"opening,omitempty"`
}

func (e PostEmbed) Valid() bool {
	switch e.State {
	case EmbedPost:
		return e.Post != nil && e.Opening == nil
	case EmbedOpening:
		return e.Opening != nil && e.Post == nil
	case EmbedUnavailable:
		return e.Post == nil && e.Opening == nil
	default:
		return false
	}
}

type CreateQuoteRequest struct {
	Target      QuoteTarget  `json:"target"`
	Body        string       `json:"body"`
	ReplyPolicy *ReplyPolicy `json:"reply_policy,omitempty"`
	QuotePolicy *QuotePolicy `json:"quote_policy,omitempty"`
}

func (r *CreateQuoteRequest) Normalize() {
	r.Target.Normalize()
	r.Body = strings.TrimSpace(r.Body)
}

func (r CreateQuoteRequest) Validate() []string {
	fields := []string{}
	if !r.Target.Valid() {
		fields = append(fields, "target")
	}
	if !IsBody(r.Body) {
		fields = append(fields, "body")
	}
	if r.ReplyPolicy != nil && !IsReplyPolicy(*r.ReplyPolicy) {
		fields = append(fields, "reply_policy")
	}
	if r.QuotePolicy != nil && !IsQuotePolicy(*r.QuotePolicy) {
		fields = append(fields, "quote_policy")
	}
	return fields
}

type ListQuotesRequest struct {
	Owner         profile.ProfileAddress `json:"owner"`
	PostID        PostID                 `json:"post_id"`
	PaginationKey *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit         *int32                 `json:"limit,omitempty"`
}

func (r *ListQuotesRequest) Normalize() {
	r.Owner = normalizeAddress(r.Owner)
}

func (r ListQuotesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListQuotesRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type ListQuotesResponse struct {
	Posts []Post `json:"posts"`
	// Partial is set when a region did not answer (PST-QTE-012).
	Partial           bool                  `json:"partial"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type DetachQuoteRequest struct {
	PostID      PostID                 `json:"post_id"`
	Quoter      profile.ProfileAddress `json:"quoter"`
	QuotePostID PostID                 `json:"quote_post_id"`
}

func (r *DetachQuoteRequest) Normalize() {
	r.Quoter = normalizeAddress(r.Quoter)
}

func (r DetachQuoteRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !profile.IsProfileAddress(r.Quoter) {
		fields = append(fields, "quoter")
	}
	if !IsPostID(r.QuotePostID) {
		fields = append(fields, "quote_post_id")
	}
	return fields
}

// MeshReadQuoteTargetRequest asks the owner's tenant whether the viewer, the
// quoter, can quote a timeline post (PST-QTE-003). The response is a MeshPost.
type MeshReadQuoteTargetRequest struct {
	TargetPostID     PostID         `json:"target_post_id"`
	ViewerHubUserDID hub.HubUserDID `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle  `json:"viewer_handle"`
}

func (r *MeshReadQuoteTargetRequest) Normalize() {}

func (r MeshReadQuoteTargetRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.TargetPostID) {
		fields = append(fields, "target_post_id")
	}
	return append(fields, validViewer(r.ViewerHubUserDID, r.ViewerHandle)...)
}

type MeshEmbedReference struct {
	TargetPostID     PostID         `json:"target_post_id"`
	QuotePostID      PostID         `json:"quote_post_id"`
	QuoterHubUserDID hub.HubUserDID `json:"quoter_hub_user_did"`
}

// MeshReadEmbedsRequest reads 1 to 50 embed targets in one region
// (PST-QTE-009).
type MeshReadEmbedsRequest struct {
	ViewerHubUserDID hub.HubUserDID       `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle        `json:"viewer_handle"`
	Items            []MeshEmbedReference `json:"items"`
}

func (r *MeshReadEmbedsRequest) Normalize() {}

func (r MeshReadEmbedsRequest) Validate() []string {
	fields := validViewer(r.ViewerHubUserDID, r.ViewerHandle)
	valid := len(r.Items) >= 1 && len(r.Items) <= MaxGetMany
	for _, item := range r.Items {
		if !IsPostID(item.TargetPostID) || !IsPostID(item.QuotePostID) ||
			!hub.IsHubUserDID(item.QuoterHubUserDID) {
			valid = false
		}
	}
	if !valid {
		fields = append(fields, "items")
	}
	return fields
}

type MeshEmbedStatus string

const (
	MeshEmbedPost        MeshEmbedStatus = "post"
	MeshEmbedUnavailable MeshEmbedStatus = "unavailable"
)

// MeshEmbedResult is one embed result. Post is set only when Status is
// `post`.
type MeshEmbedResult struct {
	Status       MeshEmbedStatus `json:"status"`
	TargetPostID PostID          `json:"target_post_id"`
	QuotePostID  PostID          `json:"quote_post_id"`
	Post         *MeshPost       `json:"post,omitempty"`
}

type MeshReadEmbedsResponse struct {
	// Results holds one result for each item, in request order.
	Results []MeshEmbedResult `json:"results"`
}

type MeshListQuotesRequest struct {
	PostID           PostID                `json:"post_id"`
	ViewerHubUserDID hub.HubUserDID        `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle         `json:"viewer_handle"`
	PaginationKey    *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit            *int32                `json:"limit,omitempty"`
}

func (r *MeshListQuotesRequest) Normalize() {}

func (r MeshListQuotesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r MeshListQuotesRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	fields = append(fields, validViewer(r.ViewerHubUserDID, r.ViewerHandle)...)
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

// MeshQuoteReference says where one quote post lives. It holds no words.
type MeshQuoteReference struct {
	QuoterHubUserDID hub.HubUserDID     `json:"quoter_hub_user_did"`
	QuoterHandle     hub.HubHandle      `json:"quoter_handle"`
	QuoterTenantID   directory.TenantID `json:"quoter_tenant_id"`
	QuotePostID      PostID             `json:"quote_post_id"`
	CreatedAt        time.Time          `json:"created_at"`
}

type MeshListQuotesResponse struct {
	Quotes            []MeshQuoteReference  `json:"quotes"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
