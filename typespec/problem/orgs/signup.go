package orgs

import "github.com/vetchium/src/typespec/problem"

var SignupUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/org-signup-unavailable",
	Title:  "Org signup unavailable",
	Status: 403,
	Detail: "This region is not accepting Org signup. Choose another region.",
}

var SignupDomainBlockedError = problem.Details{
	Type:   "vetchium-problem-details/org-signup-domain-blocked",
	Title:  "Org signup domain blocked",
	Status: 403,
	Detail: "Orgs cannot sign up with a public email provider's domain",
}

var DomainAlreadyOwnedError = problem.Details{
	Type:   "vetchium-problem-details/org-domain-already-owned",
	Title:  "Org domain already owned",
	Status: 409,
	Detail: "Another Org already owns this domain",
}

var InvalidSignupTokenError = problem.Details{
	Type:   "vetchium-problem-details/org-invalid-signup-token",
	Title:  "Invalid Org signup token",
	Status: 401,
	Detail: "Signup token is invalid, expired, consumed, or no longer eligible",
}

var DNSRecordNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-dns-record-not-found",
	Title:  "Domain verification record not found",
	Status: 422,
	Detail: "The domain verification TXT record was not found. Publish it and try again.",
}

var DirectoryUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/org-directory-unavailable",
	Title:  "Global directory unavailable",
	Status: 503,
	Detail: "Domain ownership cannot be checked right now. Try again later.",
}
