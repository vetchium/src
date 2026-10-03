import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type {
  BillingState,
  InvoiceFailure,
  InvoiceReason,
  InvoiceState,
  PaymentMethodKind,
} from "./billing.ts";
import { isPaymentMethodKind } from "./billing.ts";
import {
  type BillingInterval,
  isBillingInterval,
  isOrgPlan,
  type OrgPlan,
  type OrgPlanOID,
  requiresBillingInterval,
} from "./plans.ts";

export interface ScheduledPlanChange {
  plan_oid: OrgPlanOID;
  /** Absent when the scheduled plan is `org-free-tier`. */
  billing_interval?: BillingInterval;
}

/**
 * A charge for one period. It carries no amount: while payments are simulated
 * the portal owns the display prices.
 */
export interface OrgInvoice {
  invoice_id: string;
  plan_oid: OrgPlanOID;
  billing_interval: BillingInterval;
  period_start: string;
  period_end: string;
  reason: InvoiceReason;
  state: InvoiceState;
  created_at: string;
  /** Present while the invoice is open. */
  due_at?: string;
  paid_at?: string;
  /** Present while the invoice is open. */
  last_failure?: InvoiceFailure;
  attempt_count: number;
}

export interface OrgPaymentMethod {
  kind: PaymentMethodKind;
}

export interface OrgSubscription {
  plan_oid: OrgPlanOID;
  /** Present exactly when the plan is paid. */
  billing_interval?: BillingInterval;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  scheduled_change?: ScheduledPlanChange;
  billing_state: BillingState;
  /** Present exactly when the Org is past due. */
  open_invoice?: OrgInvoice;
  payment_method?: OrgPaymentMethod;
  seats_in_use: number;
  /** Absent while the Org has no seat cap. */
  seat_limit?: number;
}

export interface SetSubscriptionPlanRequest {
  plan_oid: OrgPlan;
  /** Absent for `org-free-tier`; required otherwise. Never null. */
  billing_interval?: BillingInterval;
}

/**
 * Applies the same rules as the Go companion's Validate() to an untrusted
 * value, including an explicit `billing_interval: null`. Returns the invalid
 * JSON field names.
 */
export function validateSetSubscriptionPlanRequest(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return ["plan_oid", "billing_interval"];
  }
  const record = value as Record<string, unknown>;
  const fields: string[] = [];
  const planOID = record.plan_oid;
  const validPlan = typeof planOID === "string" && isOrgPlan(planOID);
  if (!validPlan) fields.push("plan_oid");
  const billingValue = record.billing_interval;
  const present = billingValue !== undefined;
  if (billingValue === null) {
    fields.push("billing_interval");
  } else if (present && !isBillingInterval(billingValue)) {
    fields.push("billing_interval");
  } else if (
    validPlan &&
    requiresBillingInterval(planOID as OrgPlan) !== present
  ) {
    fields.push("billing_interval");
  }
  return fields;
}

export interface SetPaymentMethodRequest {
  kind: PaymentMethodKind;
}

export function validateSetPaymentMethodRequest(
  request: SetPaymentMethodRequest,
): string[] {
  return isPaymentMethodKind(request.kind) ? [] : ["kind"];
}

export interface ListInvoicesRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
}

export function validateListInvoicesRequest(
  request: ListInvoicesRequest,
): string[] {
  const fields: string[] = [];
  if (request.limit !== undefined && !isPageSize(request.limit)) {
    fields.push("limit");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  return fields;
}

export interface ListInvoicesResponse {
  /** Newest first. */
  invoices: OrgInvoice[];
  next_pagination_key?: PaginationKey;
}

export interface PayInvoiceRequest {
  invoice_id: string;
}

const invoiceID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isInvoiceID(value: string): boolean {
  return invoiceID.test(value);
}

export function validatePayInvoiceRequest(
  request: PayInvoiceRequest,
): string[] {
  return isInvoiceID(request.invoice_id) ? [] : ["invoice_id"];
}
