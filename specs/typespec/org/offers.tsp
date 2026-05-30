import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

// Multipart endpoint — the offer letter is uploaded with the request (max 10MB PDF).
@multipartBody
model ExtendOfferRequest {
  candidacy_id:       HttpPart<string>;
  offer_letter:       HttpPart<File>;
  salary_currency?:   HttpPart<string>;
  salary_amount?:     HttpPart<decimal>;
  start_date?:        HttpPart<plainDate>;
  notes?:             HttpPart<string>;
}

@route("/org/extend-offer") @post extendOffer(...ExtendOfferRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
