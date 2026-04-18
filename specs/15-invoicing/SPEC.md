# Vetchium Invoicing Specification

Status: Draft
Date: 2026-04-18
Dependencies: Marketplace (`specs/14-marketplace/`); Org Tiers (`specs/16-org-tiers/`);
future Hiring vertical (staffing placement fees)

---

## 1. What This Is

Vetchium Invoicing is a document + status system for commercial invoices exchanged
between two parties on the platform. An Invoice answers: **who billed whom, for what,
how much, due when, and whether it has been paid**.

**Money does NOT move through Vetchium.** Payment happens off-platform via bank
transfer, wire, ACH, or cheque — Vetchium is the shared, auditable record of truth.
This keeps Vetchium out of merchant-of-record, KYC/AML, and regional tax-processing
obligations while still giving both parties a first-class invoice workflow.

### Invoicing is cross-cutting

Invoices attach to a **source** — the commercial context that justifies the invoice:

- **V1 scope — Marketplace Subscription**: a Provider Org bills a Consumer Org for
  services rendered under a Subscription (`specs/14-marketplace/`).
- **V2 scope — Staffing Placement**: a staffing-partner Agency bills a hiring Org for
  a successful placement under the Hiring vertical's agency-assisted workflow. Shape
  reserved now; wiring happens with the Hiring vertical spec.
- **Optional — Org Subscription (Vetchium → Org)**: Vetchium itself can use this
  infrastructure to invoice Orgs for their platform tier (`specs/16-org-tiers/`).
  This is an implementation choice — Vetchium may alternatively use an external
  billing provider (e.g., Stripe) for its own tier billing and skip this source type.

Additional source types may be added later without changing the core shape.

---

## 2. Participants

| Participant           | Role                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Issuer                | Creates and sends the Invoice. Authoritative for its content (line items, totals, tax assertions).                             |
| Recipient             | Acknowledges receipt, raises disputes, or records payment after paying off-platform.                                           |
| Vetchium              | Generates PDF, assigns per-Issuer sequential invoice numbers, tracks lifecycle, audits events, hosts a read-only admin view.   |

**Vetchium does NOT:**

- Process payments (no card / ACH rails).
- Certify tax correctness. The Issuer is responsible for VAT / GST / local compliance.
  V1 surfaces a free-form tax block; region-aware templates come later.
- Mediate disputes. `disputed` is a status flag; resolution is between the two parties.

---

## 3. Invoice Entity (conceptual)

**Identity:**

- `invoice_id` — internal only, **not exposed in URLs**.
- `invoice_number` — per-Issuer strictly-increasing integer, assigned at the
  `draft` → `issued` transition, immutable, never reused (even for voided invoices).
  Starts at 1 per Issuer.

**Source attachment (polymorphic):**

- `source_type` — enum: `marketplace_subscription` | `staffing_placement` | `org_subscription` (optional).
- `source_id` — identifier resolved against the appropriate source table.

**Parties:**

- `issuer_org_domain`, `recipient_org_domain` — canonical current domains.

**Commercial details:**

- `issue_date`, `due_date`.
- `period_start`, `period_end` (optional, for retainer-style invoices).
- `currency` (ISO-4217), `subtotal_amount`, `tax_amount`, `total_amount`.
- `line_items` — ordered list of `{description, quantity, unit_price, amount}`.
- `notes` — markdown, max 5000 chars.
- `issuer_tax_details`, `recipient_tax_details` — free-form blocks for VAT ID,
  GSTIN, HSN/SAC codes, bill-to details. Copied / snapshotted at issue time.

**Lifecycle:**

- `status` — `draft` | `issued` | `acknowledged` | `paid` | `disputed` | `void`.
- `issued_at`, `acknowledged_at`, `paid_at` timestamps.
- `recipient_payment_reference` — Recipient's off-platform reference (wire ID, cheque
  number). Required when marking paid.
- `dispute_note` — required when Recipient disputes.
- `void_reason` — required when Issuer voids.
- `document_key` — S3 key for the generated PDF, set on issue.

**Storage**: authoritative state lives in the **Issuer's regional DB**. A **global
invoice index** provides cross-region routing so Recipients see invoices addressed
to them across regions. A per-Issuer counter (regional) generates `invoice_number`.

