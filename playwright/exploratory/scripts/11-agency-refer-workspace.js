const L = require("../lib");
const fs = require("fs");
const results = {};
// Candidate handle captured in phase 10 (the hub user the agency refers).
const HANDLE = L.readResult("6b_results").dracoHandle;

async function toast(page) {
	return (
		await page
			.locator(".ant-message-notice-content")
			.allTextContents()
			.catch(() => [])
	).join("|");
}

(async () => {
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
		// Click "Open" to enter the per-opening workspace
		const openLink = page.getByRole("button", { name: /^open$/i }).first();
		const openA = page.locator('a:has-text("Open")').first();
		if (await openLink.count()) await openLink.click();
		else if (await openA.count()) await openA.click();
		await L.sleep(1500);
		await L.shot(page, "agency_opening_workspace");
		console.log("WORKSPACE URL:", page.url());
		const btns = await page.evaluate(() =>
			[...document.querySelectorAll("button")]
				.map((b) => b.textContent.trim())
				.filter(Boolean)
		);
		console.log("workspace buttons:", JSON.stringify([...new Set(btns)]));

		const refer = page
			.getByRole("button", { name: /refer candidate/i })
			.first();
		if (await refer.count()) {
			await refer.click();
			await L.sleep(800);
			await L.shot(page, "agency_refer_modal");
			await page.locator(".ant-modal input").first().fill(HANDLE);
			const ta = page.locator(".ant-modal textarea").first();
			if (await ta.count())
				await ta.fill(
					"Pre-screened by Floo Network Staffing; strong distributed-systems background."
				);
			await L.shot(page, "agency_refer_filled");
			await page.locator(".ant-modal button.ant-btn-primary").first().click();
			await L.sleep(2500);
			results.refer = await toast(page);
			console.log("REFER ->", results.refer);
			await L.shot(page, "agency_refer_result");
		} else {
			results.refer = "no-refer-button";
			console.log("no refer button in workspace");
		}
	} catch (e) {
		console.log("ERR", e.message.slice(0, 200));
		await L.shot(page, "agency_refer_ERR");
	} finally {
		await ctx.close();
	}

	// Verify on consumer side: opening #2 applications shows the referred candidate
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
			await L.shot(page, "opening2_applications_after_referral");
			const txt = await page.locator("body").innerText();
			results.opening2HasAgencySource = /agenc|floo/i.test(txt);
			results.opening2Apps = txt.match(/Direct|Agency|agenc/gi) || [];
			console.log("opening2 applications text snippet:\n", txt.slice(0, 500));
		} catch (e) {
			console.log("verify ERR", e.message.slice(0, 150));
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/6c_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("6c_refer");
	console.log("RESULTS", JSON.stringify(results));
})();
