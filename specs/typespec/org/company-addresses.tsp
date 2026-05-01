import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model CreateAddressRequest {
  title: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  map_urls?: string[];
}

model UpdateAddressRequest {
  address_id: string;
  title: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  map_urls?: string[];
}

model DisableAddressRequest { address_id: string; }
model EnableAddressRequest  { address_id: string; }
model GetAddressRequest     { address_id: string; }

model ListAddressesRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model OrgAddress {
  address_id:    string;
  title:         string;
  address_line1: string;
  address_line2?: string;
  city:          string;
  state?:        string;
  postal_code?:  string;
  country:       string;
  map_urls:      string[];
  status:        string;
  created_at:    string;
}

model ListAddressesResponse {
  addresses:           OrgAddress[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgAddresses {
  @route("/create-address")  @post createAddress (...CreateAddressRequest) : OrgAddress | BadRequestResponse;
  @route("/update-address")  @post updateAddress (...UpdateAddressRequest) : OrgAddress | BadRequestResponse | NotFoundResponse;
  @route("/disable-address") @post disableAddress(...DisableAddressRequest): OrgAddress | NotFoundResponse | UnprocessableEntityResponse;
  @route("/enable-address")  @post enableAddress (...EnableAddressRequest) : OrgAddress | NotFoundResponse | UnprocessableEntityResponse;
  @route("/get-address")     @post getAddress    (...GetAddressRequest)    : OrgAddress | NotFoundResponse;
  @route("/list-addresses")  @post listAddresses (...ListAddressesRequest) : ListAddressesResponse | BadRequestResponse;
}
