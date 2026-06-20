// Phase 00 — smoke: log in one persona of each type (org admin, hub user, agency
// admin) and screenshot their dashboards. Confirms the stack + seed are up and the
// harness (mailpit TFA login, screenshots, error capture) works before the longer
// phases run.
const L = require("../lib");

(async () => {
	const cases = [
		[
			"smoke-org-admin",
			"org",
			"admin@gryffindor.example",
			"gryffindor.example",
		],
		[
			"smoke-agency-admin",
			"org",
			"admin@floonetwork.example",
			"floonetwork.example",
		],
		["smoke-hub-harry", "hub", "harry@hub.example", null],
	];
	for (const [persona, kind, email, domain] of cases) {
		const { ctx, page } = await L.launch(persona);
		try {
			if (kind === "org") await L.orgLogin(page, persona, email, domain);
			else await L.hubLogin(page, persona, email);
			await L.shot(page, persona + "_dashboard");
			console.log(`OK ${persona} -> ${page.url()}`);
		} catch (e) {
			console.log(`FAIL ${persona}: ${e.message.slice(0, 120)}`);
			await L.shot(page, persona + "_FAIL");
		} finally {
			await ctx.close();
		}
	}
	L.dumpIssues("00-smoke");
	console.log("issues:", L.issues.length);
})();