Column-level schemas are deferred until the spec is implementation-ready.

---

## 4. State Machine

```
draft        → issued        (Issuer issues; invoice_number assigned; PDF generated)
issued       → acknowledged  (Recipient confirms receipt)
issued       → disputed      (Recipient disputes with required note)
issued       → void          (Issuer voids with required reason)
acknowledged → paid          (Recipient records off-platform payment with reference)
acknowledged → disputed      (Recipient disputes after acknowledging)
acknowledged → void          (Issuer voids with required reason)
disputed     → issued        (dispute resolved between parties; returns to issued)
```

Terminal: `paid`, `void`. `draft` is freely editable or deletable. Once `issued`, core
invoice fields (line items, totals, numbers) are immutable; only status and the
Recipient's signals (acknowledgement, dispute note, payment reference) change.

**`invoice_number` assignment**: on the `draft` → `issued` transition, atomically from
the per-Issuer counter. Never reused, even when an issued invoice is later voided —
the voided record retains its number to preserve an auditable sequence.

---

## 5. RBAC

### Org portal

- `org:manage_invoices` — Issuer: create / edit drafts / issue / void. Recipient:
  acknowledge / dispute / mark paid.
- `org:view_invoices` — read-only on invoices to/from own org.
- `org:superadmin` — bypasses.

### Admin portal

- `admin:view_invoices` — read-only admin access for moderation of reported invoices
  and platform-wide visibility. Admins do **not** mutate invoice content — the Issuer
  is the source of truth.
- `admin:superadmin` — bypasses.

| Action                                              | Required role                                  |
| --------------------------------------------------- | ---------------------------------------------- |
| Issue / edit draft / void (Issuer)                  | `org:manage_invoices`                          |
| Acknowledge / dispute / mark paid (Recipient)       | `org:manage_invoices`                          |
| View invoices to/from own org                       | `org:view_invoices` or `org:manage_invoices`   |
| Admin: read-only views, moderation flags            | `admin:view_invoices`                          |

---

## 6. Data Architecture (conceptual)

Column-level schemas deferred. Rough shape:

- **Invoices** live in the **Issuer's regional DB**.
- **Per-Issuer invoice-number counter** lives in the **Issuer's regional DB**.
- **Global invoice index** (cross-region routing) lives in the **Global DB** and
  carries the public identity (`issuer_org_domain` + `invoice_number`), the parties,
  the source linkage, status, issue date, total amount, and currency.
- Cross-DB writes follow the project's existing global-first / regional-second
  pattern with compensating transactions on failure.
- The Recipient sees invoices by querying the global index and joining back to
  Issuer-region reads. Same pattern used for Subscriptions and the Marketplace
  Listing catalog.

---

## 7. URL Shape

All invoice URLs use the per-Issuer `invoice_number`, mirroring the Marketplace
Listing scheme. UUIDs are never exposed.

| Route                                             | Purpose                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `/invoices`                                       | My Invoices — unified Sent/Received view.                           |
| `/invoices/new?source_type=<type>&source_id=<id>` | Issue Invoice form (Issuer side).                                   |
| `/invoices/<issuer-org-domain>/<invoice_number>`  | Canonical Invoice page — role-aware (Issuer, Recipient, Admin).     |

Router note: `/invoices` and `/invoices/new` are literal routes; the
`:issuer-org-domain/:invoice_number` pattern matches everything else.

---

## 8. UI Screens

### 8.1 Dashboard tile

**Invoices** tile at `/invoices`, visible when the user has `org:manage_invoices` or
`org:view_invoices`.

### 8.2 `/invoices` — Unified Invoice List

Segmented toggle at the top: **Sent** (viewing org is Issuer) / **Received** (viewing
org is Recipient).

