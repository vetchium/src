import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

// Multipart endpoint — the offer letter (PDF or Markdown, ≤5MB) is uploaded with
// the request and is the source of truth for all terms (salary, equity, etc.).
@multipartBody
model ExtendOfferRequest {
  candidacy_id:       HttpPart<string>;
  offer_letter:       HttpPart<File>;
  start_date?:        HttpPart<plainDate>;
  notes?:             HttpPart<string>;
}

@route("/org/extend-offer") @post extendOffer(...ExtendOfferRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
