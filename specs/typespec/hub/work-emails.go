package hub

import (
	"errors"
	"regexp"
	"strings"

	"vetchium-api-server.typespec/common"
)

type WorkEmailStintStatus string
type WorkEmailStintEndedReason string

const (
	WorkEmailStintStatusPendingVerification WorkEmailStintStatus = "pending_verification"
	WorkEmailStintStatusActive              WorkEmailStintStatus = "active"
	WorkEmailStintStatusEnded               WorkEmailStintStatus = "ended"

	WorkEmailStintEndedReasonUserRemoved         WorkEmailStintEndedReason = "user_removed"
	WorkEmailStintEndedReasonUserRemovedPending  WorkEmailStintEndedReason = "user_removed_pending"
	WorkEmailStintEndedReasonVerificationExpired WorkEmailStintEndedReason = "verification_expired"
	WorkEmailStintEndedReasonReverifyTimeout     WorkEmailStintEndedReason = "reverify_timeout"
	WorkEmailStintEndedReasonSuperseded          WorkEmailStintEndedReason = "superseded"
)

type WorkEmailStintOwnerView struct {
	StintID                      string                     `json:"stint_id"`
	EmailAddress                 string                     `json:"email_address"`
	Domain                       string                     `json:"domain"`
	Status                       WorkEmailStintStatus       `json:"status"`
	FirstVerifiedAt              *string                    `json:"first_verified_at,omitempty"`
	LastVerifiedAt               *string                    `json:"last_verified_at,omitempty"`
	EndedAt                      *string                    `json:"ended_at,omitempty"`
	EndedReason                  *WorkEmailStintEndedReason `json:"ended_reason,omitempty"`
	PendingCodeExpiresAt         *string                    `json:"pending_code_expires_at,omitempty"`
	PendingCodeAttemptsRemaining *int32                     `json:"pending_code_attempts_remaining,omitempty"`
	ReverifyChallengeIssuedAt    *string                    `json:"reverify_challenge_issued_at,omitempty"`
	ReverifyChallengeExpiresAt   *string                    `json:"reverify_challenge_expires_at,omitempty"`
	CreatedAt                    string                     `json:"created_at"`
	UpdatedAt                    string                     `json:"updated_at"`
}

type PublicEmployerStint struct {
	Domain    string `json:"domain"`
	IsCurrent bool   `json:"is_current"`
	StartYear int32  `json:"start_year"`
	EndYear   *int32 `json:"end_year,omitempty"`
}

type AddWorkEmailRequest struct {
	EmailAddress string `json:"email_address"`
}

type AddWorkEmailResponse struct {
	StintID              string `json:"stint_id"`
	PendingCodeExpiresAt string `json:"pending_code_expires_at"`
}

type VerifyWorkEmailRequest struct {
	StintID string `json:"stint_id"`
	Code    string `json:"code"`
}

type ResendWorkEmailCodeRequest struct {
	StintID string `json:"stint_id"`
}

type ReverifyWorkEmailRequest struct {
	StintID string `json:"stint_id"`
	Code    string `json:"code"`
}

type RemoveWorkEmailRequest struct {
	StintID string `json:"stint_id"`
}

type GetMyWorkEmailRequest struct {
	StintID string `json:"stint_id"`
}

type ListMyWorkEmailsRequest struct {
	FilterStatus  []WorkEmailStintStatus `json:"filter_status,omitempty"`
	FilterDomain  *string                `json:"filter_domain,omitempty"`
	PaginationKey *string                `json:"pagination_key,omitempty"`
	Limit         *int32                 `json:"limit,omitempty"`
}

type ListMyWorkEmailsResponse struct {
	WorkEmails        []WorkEmailStintOwnerView `json:"work_emails"`
	NextPaginationKey *string                   `json:"next_pagination_key,omitempty"`
}

type ListPublicEmployerStintsRequest struct {
	Handle string `json:"handle"`
}

type ListPublicEmployerStintsResponse struct {
	Stints []PublicEmployerStint `json:"stints"`
}

// Validation errors
var (
	ErrEmailRequired   = errors.New("email_address is required")
	ErrEmailInvalid    = errors.New("email_address is not a valid email")
	ErrEmailTooLong    = errors.New("email_address must be at most 254 characters")
	ErrStintIDRequired = errors.New("stint_id is required")
	ErrCodeRequired    = errors.New("code is required")
	ErrCodeInvalid     = errors.New("code must be a 6-digit number")
	ErrHandleRequired  = errors.New("handle is required")
)

var codeRegex = regexp.MustCompile(`^\d{6}$`)

func isValidEmailLight(email string) bool {
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	local, domain := parts[0], parts[1]
	if local == "" || domain == "" {
		return false
	}
	return strings.Contains(domain, ".")
}

func (r AddWorkEmailRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", ErrEmailRequired))
	} else if len(r.EmailAddress) > 254 {
		errs = append(errs, common.NewValidationError("email_address", ErrEmailTooLong))
	} else if !isValidEmailLight(r.EmailAddress) {
		errs = append(errs, common.NewValidationError("email_address", ErrEmailInvalid))
	}
	return errs
}

func (r VerifyWorkEmailRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.StintID == "" {
		errs = append(errs, common.NewValidationError("stint_id", ErrStintIDRequired))
	}
	if r.Code == "" {
		errs = append(errs, common.NewValidationError("code", ErrCodeRequired))
	} else if !codeRegex.MatchString(r.Code) {
		errs = append(errs, common.NewValidationError("code", ErrCodeInvalid))
	}
	return errs
}

func (r ResendWorkEmailCodeRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.StintID == "" {
		errs = append(errs, common.NewValidationError("stint_id", ErrStintIDRequired))
	}
	return errs
}

func (r ReverifyWorkEmailRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.StintID == "" {
		errs = append(errs, common.NewValidationError("stint_id", ErrStintIDRequired))
	}
	if r.Code == "" {
		errs = append(errs, common.NewValidationError("code", ErrCodeRequired))
	} else if !codeRegex.MatchString(r.Code) {
		errs = append(errs, common.NewValidationError("code", ErrCodeInvalid))
	}
	return errs
}

func (r RemoveWorkEmailRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.StintID == "" {
		errs = append(errs, common.NewValidationError("stint_id", ErrStintIDRequired))
	}
	return errs
}

func (r GetMyWorkEmailRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.StintID == "" {
		errs = append(errs, common.NewValidationError("stint_id", ErrStintIDRequired))
	}
	return errs
}

func (r ListMyWorkEmailsRequest) Validate() []common.ValidationError {
	return nil
}

func (r ListPublicEmployerStintsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Handle == "" {
		errs = append(errs, common.NewValidationError("handle", ErrHandleRequired))
	}
	return errs
}
