const L = require("../lib");
const fs = require("fs");
const results = {};

// Switch the navbar language select to the option at the given index.
async function switchLang(page, index) {
	await page.locator(".ant-select").first().click();
	await L.sleep(500);
	const opts = page.locator(
		".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"
	);
	await opts.nth(index).click();
	await L.sleep(1200);
}

// Heuristic: detect raw i18n keys leaking into the UI (e.g. "dashboard.title",
// "users.inviteModal.confirm"), which indicates a missing translation.
async function findRawKeys(page) {
	return page.evaluate(() => {
		const txt = document.body.innerText;
		const matches = txt.match(/\b[a-z]+(?:\.[a-zA-Z]+){1,4}\b/g) || [];
		// filter out domains/emails/urls and obvious non-keys
		return [...new Set(matches)]
			.filter(
				(m) =>
					!/\.(com|example|org|net|io|md)$/.test(m) &&
					!m.includes("@") &&
					/[a-z][A-Z]|\.[a-z]/.test(m)
			)
			.slice(0, 25);
	});
}

(async () => {
	// ORG portal i18n
	{
		const { ctx, page } = await L.launch("org-admin");
		try {
			await L.orgLogin(
				page,
				"org-admin",
				"admin@gryffindor.example",
				"gryffindor.example"
			);
			await page.goto(L.ORG_URL + "/", { waitUntil: "networkidle" });
			await L.sleep(800);
			for (const [idx, name] of [
				[1, "de"],
				[2, "ta"],
			]) {
				await switchLang(page, idx);
				await L.shot(page, `org_dash_lang_${name}`);
				results[`org_${name}_title`] = await page
					.locator("h1,h2")
					.first()
					.textContent()
					.catch(() => "");
				results[`org_${name}_rawKeys`] = await findRawKeys(page);
				console.log(
					`ORG lang ${name}: title="${results[`org_${name}_title`]}" rawKeys=${JSON.stringify(results[`org_${name}_rawKeys`])}`
				);
			}
			// visit a form page in non-English (users) to catch missing keys
			await page.goto(L.ORG_URL + "/users", { waitUntil: "networkidle" });
			await L.sleep(1000);
			await L.shot(page, "org_users_lang_ta");
			results.org_users_ta_rawKeys = await findRawKeys(page);
			console.log(
				"ORG users(ta) rawKeys:",
				JSON.stringify(results.org_users_ta_rawKeys)
			);
		} catch (e) {
			console.log("org i18n ERR", e.message.slice(0, 150));
		} finally {
			await ctx.close();
		}
	}

	// HUB portal i18n
	{
		const { ctx, page } = await L.launch("hub-harry");
		try {
			await L.hubLogin(page, "hub-harry", "harry@hub.example");
			await page.goto(L.HUB_URL + "/", { waitUntil: "networkidle" });
			await L.sleep(800);
			for (const [idx, name] of [
				[1, "de"],
				[2, "ta"],
			]) {
				await switchLang(page, idx);
				await L.shot(page, `hub_dash_lang_${name}`);
				results[`hub_${name}_rawKeys`] = await findRawKeys(page);
				console.log(
					`HUB lang ${name}: rawKeys=${JSON.stringify(results[`hub_${name}_rawKeys`])}`
				);
			}
		} catch (e) {
			console.log("hub i18n ERR", e.message.slice(0, 150));
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/7a_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("7a_i18n");
	console.log("DONE");
})();
