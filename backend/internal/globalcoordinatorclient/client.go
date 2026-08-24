package globalcoordinatorclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"

	"backend/internal/appconfig"
)

const generateShortIDPath = "/api/global-coordinator/generate-short-id"

type Client struct {
	baseURL    string
	credential string
	httpClient *http.Client
}

func New(baseURL, credential string, timeout time.Duration) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		credential: credential,
		httpClient: &http.Client{Timeout: timeout},
	}
}

func NewFromConfig(config appconfig.GlobalCoordinator) (*Client, error) {
	credential, err := config.Credential()
	if err != nil {
		return nil, err
	}
	return New(config.BaseURL, credential, config.RequestTimeout), nil
}

func (c *Client) GenerateShortID(
	ctx context.Context,
) (coordinatorspec.ShortID, error) {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+generateShortIDPath, nil,
	)
	if err != nil {
		return "", fmt.Errorf("create global coordinator request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.credential)
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("call global coordinator: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusCreated {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return "", fmt.Errorf(
			"global coordinator returned HTTP %d", response.StatusCode,
		)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return "", fmt.Errorf("global coordinator returned non-JSON response")
	}
	var body coordinatorspec.GenerateShortIDResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return "", fmt.Errorf("decode global coordinator response: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", fmt.Errorf("decode global coordinator response: trailing data")
	}
	if !coordinatorspec.IsShortID(body.ShortID) {
		return "", fmt.Errorf("global coordinator returned invalid short ID")
	}
	return body.ShortID, nil
}
