import { type ValidationError, newValidationError } from "../common/common";

const ADDRESS_TITLE_MAX = 100;
const ADDRESS_LINE1_MAX = 200;
const ADDRESS_LINE2_MAX = 200;
const ADDRESS_CITY_MAX = 100;
const ADDRESS_STATE_MAX = 100;
const ADDRESS_POSTAL_CODE_MAX = 20;
const ADDRESS_COUNTRY_MAX = 100;
const ADDRESS_MAP_URL_MAX = 500;
const ADDRESS_MAP_URLS_MAX_ENTRIES = 5;

export const ERR_ADDRESS_TITLE_REQUIRED = "title is required";
export const ERR_ADDRESS_TITLE_TOO_LONG =
	"title must be at most 100 characters";
export const ERR_ADDRESS_LINE1_REQUIRED = "address_line1 is required";
export const ERR_ADDRESS_LINE1_TOO_LONG =
	"address_line1 must be at most 200 characters";
export const ERR_ADDRESS_LINE2_TOO_LONG =
	"address_line2 must be at most 200 characters";
export const ERR_ADDRESS_CITY_REQUIRED = "city is required";
export const ERR_ADDRESS_CITY_TOO_LONG = "city must be at most 100 characters";
export const ERR_ADDRESS_STATE_TOO_LONG =
	"state must be at most 100 characters";
export const ERR_ADDRESS_POSTAL_CODE_TOO_LONG =
	"postal_code must be at most 20 characters";
export const ERR_ADDRESS_COUNTRY_REQUIRED = "country is required";
export const ERR_ADDRESS_COUNTRY_TOO_LONG =
	"country must be at most 100 characters";
export const ERR_ADDRESS_MAP_URLS_TOO_MANY =
	"map_urls must have at most 5 entries";
export const ERR_ADDRESS_MAP_URL_TOO_LONG =
	"each map_url must be at most 500 characters";
export const ERR_ADDRESS_ID_REQUIRED = "address_id is required";
export const ERR_ADDRESS_STATUS_INVALID =
	"filter_status must be 'active' or 'disabled'";

export type OrgAddressStatus = "active" | "disabled";
export const OrgAddressStatusActive: OrgAddressStatus = "active";
export const OrgAddressStatusDisabled: OrgAddressStatus = "disabled";

export interface OrgAddress {
	address_id: string;
	title: string;
	address_line1: string;
	address_line2?: string;
	city: string;
	state?: string;
	postal_code?: string;
	country: string;
	map_urls: string[];
	status: OrgAddressStatus;
	created_at: string;
}

export interface CreateAddressRequest {
	title: string;
	address_line1: string;
	address_line2?: string;
	city: string;
	state?: string;
	postal_code?: string;
	country: string;
	map_urls?: string[];
}

export function validateCreateAddressRequest(
	r: CreateAddressRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!r.title)
		errs.push(newValidationError("title", ERR_ADDRESS_TITLE_REQUIRED));
	else if (r.title.length > ADDRESS_TITLE_MAX)
		errs.push(newValidationError("title", ERR_ADDRESS_TITLE_TOO_LONG));
	if (!r.address_line1)
		errs.push(newValidationError("address_line1", ERR_ADDRESS_LINE1_REQUIRED));
	else if (r.address_line1.length > ADDRESS_LINE1_MAX)
		errs.push(newValidationError("address_line1", ERR_ADDRESS_LINE1_TOO_LONG));
	if (
		r.address_line2 !== undefined &&
		r.address_line2.length > ADDRESS_LINE2_MAX
	)
		errs.push(newValidationError("address_line2", ERR_ADDRESS_LINE2_TOO_LONG));
	if (!r.city) errs.push(newValidationError("city", ERR_ADDRESS_CITY_REQUIRED));
	else if (r.city.length > ADDRESS_CITY_MAX)
		errs.push(newValidationError("city", ERR_ADDRESS_CITY_TOO_LONG));
	if (r.state !== undefined && r.state.length > ADDRESS_STATE_MAX)
		errs.push(newValidationError("state", ERR_ADDRESS_STATE_TOO_LONG));
	if (
		r.postal_code !== undefined &&
		r.postal_code.length > ADDRESS_POSTAL_CODE_MAX
	)
		errs.push(
			newValidationError("postal_code", ERR_ADDRESS_POSTAL_CODE_TOO_LONG)
		);
	if (!r.country)
		errs.push(newValidationError("country", ERR_ADDRESS_COUNTRY_REQUIRED));
	else if (r.country.length > ADDRESS_COUNTRY_MAX)
		errs.push(newValidationError("country", ERR_ADDRESS_COUNTRY_TOO_LONG));
	if (r.map_urls !== undefined) {
		if (r.map_urls.length > ADDRESS_MAP_URLS_MAX_ENTRIES)
			errs.push(newValidationError("map_urls", ERR_ADDRESS_MAP_URLS_TOO_MANY));
		else
			for (const url of r.map_urls) {
				if (url.length > ADDRESS_MAP_URL_MAX) {
					errs.push(
						newValidationError("map_urls", ERR_ADDRESS_MAP_URL_TOO_LONG)
					);
					break;
				}
			}
	}
	return errs;
}

