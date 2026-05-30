/**
 * Tests for hub apply preferences:
 * - POST /hub/get-apply-preferences
 * - POST /hub/set-notify-connections-on-apply
 * - POST /hub/set-allow-unsolicited-endorsements
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestHubUserDirect,
	deleteTestHubUser,
	generateTestEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Hub Apply Preferences", () => {
	// Each test gets its own hub user so preferences don't bleed between tests
	// (preferences are per-user and mutable)

	test("get-apply-preferences: returns defaults (both false)", async ({
		request,
	}) => {
		const email = generateTestEmail("prefs-default");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "prefdef");
		try {
			const hubClient = new HubAPIClient(request);
			const res = await hubClient.getApplyPreferences(hub.sessionToken);
			expect(res.status).toBe(200);
			expect(res.body!.notify_connections_on_apply).toBe(false);
			expect(res.body!.allow_unsolicited_endorsements).toBe(false);
		} finally {
			await deleteTestHubUser(email).catch(() => {});
		}
	});

	test("set-notify-connections-on-apply: true persists on read-back, other field unchanged", async ({
		request,
	}) => {
		const email = generateTestEmail("prefs-notify");
		const hub = await createTestHubUserDirect(
			email,
			TEST_PASSWORD,
			"prefnotify"
		);
		try {
			const hubClient = new HubAPIClient(request);

			const setRes = await hubClient.setNotifyConnectionsOnApply(
				hub.sessionToken,
				{ notify_connections_on_apply: true }
			);
			expect(setRes.status).toBe(200);

			const getRes = await hubClient.getApplyPreferences(hub.sessionToken);
			expect(getRes.body!.notify_connections_on_apply).toBe(true);
			// Other field stays false
			expect(getRes.body!.allow_unsolicited_endorsements).toBe(false);

			// Audit log written
			const auditRes = await hubClient.listAuditLogs(hub.sessionToken, {
				event_types: ["hub.set_notify_connections_on_apply"],
			});
			expect(auditRes.status).toBe(200);
			const entry = auditRes.body!.audit_logs.find(
				(e: { event_type: string }) =>
					e.event_type === "hub.set_notify_connections_on_apply"
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestHubUser(email).catch(() => {});
		}
	});

	test("set-notify-connections-on-apply: false also persists", async ({
		request,
	}) => {
		const email = generateTestEmail("prefs-notify-false");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "prefnf");
		try {
			const hubClient = new HubAPIClient(request);

			// Set to true first
			await hubClient.setNotifyConnectionsOnApply(hub.sessionToken, {
				notify_connections_on_apply: true,
			});

			// Set back to false
			const setRes = await hubClient.setNotifyConnectionsOnApply(
				hub.sessionToken,
				{ notify_connections_on_apply: false }
			);
			expect(setRes.status).toBe(200);

			const getRes = await hubClient.getApplyPreferences(hub.sessionToken);
			expect(getRes.body!.notify_connections_on_apply).toBe(false);
		} finally {
			await deleteTestHubUser(email).catch(() => {});
		}
	});

	test("set-allow-unsolicited-endorsements: true persists, other field unchanged", async ({
		request,
	}) => {
		const email = generateTestEmail("prefs-unsol");
		const hub = await createTestHubUserDirect(
			email,
			TEST_PASSWORD,
			"prefunsol"
		);
		try {
			const hubClient = new HubAPIClient(request);

			const setRes = await hubClient.setAllowUnsolicitedEndorsements(
				hub.sessionToken,
				{ allow_unsolicited_endorsements: true }
			);
			expect(setRes.status).toBe(200);

			const getRes = await hubClient.getApplyPreferences(hub.sessionToken);
			expect(getRes.body!.allow_unsolicited_endorsements).toBe(true);
			// Other field stays false
			expect(getRes.body!.notify_connections_on_apply).toBe(false);

			// Audit log
			const auditRes = await hubClient.listAuditLogs(hub.sessionToken, {
				event_types: ["hub.set_allow_unsolicited_endorsements"],
			});
			const entry = auditRes.body!.audit_logs.find(
				(e: { event_type: string }) =>
					e.event_type === "hub.set_allow_unsolicited_endorsements"
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestHubUser(email).catch(() => {});
		}
	});

	test("set-notify: 400 when notify_connections_on_apply is missing", async ({
		request,
	}) => {
		const email = generateTestEmail("prefs-bad");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "prefbad");
		try {
			const hubClient = new HubAPIClient(request);
			const res = await hubClient.setNotifyConnectionsOnApply(
				hub.sessionToken,
				{
					notify_connections_on_apply: "not-a-boolean" as unknown as boolean,
				}
			);
			expect(res.status).toBe(400);
		} finally {
			await deleteTestHubUser(email).catch(() => {});
		}
	});

	test("get-apply-preferences: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/get-apply-preferences", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("set-notify-connections-on-apply: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/set-notify-connections-on-apply", {
			data: { notify_connections_on_apply: true },
		});
		expect(res.status()).toBe(401);
	});

	test("set-allow-unsolicited-endorsements: 401 when unauthenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/set-allow-unsolicited-endorsements", {
			data: { allow_unsolicited_endorsements: true },
		});
		expect(res.status()).toBe(401);
	});
});