Rows: counterparty org, `#<invoice_number>`, source (e.g. "Marketplace: Executive
Search `#42`" or "Staffing: Placement for Senior SWE"), issue date, due date, amount
+ currency, status.

Filters: status, date range, counterparty, source type.

### 8.3 `/invoices/new` — Issue Invoice

Issuer-side form. Pre-populated fields from the source:

- `marketplace_subscription` → Recipient = Subscription's Consumer; default currency
  = Provider's configured currency; the Subscription's Listing is referenced in notes.
- `staffing_placement` (V2) → Recipient = hiring Org; details pulled from Placement.
- `org_subscription` (Vetchium-issued) → Recipient = Org; source = the Org
  Subscription period being billed.

Editable fields: due date, currency, line items (computed subtotal), tax amount
(free-form), period start/end (optional), notes (markdown, max 5000 chars), Issuer
and Recipient tax details.

Actions: **Save Draft** (no `invoice_number`, no PDF), **Issue** (`invoice_number`
assigned atomically, PDF generated, index row upserted, Recipient notified). On
issue, the URL becomes `/invoices/<my-domain>/<invoice_number>`.

### 8.4 `/invoices/<issuer-domain>/<invoice_number>` — Invoice Detail

Both parties see the same document. Role-aware action panel:

- **Issuer** (`org:manage_invoices`): `draft` → Edit / Issue / Delete; `issued` or
  `acknowledged` → Void (required reason); always Download PDF.
- **Recipient** (`org:manage_invoices`): `issued` → Acknowledge / Dispute (required
  note) / Mark Paid (required payment reference); `acknowledged` → Dispute / Mark
  Paid; `disputed` → Withdraw dispute (→ `issued`); always Download PDF.

A **status timeline** stepper visualises the lifecycle with timestamps.

### 8.5 Admin Invoice Oversight

Read-only list at `/admin/invoices`. Filters: issuer, recipient, status, date range,
source type. Admins may flag Invoices for review if reported but do NOT mutate
content.

---

## 9. Notifications

| Event                     | Notified                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| Invoice issued            | Recipient users with `org:manage_invoices` or `org:view_invoices`.        |
| Invoice acknowledged      | Issuer users (same roles).                                                |
| Invoice disputed          | Issuer users.                                                             |
| Dispute withdrawn         | Issuer users.                                                             |
| Invoice marked paid       | Issuer users.                                                             |
| Invoice voided            | Recipient users.                                                          |
| Due-date approaching      | Recipient users, a configurable number of days before `due_date` (default 3). Only for `issued` and `acknowledged`. |
| Invoice overdue           | Recipient users, on `due_date + 1` and weekly thereafter, while still `issued` / `acknowledged`. |

Notification transport uses the platform's existing notification pipeline.

---

## 10. Audit Logging

Every write to an Invoice emits an audit log entry in the Issuer's regional DB,
inside the same transaction as the write. Event types:

- `org.invoice_draft_created`
- `org.invoice_issued`
- `org.invoice_acknowledged`
- `org.invoice_disputed`
- `org.invoice_dispute_withdrawn`
- `org.invoice_marked_paid`
- `org.invoice_voided`
- `org.invoice_draft_deleted`

`event_data` includes `invoice_id`, `invoice_number` (where assigned),
`issuer_org_domain`, `recipient_org_domain`. No raw PII beyond org domains.

---

## 11. Open Questions / Future Work

- **Currency conversion / multi-currency reporting**: V1 stores per-invoice
  `currency`. FX conversion deferred.
- **Recurring-invoice templates**: retainer Subscriptions will benefit from
  auto-emitting Invoices on a schedule. V2.
- **Credit notes and partial payments**: deferred.
- **Region-specific tax templates**: V1 uses a free-form tax block; V2 adds
  region-aware templates (EU VAT, India GST, etc.) with prescribed formats.
- **Staffing Placement source wiring**: shape reserved; Placement entity itself not
  yet spec'd. Formalised with the Hiring vertical.
- **Org Subscription source**: implementation choice. Vetchium may use this
  invoicing infrastructure for its own tier billing, or integrate an external
  billing provider.
- **Vetchium Pay integration point**: once opt-in payment orchestration lands, the
  `acknowledged` → `paid` transition (and possibly an `escrowed` intermediate state)
  becomes automatable. Until then, manual and Recipient-driven.
- **Sequential-number resets on year boundary**: some jurisdictions mandate per-
  fiscal-year numbering. Current counter is monotonic. Revisit for compliance.
- **Column-level schemas**: defer until implementation.
