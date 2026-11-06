
- From T03: use `agencycontacts.Refuse` for MKT-REQ-003 and map its `Refusal` to Hub problem types for a Hub user's request; the Orgs mapping is `refusals` in `handlers/orgs/contacts/requests.go`. Sync the pointer with `agencycontacts.NoticeRequestAccepted` when the agency accepts.
