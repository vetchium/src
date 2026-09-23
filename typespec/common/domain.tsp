namespace Vetchium;

/**
 * Employer and institution domains are normalized by trimming, lowercasing
 * ASCII letters, and removing one terminal dot. Values must have at least two
 * DNS labels and use ASCII/Punycode rather than raw Unicode. IP addresses,
 * URLs, ports, email addresses, and wildcards are not domains for this field.
 */
@minLength(3)
@maxLength(253)
@pattern("^[A-Za-z0-9.-]+$")
scalar ProfessionalDomain extends string;
