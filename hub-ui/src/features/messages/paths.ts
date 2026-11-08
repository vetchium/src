/** A conversation by the agency's primary domain, which names it uniquely
 * and never changes. */
export const conversationPath = (agencyDomain: string) =>
  `/messages/o/${encodeURIComponent(agencyDomain)}`;
