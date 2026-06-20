const L = require("../lib");

const PATHS = [
	["/", "agency_dash"],
	["/marketplace/listings", "agency_listings"],
	["/marketplace/clients", "agency_clients"],
	["/marketplace/subscriptions", "agency_subscriptions"],
	["/marketplace", "agency_discover"],
	["/referrals", "agency_referrals"],
	["/referrals/defaults", "agency_referrals_defaults"],
	["/candidacies", "agency_candidacies"],
	["/my-interviews", "agency_my_interviews"],
	["/users", "agency_users"],
	["/settings/plan", "agency_plan"],
];

(async () => {
	const P = "agency-admin";
	const { ctx, page } = await L.launch(P);
	try {
		await L.orgLogin(
			page,
			P,
			"admin@floonetwork.example",
			"floonetwork.example"
		);
		console.log("agency login ok", page.url());
		await L.shot(page, "agency_dashboard_full");
		for (const [path, label] of PATHS) {
			try {
				await page.goto(L.ORG_URL + path, {
					waitUntil: "networkidle",
					timeout: 20000,
				});
				await L.sleep(800);
				await L.shot(page, label);
				const h = await page
					.locator("h1,h2")
					.first()
					.textContent()
					.catch(() => "");
				console.log(`OK ${path} -> "${(h || "").trim().slice(0, 50)}"`);
			} catch (e) {
				console.log(`ERR ${path}: ${e.message.slice(0, 80)}`);
				await L.shot(page, label + "_ERR");
			}
		}
	} catch (e) {
		console.log("FATAL", e.message.slice(0, 150));
		await L.shot(page, "agency_FATAL");
	} finally {
		L.dumpIssues("6a_agency_explore");
		await ctx.close();
	}
	console.log("ISSUES", L.issues.length);
})();
