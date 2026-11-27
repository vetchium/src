package profileclient

import (
	"context"
	"crypto/tls"
	"fmt"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
)

// CardsOutcome is a tenant's answer to a card read: the response or a
// declared Problem.
type CardsOutcome struct {
	Cards   *profilespec.ReadCardsResponse
	Problem *problem.Details
}

// RelayReadCards asks the local mesh-api for the cards of handles this
// tenant does not home.
func (c *Client) RelayReadCards(
	ctx context.Context, request profilespec.RelayReadCardsRequest,
) (CardsOutcome, error) {
	return c.readCards(ctx, c.baseURL+"/mesh/profile/read-cards", request, nil)
}

// PeerReadCards asks a home tenant for the cards of handles it homes.
func (c *Client) PeerReadCards(
	ctx context.Context, tenant directoryspec.TenantID,
	request profilespec.PeerReadCardsRequest,
) (CardsOutcome, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return CardsOutcome{}, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return c.readCards(ctx,
		"https://"+name+":8443/api/mesh/profile/read-cards", request, tlsConfig)
}

func (c *Client) readCards(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (CardsOutcome, error) {
	response, err := c.post(ctx, endpoint, payload, tlsConfig)
	if err != nil {
		return CardsOutcome{}, err
	}
	if response.ok() {
		var cards profilespec.ReadCardsResponse
		if err := decode(response.body, &cards); err != nil {
			return CardsOutcome{}, err
		}
		if !validCards(cards) {
			return CardsOutcome{}, fmt.Errorf("%w: invalid cards", ErrInvalidResponse)
		}
		return CardsOutcome{Cards: &cards}, nil
	}
	details, err := response.problem()
	return CardsOutcome{Problem: details}, err
}

func validCards(response profilespec.ReadCardsResponse) bool {
	if response.Cards == nil || response.Unavailable == nil {
		return false
	}
	for _, card := range response.Cards {
		if !hubspec.IsHubHandle(card.Handle) {
			return false
		}
	}
	return true
}
