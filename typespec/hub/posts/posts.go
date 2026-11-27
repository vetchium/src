package posts

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
)

const (
	DefaultLimit = 20
	MaxLimit     = 50
	// MaxBodyLength is the most code points in a post or reply body
	// (PST-GEN-003).
	MaxBodyLength = 512
)

type PostID string

type PostKind string

const (
	KindPost  PostKind = "post"
	KindQuote PostKind = "quote"
)

type ReplyPolicy string

const (
	ReplyEveryone ReplyPolicy = "everyone"
	ReplyNobody   ReplyPolicy = "nobody"
)

type QuotePolicy string

const (
	QuoteEveryone QuotePolicy = "everyone"
	QuoteNobody   QuotePolicy = "nobody"
)

var postIDPattern = regexp.MustCompile(`^[0-9a-v]{20}[0-9a-z]{20}$`)

func IsPostID(value PostID) bool {
	return postIDPattern.MatchString(string(value))
}

// IsBody reports trimmed text of 1 to 512 code points without U+0000, which
// PostgreSQL text cannot hold.
func IsBody(value string) bool {
	size := utf8.RuneCountInString(value)
	return size >= 1 && size <= MaxBodyLength &&
		strings.TrimSpace(value) == value && !strings.ContainsRune(value, 0)
}

func IsReplyPolicy(value ReplyPolicy) bool {
	return value == ReplyEveryone || value == ReplyNobody
}

func IsQuotePolicy(value QuotePolicy) bool {
	return value == QuoteEveryone || value == QuoteNobody
}

// PostOwner holds card fields read from the owner's tenant at read time.
type PostOwner struct {
	Handle      hub.HubHandle       `json:"handle"`
	Alias       *directory.HubAlias `json:"alias,omitempty"`
	DisplayName common.DisplayName  `json:"display_name"`
	PictureURL  *string             `json:"picture_url,omitempty"`
}

// Post is a timeline post. T23 adds the quote target and the embed.
type Post struct {
	PostID      PostID      `json:"post_id"`
	Owner       PostOwner   `json:"owner"`
	Kind        PostKind    `json:"kind"`
	Body        string      `json:"body"`
	ReplyPolicy ReplyPolicy `json:"reply_policy"`
	QuotePolicy QuotePolicy `json:"quote_policy"`
	Locked      bool        `json:"locked"`
	ReplyCount  int32       `json:"reply_count"`
	QuoteCount  int32       `json:"quote_count"`
	Revision    int32       `json:"revision"`
	Edited      bool        `json:"edited"`
	CreatedAt   time.Time   `json:"created_at"`
	EditedAt    *time.Time  `json:"edited_at,omitempty"`
}

type CreatePostRequest struct {
	Body        string       `json:"body"`
	ReplyPolicy *ReplyPolicy `json:"reply_policy,omitempty"`
	QuotePolicy *QuotePolicy `json:"quote_policy,omitempty"`
}

func (r *CreatePostRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
}

func (r CreatePostRequest) Validate() []string {
	fields := []string{}
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

type EditPostRequest struct {
	PostID   PostID `json:"post_id"`
	Body     string `json:"body"`
	Revision int32  `json:"revision"`
}

func (r *EditPostRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
}

func (r EditPostRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !IsBody(r.Body) {
		fields = append(fields, "body")
	}
	if r.Revision < 1 {
		fields = append(fields, "revision")
	}
	return fields
}

type RemovePostRequest struct {
	PostID PostID `json:"post_id"`
}

func (r *RemovePostRequest) Normalize() {}

func (r RemovePostRequest) Validate() []string {
	if !IsPostID(r.PostID) {
		return []string{"post_id"}
	}
	return []string{}
}

type SetPostPoliciesRequest struct {
	PostID      PostID      `json:"post_id"`
	ReplyPolicy ReplyPolicy `json:"reply_policy"`
	QuotePolicy QuotePolicy `json:"quote_policy"`
	Locked      bool        `json:"locked"`
}

func (r *SetPostPoliciesRequest) Normalize() {}

func (r SetPostPoliciesRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !IsReplyPolicy(r.ReplyPolicy) {
		fields = append(fields, "reply_policy")
	}
	if !IsQuotePolicy(r.QuotePolicy) {
		fields = append(fields, "quote_policy")
	}
	return fields
}

// ValidPage reports the invalid fields of a pagination key and limit.
func ValidPage(key *common.PaginationKey, limit *int32) []string {
	fields := []string{}
	if key != nil && !common.IsPaginationKey(*key) {
		fields = append(fields, "pagination_key")
	}
	if limit != nil && (*limit < 1 || *limit > MaxLimit) {
		fields = append(fields, "limit")
	}
	return fields
}

func effectiveLimit(limit *int32) int32 {
	if limit == nil {
		return DefaultLimit
	}
	return *limit
}

type ListPostsRequest struct {
	Owner         profile.ProfileAddress `json:"owner"`
	PaginationKey *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit         *int32                 `json:"limit,omitempty"`
}

func (r *ListPostsRequest) Normalize() {
	r.Owner = profile.ProfileAddress(strings.TrimSpace(string(r.Owner)))
}

func (r ListPostsRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListPostsRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type GetPostRequest struct {
	Owner  profile.ProfileAddress `json:"owner"`
	PostID PostID                 `json:"post_id"`
}

func (r *GetPostRequest) Normalize() {
	r.Owner = profile.ProfileAddress(strings.TrimSpace(string(r.Owner)))
}

func (r GetPostRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	return fields
}

type ListPostsResponse struct {
	Posts             []Post                `json:"posts"`
	Muted             bool                  `json:"muted"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
