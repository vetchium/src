// Package postsclient reads timeline posts from the home tenant of their
// owner, through a tenant's local relay or a mutually authenticated tenant
// peer. A caller maps an error or a problem to `hub-post-unavailable`; it
// never falls back to a local copy (PST-RD-004).
package postsclient

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
	"strings"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 1 << 20

var ErrInvalidResponse = errors.New("invalid posts response")

// ListOutcome is a tenant's answer to a list: the response or a Problem.
type ListOutcome struct {
	List    *postsspec.MeshListPostsResponse
	Problem *problem.Details
}

// GetManyOutcome is a tenant's answer to a get-many.
type GetManyOutcome struct {
	Results *postsspec.MeshGetManyPostsResponse
	Problem *problem.Details
}

// Outcome is a tenant's answer to a reply read: the response or a Problem.
type Outcome[T any] struct {
	Value   *T
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
		credential: credential,
		timeout:    timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

// List asks the local mesh-api for one page of an owner's posts.
func (c *Client) List(
	ctx context.Context, request postsspec.MeshListPostsRequest,
) (ListOutcome, error) {
	return c.list(ctx, c.baseURL+"/mesh/posts/list", request, nil)
}

// GetMany asks the local mesh-api for posts by owner and ID.
func (c *Client) GetMany(
	ctx context.Context, request postsspec.MeshGetManyPostsRequest,
) (GetManyOutcome, error) {
	return c.getMany(ctx, c.baseURL+"/mesh/posts/get-many", request, nil)
}

// PeerList asks the owner's home tenant over the mesh.
func (c *Client) PeerList(
	ctx context.Context, tenant directoryspec.TenantID,
	request postsspec.MeshListPostsRequest,
) (ListOutcome, error) {
	endpoint, tlsConfig, err := c.peer(tenant, "list")
	if err != nil {
		return ListOutcome{}, err
	}
	return c.list(ctx, endpoint, request, tlsConfig)
}

// PeerGetMany asks the owners' home tenant over the mesh.
func (c *Client) PeerGetMany(
	ctx context.Context, tenant directoryspec.TenantID,
	request postsspec.MeshGetManyPostsRequest,
) (GetManyOutcome, error) {
	endpoint, tlsConfig, err := c.peer(tenant, "get-many")
	if err != nil {
		return GetManyOutcome{}, err
	}
	return c.getMany(ctx, endpoint, request, tlsConfig)
}

// ListReplies asks the local mesh-api for one page of a thread.
func (c *Client) ListReplies(
	ctx context.Context, request postsspec.MeshListRepliesRequest,
) (Outcome[postsspec.MeshListRepliesResponse], error) {
	return read(ctx, c, c.baseURL+"/mesh/posts/list-replies", request, nil,
		func(response *postsspec.MeshListRepliesResponse) bool {
			return validReplies(request, response)
		})
}

// PeerListReplies asks the post owner's home tenant over the mesh.
func (c *Client) PeerListReplies(
	ctx context.Context, tenant directoryspec.TenantID,
	request postsspec.MeshListRepliesRequest,
) (Outcome[postsspec.MeshListRepliesResponse], error) {
	endpoint, tlsConfig, err := c.peer(tenant, "list-replies")
	if err != nil {
		return Outcome[postsspec.MeshListRepliesResponse]{}, err
	}
	return read(ctx, c, endpoint, request, tlsConfig,
		func(response *postsspec.MeshListRepliesResponse) bool {
			return validReplies(request, response)
		})
}

// GetReply asks the local mesh-api who wrote one reply (PST-RPL-004).
func (c *Client) GetReply(
	ctx context.Context, request postsspec.MeshGetReplyRequest,
) (Outcome[postsspec.MeshGetReplyResponse], error) {
	return read(ctx, c, c.baseURL+"/mesh/posts/get-reply", request, nil,
		func(response *postsspec.MeshGetReplyResponse) bool {
			return validReply(request, response)
		})
}

// PeerGetReply asks the post owner's home tenant over the mesh.
func (c *Client) PeerGetReply(
	ctx context.Context, tenant directoryspec.TenantID,
	request postsspec.MeshGetReplyRequest,
) (Outcome[postsspec.MeshGetReplyResponse], error) {
	endpoint, tlsConfig, err := c.peer(tenant, "get-reply")
	if err != nil {
		return Outcome[postsspec.MeshGetReplyResponse]{}, err
	}
	return read(ctx, c, endpoint, request, tlsConfig,
		func(response *postsspec.MeshGetReplyResponse) bool {
			return validReply(request, response)
		})
}

// ListAuthorReplies asks the local mesh-api for one page of a user's
// replies.
func (c *Client) ListAuthorReplies(
	ctx context.Context, request postsspec.MeshListAuthorRepliesRequest,
) (Outcome[postsspec.MeshListAuthorRepliesResponse], error) {
	return read(ctx, c, c.baseURL+"/mesh/posts/list-author-replies", request,
		nil, validAuthorReplies)
}

// PeerListAuthorReplies asks the author's home tenant over the mesh.
func (c *Client) PeerListAuthorReplies(
	ctx context.Context, tenant directoryspec.TenantID,
	request postsspec.MeshListAuthorRepliesRequest,
) (Outcome[postsspec.MeshListAuthorRepliesResponse], error) {
	endpoint, tlsConfig, err := c.peer(tenant, "list-author-replies")
	if err != nil {
		return Outcome[postsspec.MeshListAuthorRepliesResponse]{}, err
	}
	return read(ctx, c, endpoint, request, tlsConfig, validAuthorReplies)
}

func (c *Client) peer(
	tenant directoryspec.TenantID, operation string,
) (string, *tls.Config, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return "", nil, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return "https://" + name + ":8443/api/mesh/posts/" + operation, tlsConfig, nil
}

func validList(response *postsspec.MeshListPostsResponse) bool {
	if response.Posts == nil {
		return false
	}
	for _, item := range response.Posts {
		if !postsspec.IsPostID(item.PostID) {
			return false
		}
	}
	return true
}

// validGetMany holds the answer to the question: one result for each
// reference, in request order, and a post only for `found`.
func validGetMany(
	request postsspec.MeshGetManyPostsRequest,
	response *postsspec.MeshGetManyPostsResponse,
) bool {
	if len(response.Results) != len(request.Posts) {
		return false
	}
	for index, result := range response.Results {
		reference := request.Posts[index]
		if result.OwnerHubUserDID != reference.OwnerHubUserDID ||
			result.PostID != reference.PostID {
			return false
		}
		switch result.Status {
		case postsspec.MeshPostFound:
			if result.Post == nil || result.Post.PostID != result.PostID {
				return false
			}
		case postsspec.MeshPostNotFound, postsspec.MeshPostNotHomed:
			if result.Post != nil {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// validReplies holds the answer to the question: replies of the asked post
// and parent, with the fields the viewer's tenant relies on.
func validReplies(
	request postsspec.MeshListRepliesRequest,
	response *postsspec.MeshListRepliesResponse,
) bool {
	if response.Replies == nil || len(response.Replies) > int(request.EffectiveLimit()) {
		return false
	}
	for _, item := range response.Replies {
		if !postsspec.IsPostID(item.ReplyID) || item.PostID != request.PostID ||
			!hubspec.IsHubUserDID(item.AuthorHubUserDID) ||
			!hubspec.IsHubHandle(item.AuthorHandle) ||
			!postsspec.IsThreadReplyState(item.State) ||
			(item.State == postsspec.ThreadReplyPlaceholder) != (item.Body == nil) ||
			(item.ParentReplyID == nil) != (request.ParentReplyID == nil) ||
			(item.ParentReplyID != nil && *item.ParentReplyID != *request.ParentReplyID) {
			return false
		}
	}
	return true
}

func validReply(
	request postsspec.MeshGetReplyRequest,
	response *postsspec.MeshGetReplyResponse,
) bool {
	return response.ReplyID == request.ReplyID && response.PostID == request.PostID &&
		hubspec.IsHubUserDID(response.AuthorHubUserDID) &&
		directoryspec.IsTenantID(response.AuthorTenantID) &&
		hubspec.IsHubHandle(response.AuthorHandle) &&
		postsspec.IsThreadReplyState(response.State) &&
		(response.ParentReplyID == nil || postsspec.IsPostID(*response.ParentReplyID))
}

func validAuthorReplies(response *postsspec.MeshListAuthorRepliesResponse) bool {
	if response.Replies == nil {
		return false
	}
	for _, item := range response.Replies {
		if !postsspec.IsPostID(item.ReplyID) || !postsspec.IsPostID(item.PostID) ||
			!hubspec.IsHubHandle(item.PostOwnerHandle) ||
			!postsspec.IsAuthorReplyState(item.State) {
			return false
		}
	}
	return true
}

// read posts a request and decodes the typed answer. valid is the question
// the decoded answer must satisfy.
func read[T any](
	ctx context.Context, c *Client, endpoint string, request any,
	tlsConfig *tls.Config, valid func(*T) bool,
) (Outcome[T], error) {
	body, details, err := c.exchange(ctx, endpoint, request, tlsConfig)
	if err != nil || details != nil {
		return Outcome[T]{Problem: details}, err
	}
	var response T
	if err := decode(body, &response); err != nil {
		return Outcome[T]{}, err
	}
	if !valid(&response) {
		return Outcome[T]{}, fmt.Errorf("%w: unexpected content", ErrInvalidResponse)
	}
	return Outcome[T]{Value: &response}, nil
}

// exchange posts the request. It returns the body of a 200 answer, or the
// declared problem of any other answer.
func (c *Client) exchange(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) ([]byte, *problem.Details, error) {
	status, mediaType, body, err := c.post(ctx, endpoint, payload, tlsConfig)
	if err != nil {
		return nil, nil, err
	}
	if status == http.StatusOK && mediaType == "application/json" {
		return body, nil, nil
	}
	if mediaType != problem.MediaType {
		return nil, nil, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(body, &details); err != nil {
		return nil, nil, err
	}
	if details.Status != status || details.Type == "" {
		return nil, nil, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return nil, &details, nil
}

func (c *Client) list(
	ctx context.Context, endpoint string,
	request postsspec.MeshListPostsRequest, tlsConfig *tls.Config,
) (ListOutcome, error) {
	body, details, err := c.exchange(ctx, endpoint, request, tlsConfig)
	if err != nil || details != nil {
		return ListOutcome{Problem: details}, err
	}
	var response postsspec.MeshListPostsResponse
	if err := decode(body, &response); err != nil {
		return ListOutcome{}, err
	}
	if !validList(&response) {
		return ListOutcome{}, fmt.Errorf("%w: unexpected content", ErrInvalidResponse)
	}
	return ListOutcome{List: &response}, nil
}

func (c *Client) getMany(
	ctx context.Context, endpoint string,
	request postsspec.MeshGetManyPostsRequest, tlsConfig *tls.Config,
) (GetManyOutcome, error) {
	body, details, err := c.exchange(ctx, endpoint, request, tlsConfig)
	if err != nil || details != nil {
		return GetManyOutcome{Problem: details}, err
	}
	var response postsspec.MeshGetManyPostsResponse
	if err := decode(body, &response); err != nil {
		return GetManyOutcome{}, err
	}
	if !validGetMany(request, &response) {
		return GetManyOutcome{}, fmt.Errorf("%w: unexpected content", ErrInvalidResponse)
	}
	return GetManyOutcome{Results: &response}, nil
}

func (c *Client) post(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (int, string, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, "", nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return 0, "", nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout:   c.timeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, "", nil, fmt.Errorf("read posts: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return 0, "", nil, err
	}
	if len(data) > maxResponseBytes {
		return 0, "", nil, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return response.StatusCode, mediaType, data, nil
}

func decode(body []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}