export interface UpdateAddressRequest {
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

export function validateUpdateAddressRequest(
	r: UpdateAddressRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!r.address_id)
		errs.push(newValidationError("address_id", ERR_ADDRESS_ID_REQUIRED));
	if (!r.title)
		errs.push(newValidationError("title", ERR_ADDRESS_TITLE_REQUIRED));
	else if (r.title.length > ADDRESS_TITLE_MAX)
		errs.push(newValidationError("title", ERR_ADDRESS_TITLE_TOO_LONG));
	if (!r.address_line1)
		errs.push(newValidationError("address_line1", ERR_ADDRESS_LINE1_REQUIRED));
	else if (r.address_line1.length > ADDRESS_LINE1_MAX)
		errs.push(newValidationError("address_line1", ERR_ADDRESS_LINE1_TOO_LONG));
	if (
		r.address_line2 !== undefined &&
		r.address_line2.length > ADDRESS_LINE2_MAX
	)
		errs.push(newValidationError("address_line2", ERR_ADDRESS_LINE2_TOO_LONG));
	if (!r.city) errs.push(newValidationError("city", ERR_ADDRESS_CITY_REQUIRED));
	else if (r.city.length > ADDRESS_CITY_MAX)
		errs.push(newValidationError("city", ERR_ADDRESS_CITY_TOO_LONG));
	if (r.state !== undefined && r.state.length > ADDRESS_STATE_MAX)
		errs.push(newValidationError("state", ERR_ADDRESS_STATE_TOO_LONG));
	if (
		r.postal_code !== undefined &&
		r.postal_code.length > ADDRESS_POSTAL_CODE_MAX
	)
		errs.push(
			newValidationError("postal_code", ERR_ADDRESS_POSTAL_CODE_TOO_LONG)
		);
	if (!r.country)
		errs.push(newValidationError("country", ERR_ADDRESS_COUNTRY_REQUIRED));
	else if (r.country.length > ADDRESS_COUNTRY_MAX)
		errs.push(newValidationError("country", ERR_ADDRESS_COUNTRY_TOO_LONG));
	if (r.map_urls !== undefined) {
		if (r.map_urls.length > ADDRESS_MAP_URLS_MAX_ENTRIES)
			errs.push(newValidationError("map_urls", ERR_ADDRESS_MAP_URLS_TOO_MANY));
		else
			for (const url of r.map_urls) {
				if (url.length > ADDRESS_MAP_URL_MAX) {
					errs.push(
						newValidationError("map_urls", ERR_ADDRESS_MAP_URL_TOO_LONG)
					);
					break;
				}
			}
	}
	return errs;
}

export interface DisableAddressRequest {
	address_id: string;
}
export function validateDisableAddressRequest(
	r: DisableAddressRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!r.address_id)
		errs.push(newValidationError("address_id", ERR_ADDRESS_ID_REQUIRED));
	return errs;
}

export interface EnableAddressRequest {
	address_id: string;
}
export function validateEnableAddressRequest(
	r: EnableAddressRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!r.address_id)
		errs.push(newValidationError("address_id", ERR_ADDRESS_ID_REQUIRED));
	return errs;
}

export interface GetAddressRequest {
	address_id: string;
}
export function validateGetAddressRequest(
	r: GetAddressRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (!r.address_id)
		errs.push(newValidationError("address_id", ERR_ADDRESS_ID_REQUIRED));
	return errs;
}

export interface ListAddressesRequest {
	filter_status?: OrgAddressStatus;
	pagination_key?: string;
	limit?: number;
}

export function validateListAddressesRequest(
	r: ListAddressesRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	if (
		r.filter_status !== undefined &&
		r.filter_status !== OrgAddressStatusActive &&
		r.filter_status !== OrgAddressStatusDisabled
	) {
		errs.push(newValidationError("filter_status", ERR_ADDRESS_STATUS_INVALID));
	}
	return errs;
}

export interface ListAddressesResponse {
	addresses: OrgAddress[];
	next_pagination_key?: string;
}
