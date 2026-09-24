import "../details.tsp";

namespace Vetchium.Problem;

const HubEmailChangeCodeRejectedError = #{
  type: "vetchium-problem-details/hub-email-change-code-rejected",
  title: "Email change code rejected",
  status: 400,
  detail: "The email change code could not be accepted",
};
alias HubEmailChangeCodeRejectedErrorResponse = Response<
  400,
  typeof HubEmailChangeCodeRejectedError
>;

const HubEmailAddressUnavailableError = #{
  type: "vetchium-problem-details/hub-email-address-unavailable",
  title: "Email address unavailable",
  status: 409,
  detail: "Another Hub account already uses that email address",
};
alias HubEmailAddressUnavailableErrorResponse = Response<
  409,
  typeof HubEmailAddressUnavailableError
>;
