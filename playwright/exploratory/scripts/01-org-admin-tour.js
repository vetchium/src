const L = require("../lib");

const PATHS = [
	["/", "dash"],
	["/users", "users"],
	["/suborgs", "suborgs"],
	["/domains", "domains"],
	["/cost-centers", "cost_centers"],
	["/settings/addresses", "addresses"],
	["/settings/plan", "plan"],
	["/settings/hiring", "hiring_settings"],
	["/audit-logs", "audit_logs"],
	["/openings", "openings"],
	["/candidacies", "candidacies"],
	["/my-interviews", "my_interviews"],
	["/marketplace", "marketplace_discover"],
	["/marketplace/listings", "mp_listings"],
	["/marketplace/subscriptions", "mp_subscriptions"],
	["/marketplace/clients", "mp_clients"],
	["/referrals", "referrals"],
	["/change-password", "change_password"],
	["/this-route-does-not-exist", "notfound_404"],
];

(async () => {
	const P = "org-admin";
	const { ctx, page } = await L.launch(P);
	try {
		await L.orgLogin(page, P, "admin@gryffindor.example", "gryffindor.example");
		console.log("login ok", page.url());
		for (const [path, label] of PATHS) {
			try {
				await page.goto(L.ORG_URL + path, {
					waitUntil: "networkidle",
					timeout: 20000,
				});
				await L.sleep(700);
				await L.shot(page, `orgadmin_${label}`);
				// capture visible page title text
				const h = await page
					.locator("h1,h2")
					.first()
					.textContent()
					.catch(() => "");
				console.log(`OK ${path} -> "${(h || "").trim().slice(0, 50)}"`);
			} catch (e) {
				console.log(`ERR ${path}: ${e.message.slice(0, 80)}`);
				L.logIssue(P, "nav-error", { path, err: e.message.slice(0, 200) });
				await L.shot(page, `orgadmin_${label}_ERR`);
			}
		}
	} catch (e) {
		console.log("FATAL", e.message);
	} finally {
		L.dumpIssues("2a_org_admin_tour");
		await ctx.close();
	}
	console.log("ISSUES", L.issues.length);
})();
