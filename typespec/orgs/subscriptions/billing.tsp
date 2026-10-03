import "@typespec/openapi";

namespace Vetchium.Orgs;

/** Whether the Org's latest charge was collected. */
enum OrgBillingState {
  Current: "current",
  PastDue: "past-due",
}

enum OrgInvoiceState {
  Paid: "paid",
  Open: "open",
  Void: "void",
}

enum OrgInvoiceReason {
  Upgrade: "upgrade",
  Renewal: "renewal",
}

/** Why an open invoice has not been paid. */
enum OrgInvoiceFailure {
  Declined: "declined",
  NoPaymentMethod: "no_payment_method",
}

/**
 * A simulated test card, as in a payment processor's test mode. There is no
 * real card data in any environment.
 */
enum OrgPaymentMethodKind {
  SimulatedSucceeds: "simulated-succeeds",
  SimulatedDeclines: "simulated-declines",
}
