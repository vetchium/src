const L = require("../lib");
const fs = require("fs");
const RESUME = L.FIXTURES + "/resume.md";
const results = {};

async function toast(page) {
	return (
		await page
			.locator(".ant-message-notice-content")
			.allTextContents()
			.catch(() => [])
	).join("|");
}

(async () => {
	// draco applies via the referral inbox
	{
		const { ctx, page } = await L.launch("hub-draco");
		try {
			await L.hubLogin(page, "hub-draco", "draco@hub.example");
			await page.goto(L.HUB_URL + "/referrals", { waitUntil: "networkidle" });
			await L.sleep(1500);
			await L.shot(page, "hub_draco_referral_inbox");
			const txt = (await page.locator("body").innerText()).slice(0, 500);
			console.log("DRACO INBOX:\n", txt);
			const applyBtn = page.getByRole("button", { name: /apply/i }).first();
			if (await applyBtn.count()) {
				await applyBtn.click();
				await L.sleep(1500);
				console.log("apply url:", page.url());
				results.applyUrl = page.url();
				await L.shot(page, "hub_draco_apply_via");
				await page
					.locator("textarea")
					.first()
					.fill(
						"Dear Gryffindor team, I am Draco Malfoy, referred by Floo Network Staffing for the Staff ML Engineer role. " +
							"I have deep experience building large-scale ranking and personalisation systems and would be thrilled to contribute. Thank you for considering my application."
					);
				await page.locator('input[type="file"]').first().setInputFiles(RESUME);
				await L.sleep(500);
				await page.getByRole("button", { name: /submit application/i }).click();
				await L.sleep(2500);
				results.applyToast = await toast(page);
				results.afterUrl = page.url();
				console.log(
					"APPLY VIA REFERRAL ->",
					results.applyToast,
					results.afterUrl
				);
				await L.shot(page, "hub_draco_apply_result");
			} else {
				results.applyToast = "no-apply-button";
				console.log("no apply button in referral inbox");
			}
		} catch (e) {
			console.log("draco ERR", e.message.slice(0, 160));
			results.applyToast = "ERR " + e.message.slice(0, 150);
			await L.shot(page, "draco_ERR");
		} finally {
			await ctx.close();
		}
	}

	// verify consumer side: opening #2 applications shows draco with Agency source
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
			await L.sleep(800);
			await page.getByRole("button", { name: /view applications/i }).click();
			await L.sleep(1500);
			await L.shot(page, "opening2_apps_with_agency");
			const txt = await page.locator("table, body").first().innerText();
			results.consumerView = txt.slice(0, 400);
			console.log("OPENING2 APPS:\n", txt.slice(0, 400));
		} catch (e) {
			console.log("verify ERR", e.message.slice(0, 150));
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/6d_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("6d_referral_apply");
	console.log("RESULTS", JSON.stringify(results));
})();
