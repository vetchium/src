const L = require("../lib");
const fs = require("fs");
const results = {};

async function toast(page) {
	return (
		await page
			.locator(".ant-message-notice-content")
			.allTextContents()
			.catch(() => [])
	).join("|");
}

async function getHandle(email, persona) {
	const { ctx, page } = await L.launch(persona);
	try {
		await L.hubLogin(page, persona, email);
		await page.goto(L.HUB_URL + "/", { waitUntil: "networkidle" });
		await L.sleep(800);
		const h = await page.evaluate(() => {
			const m = document.body.innerText.match(/@([a-z0-9-]+)/i);
			return m ? m[1] : null;
		});
		return h;
	} finally {
		await ctx.close();
	}
}

(async () => {
	// 1) capture candidate handle (draco)
	const handle = await getHandle("draco@hub.example", "hub-draco");
	results.dracoHandle = handle;
	console.log("draco handle:", handle);

	// 2) gryffindor admin assigns Floo Network to opening #2
	{
		const { ctx, page } = await L.launch("org-admin");
		try {
			await L.orgLogin(
				page,
				"org-admin",
				"admin@gryffindor.example",
				"gryffindor.example"
			);
			await page.goto(L.ORG_URL + "/openings/2", { waitUntil: "networkidle" });
			await L.sleep(1200);
			await L.shot(page, "assign_opening2_detail");
			await page
				.getByRole("button", { name: /assign agency/i })
				.first()
				.click();
			await L.sleep(800);
			await L.shot(page, "assign_agency_modal");
			// AutoComplete: type domain then pick option
			const input = page.locator(".ant-modal input").first();
			await input.click();
			await input.fill("floo");
			await L.sleep(800);
			const opt = page
				.locator(
					`${".ant-select-dropdown:not(.ant-select-dropdown-hidden)"} .ant-select-item-option, .ant-select-item-option`
				)
				.first();
			if (await opt.count()) await opt.click();
			await L.sleep(400);
			await L.shot(page, "assign_agency_filled");
			await page
				.locator(
					".ant-modal-footer button.ant-btn-primary, .ant-modal button.ant-btn-primary"
				)
				.first()
				.click();
			await L.sleep(2000);
			results.assign = await toast(page);
			console.log("ASSIGN ->", results.assign);
			await L.shot(page, "assign_agency_result");
		} catch (e) {
			console.log("assign ERR", e.message.slice(0, 160));
			results.assign = "ERR " + e.message.slice(0, 150);
			await L.shot(page, "assign_ERR");
		} finally {
			await ctx.close();
		}
	}

	// 3) agency refers draco into the assigned opening
	{
		const { ctx, page } = await L.launch("agency-admin");
		try {
			await L.orgLogin(
				page,
				"agency-admin",
				"admin@floonetwork.example",
				"floonetwork.example"
			);
			await page.goto(L.ORG_URL + "/referrals", { waitUntil: "networkidle" });
			await L.sleep(1500);
			await L.shot(page, "agency_referrals_assigned");
			const txt = (await page.locator("body").innerText()).slice(0, 500);
			console.log("AGENCY REFERRALS:\n", txt);
			// Find a "Refer" action button in the assigned openings table
			const referBtn = page.getByRole("button", { name: /refer/i }).first();
			if (await referBtn.count()) {
				await referBtn.click();
				await L.sleep(800);
				await L.shot(page, "refer_modal");
				const hin = page.locator(".ant-modal input").first();
				await hin.fill(handle);
				const ta = page.locator(".ant-modal textarea").first();
				if (await ta.count())
					await ta.fill(
						"Strong candidate sourced and pre-screened by Floo Network Staffing."
					);
				await L.shot(page, "refer_filled");
				await page
					.locator(
						".ant-modal-footer button.ant-btn-primary, .ant-modal button.ant-btn-primary"
					)
					.first()
					.click();
				await L.sleep(2500);
				results.refer = await toast(page);
				console.log("REFER ->", results.refer);
				await L.shot(page, "refer_result");
			} else {
				console.log("no Refer button found on agency referrals page");
				results.refer = "no-refer-button";
			}
		} catch (e) {
			console.log("refer ERR", e.message.slice(0, 160));
			results.refer = "ERR " + e.message.slice(0, 150);
			await L.shot(page, "refer_ERR");
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/6b_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("6b_referral");
	console.log("RESULTS", JSON.stringify(results));
})();
