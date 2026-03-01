This file contains some of the potential things to do:

- i18n support
- Openings
- Applications
- Candidacies
- Interviews
- Hub Users
- Connections
- Domain verification audit log: Add a `domain_verification_events` table to track every
  verification request and result per domain (employer_id, domain, event_type, message,
  created_at). This enables audit trails for compliance and debugging. TODO markers exist in:
  - api-server/db/queries/regional.sql
  - specs/typespec/employer-domains/employer-domains.ts

From [8-user-management/README.md](./8-user-management/README.md)
After the subsequent features like Posts, Openings are done, the HubUsers should be able to visit an UI URL on the HubUsers Portal to see the Openings, Posts corresponding to the Tag. For now, we will just build the underlying infra.
