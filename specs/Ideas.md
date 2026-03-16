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

- Audit log UX improvements:
  - **Email-based actor filtering**: The filter-audit-logs API currently accepts `actor_user_id` as a UUID, but admins don't have UUIDs memorized. A future improvement would accept an email address, SHA-256-hash it server-side, resolve it to a user ID, and filter by that. Requires new API work.
  - **Target user email hash in event_data**: For events that affect a specific user (enable, disable, assign role, remove role), store `target_email_hash` in `event_data` at write time, mirroring the existing `invite_user` pattern. This gives forensic investigators a matchable identifier even after a user is deleted (audit logs have no FK constraints intentionally). Requires amending spec 11 handlers.
  - **Note**: Tags use user-defined slug IDs and cost centers use user-defined string IDs, so those are already human-readable in audit logs. The UUID readability problem applies only to `actor_user_id` and `target_user_id`.

From [8-user-management/README.md](./8-user-management/README.md)
After the subsequent features like Posts, Openings are done, the HubUsers should be able to visit an UI URL on the HubUsers Portal to see the Openings, Posts corresponding to the Tag. For now, we will just build the underlying infra.
