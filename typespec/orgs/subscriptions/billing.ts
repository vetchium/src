export const billingStateValues = ["current", "past-due"] as const;
export type BillingState = (typeof billingStateValues)[number];

export const invoiceStateValues = ["paid", "open", "void"] as const;
export type InvoiceState = (typeof invoiceStateValues)[number];

export const invoiceReasonValues = ["upgrade", "renewal"] as const;
export type InvoiceReason = (typeof invoiceReasonValues)[number];

export const invoiceFailureValues = ["declined", "no_payment_method"] as const;
export type InvoiceFailure = (typeof invoiceFailureValues)[number];

export const paymentMethodKindValues = [
  "simulated-succeeds",
  "simulated-declines",
] as const;
export type PaymentMethodKind = (typeof paymentMethodKindValues)[number];

export function isPaymentMethodKind(
  value: unknown,
): value is PaymentMethodKind {
  return (
    typeof value === "string" &&
    (paymentMethodKindValues as readonly string[]).includes(value)
  );
}
