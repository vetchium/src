import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
	getHubUserGlobalId,
	getHubUserProfilePictureKey,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	HubLoginRequest,
	HubTFARequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

// Minimal valid 200×200 PNG (meets the handler's dimension floor).
const VALID_PNG_200 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAAiklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwYNWXAAG9rB+hAAAAAElFTkSuQmCC",
	"base64"
);

async function getHubSessionToken(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	await deleteEmailsFor(email);
	const loginResponse = await api.login({
		email_address: email,
		password,
	} as HubLoginRequest);
	expect(loginResponse.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResponse = await api.verifyTFA({
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	} as HubTFARequest);
	expect(tfaResponse.status).toBe(200);
	return tfaResponse.body.session_token;
}

async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<void> {
	await api.requestSignup({ email_address: email } as RequestSignupRequest);
	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);
	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Picture Test User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

test.describe("POST /hub/upload-profile-picture — plan gating", () => {
	test("free user upload is forbidden (403) and stores nothing", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `pic-free-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const token = await getHubSessionToken(api, email, TEST_PASSWORD);
			const globalId = (await getHubUserGlobalId(email))!;

			const res = await api.uploadProfilePicture(
				token,
				VALID_PNG_200,
				"pic.png",
				"image/png"
			);
			expect(res.status).toBe(403);
			expect(await getHubUserProfilePictureKey(globalId)).toBeNull();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});

test.describe("Profile picture downgrade rule (Spec 17 §9.4)", () => {
	test.describe.configure({ mode: "serial" });

	let adminEmail: string;
	let domain: string;
	let email: string;
	let token: string;
	let handle: string;
	let globalId: string;

	test.beforeAll(async ({ request }) => {
		const api = new HubAPIClient(request);
		adminEmail = generateTestEmail("admin");
		domain = generateTestDomainName();
		email = `pic-dg-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		await createHubUserViaSignup(api, email, TEST_PASSWORD);
		token = await getHubSessionToken(api, email, TEST_PASSWORD);
		globalId = (await getHubUserGlobalId(email))!;
		const info = await api.getMyInfo(token);
		handle = info.body.handle;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(email);
		await permanentlyDeleteTestApprovedDomain(domain);
		await deleteTestAdminUser(adminEmail);
	});

	test("pro user can upload a picture (200, stored)", async ({ request }) => {
		const api = new HubAPIClient(request);
		const up = await api.switchPlan(token, { plan_id: "pro" });
		expect(up.status).toBe(200);

		const res = await api.uploadProfilePicture(
			token,
			VALID_PNG_200,
			"pic.png",
			"image/png"
		);
		expect(res.status).toBe(200);
		expect(res.body.has_profile_picture).toBe(true);
		expect(await getHubUserProfilePictureKey(globalId)).not.toBeNull();

		// Visible via the streaming endpoint while Pro.
		const bytes = await api.getProfilePictureBytes(token, handle);
		expect(bytes.status).toBe(200);
	});

	test("pro → free suppresses the picture on every read path", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const down = await api.switchPlan(token, { plan_id: "free" });
		expect(down.status).toBe(200);

		// Owner view (get-my-profile) suppresses.
		const own = await api.getMyProfile(token);
		expect(own.status).toBe(200);
		expect(own.body.has_profile_picture).toBe(false);

		// Public/peer view suppresses the URL.
		const pub = await api.getProfile(token, { handle });
		expect(pub.status).toBe(200);
		expect(pub.body.profile_picture_url ?? null).toBeNull();

		// Streaming endpoint returns 404 (as if none set).
		const bytes = await api.getProfilePictureBytes(token, handle);
		expect(bytes.status).toBe(404);

		// The stored key is RETAINED (non-destructive downgrade).
		expect(await getHubUserProfilePictureKey(globalId)).not.toBeNull();
	});

	test("free → pro restores visibility from the retained key", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const up = await api.switchPlan(token, { plan_id: "pro" });
		expect(up.status).toBe(200);

		const own = await api.getMyProfile(token);
		expect(own.body.has_profile_picture).toBe(true);

		const bytes = await api.getProfilePictureBytes(token, handle);
		expect(bytes.status).toBe(200);
	});

	test("remove-profile-picture is allowed on free and deletes the key", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		// Downgrade to free, then permanently remove the leftover image.
		const down = await api.switchPlan(token, { plan_id: "free" });
		expect(down.status).toBe(200);

		const rem = await api.removeProfilePicture(token);
		expect(rem.status).toBe(200);
		expect(await getHubUserProfilePictureKey(globalId)).toBeNull();
	});
});
