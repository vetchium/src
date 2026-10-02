import "../details.tsp";
import "../../orgs/subscriptions/plans.tsp";

namespace Vetchium.Problem;

const OrgPlanNotOfferedError = #{
  type: "vetchium-problem-details/org-plan-not-offered",
  title: "Org plan not offered",
  status: 403,
  detail: "This tenant does not offer that Org plan",
};
alias OrgPlanNotOfferedErrorResponse = Response<
  403,
  typeof OrgPlanNotOfferedError
>;

model OrgPlanRequiredDetails {
  type: "vetchium-problem-details/org-plan-required";
  title: "Org plan required";
  status: 403;
  detail: "This operation requires a higher Org plan";
  plan_oid: Vetchium.Orgs.OrgPlanOID;
  instance?: string;
}
alias OrgPlanRequiredErrorResponse = Response<403, OrgPlanRequiredDetails>;

const OrgBillingPastDueError = #{
  type: "vetchium-problem-details/org-billing-past-due",
  title: "Org billing past due",
  status: 409,
  detail: "The plan cannot be changed while an invoice is unpaid. Pay the open invoice first.",
};
alias OrgBillingPastDueErrorResponse = Response<
  409,
  typeof OrgBillingPastDueError
>;

const OrgPaymentMethodRequiredError = #{
  type: "vetchium-problem-details/org-payment-method-required",
  title: "Org payment method required",
  status: 409,
  detail: "Save a payment method before this charge",
};
alias OrgPaymentMethodRequiredErrorResponse = Response<
  409,
  typeof OrgPaymentMethodRequiredError
>;

const OrgPaymentDeclinedError = #{
  type: "vetchium-problem-details/org-payment-declined",
  title: "Org payment declined",
  status: 402,
  detail: "The saved payment method was declined. Nothing was changed.",
};
alias OrgPaymentDeclinedErrorResponse = Response<
  402,
  typeof OrgPaymentDeclinedError
>;

const OrgInvoiceNotOpenError = #{
  type: "vetchium-problem-details/org-invoice-not-open",
  title: "Org invoice not open",
  status: 409,
  detail: "The invoice is not open for payment",
};
alias OrgInvoiceNotOpenErrorResponse = Response<
  409,
  typeof OrgInvoiceNotOpenError
>;

model OrgUserLimitExceedsTargetDetails {
  type: "vetchium-problem-details/org-user-limit-exceeds-target";
  title: "Org users exceed the target limit";
  status: 409;
  detail: "The Org has more users than the requested configuration allows. Remove users or cancel invitations first.";

  /** The seat cap the request would put in force. */
  limit: int32;

  /** Active users plus unexpired invitations now. */
  seats_in_use: int32;

  instance?: string;
}
alias OrgUserLimitExceedsTargetErrorResponse = Response<
  409,
  OrgUserLimitExceedsTargetDetails
>;
