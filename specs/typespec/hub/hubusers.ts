export type EmailAddress = string;
export type Password = string;

export interface HubLoginRequest {
	email_address: EmailAddress;
	password: Password;
}

export interface HubLoginResponse {
	token: string;
}
