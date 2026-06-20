const L = require("../lib");
const DOMAIN = "gryffindor.example";

async function readToast(page) {
	const t = await page
		.locator(".ant-message-notice-content, .ant-notification-notice-message")
		.allTextContents()
		.catch(() => []);
	return t.join(" | ");
}

(async () => {
	const P = "org-admin-writes";
	const { ctx, page } = await L.launch(P);
	const results = {};
	try {
		await L.orgLogin(page, P, "admin@gryffindor.example", DOMAIN);

		// Invite Tech Interviewer
		try {
			await L.clearEmails("interviewer2@gryffindor.example");
			await page.goto(L.ORG_URL + "/users", { waitUntil: "networkidle" });
			await page
				.getByRole("button", { name: /invite user/i })
				.first()
				.click();
			const dlg = page.getByRole("dialog");
			await dlg.waitFor({ state: "visible", timeout: 8000 });
			await L.sleep(500);
			await dlg
				.getByPlaceholder(/user@example|email/i)
				.first()
				.fill("interviewer2@gryffindor.example");
			await L.pickSelect(
				page,
				dlg,
				"Select roles to assign",
				["org:view_candidacies", "org:view_applications"],
				true
			);
			await L.shot(page, "C_invite_filled");
			await dlg.getByRole("button", { name: /^invite user$/i }).click();
			await L.sleep(2500);
			results.invite = await readToast(page);
			console.log("INVITE ->", results.invite);
			await L.shot(page, "C_invite_result");
		} catch (e) {
			console.log("invite ERR", e.message.slice(0, 160));
			results.invite = "ERR " + e.message.slice(0, 150);
			await L.shot(page, "C_invite_ERR");
		}

		// Complete interviewer setup
		try {
			const text = await L.waitEmail("interviewer2@gryffindor.example", (t) =>
				/token=[A-Z0-9]+-[a-f0-9]{64}/.test(t)
			);
			const token = text.match(/token=([A-Z0-9]+-[a-f0-9]{64})/)[1];
			const s = await L.launch("setup-interviewer");
			try {
				await s.page.goto(L.ORG_URL + "/complete-setup?token=" + token, {
					waitUntil: "networkidle",
				});
				await L.sleep(800);
				await L.shot(s.page, "C_setup_form");
				const nameI = s.page.getByPlaceholder(/name/i).first();
				if (await nameI.count()) await nameI.fill("Minerva McGonagall");
				const pwds = s.page.locator('input[type="password"]');
				const n = await pwds.count();
				for (let i = 0; i < n; i++) await pwds.nth(i).fill(L.PASSWORD);
				await s.page
					.getByRole("button", {
						name: /activate|complete|finish|submit|continue/i,
					})
					.first()
					.click();
				await L.sleep(2500);
				await L.shot(s.page, "C_setup_done");
				results.setup = s.page.url();
				console.log("SETUP ->", s.page.url());
			} finally {
				await s.ctx.close();
			}
		} catch (e) {
			console.log("setup ERR", e.message.slice(0, 160));
			results.setup = "ERR " + e.message.slice(0, 150);
		}

		// Grant harry candidacy roles via drawer
		try {
			await page.goto(L.ORG_URL + "/users", { waitUntil: "networkidle" });
			await L.sleep(700);
			await page
				.locator("tr", { hasText: "harry@gryffindor.example" })
				.first()
				.getByText(/view details/i)
				.click();
			const drawer = page.locator(".ant-drawer").last();
			await drawer.waitFor({ state: "visible", timeout: 8000 });
			await L.sleep(600);
			for (const r of ["org:view_candidacies", "org:manage_candidacies"]) {
				await L.pickSelectByIndex(page, drawer, 0, r);
				await drawer.getByRole("button", { name: /assign/i }).click();
				await L.sleep(1500);
			}
			await L.shot(page, "C_harry_roles_after");
			results.harryRoles = "ok";
			console.log("HARRY ROLES ok");
		} catch (e) {
			console.log("harry ERR", e.message.slice(0, 160));
			results.harryRoles = "ERR " + e.message.slice(0, 150);
			await L.shot(page, "C_harry_roles_ERR");
		}
	} finally {
		require("fs").writeFileSync(
			L.ISSUES + "/2c_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("2c");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
