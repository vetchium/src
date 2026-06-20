const L = require("../lib");
const DOMAIN = "gryffindor.example";
const fs = require("fs");
const OFFER = L.FIXTURES + "/offer.md";
// First candidacy created in phase 04 (the shortlisted candidate to extend an offer to).
const CAND = L.readResult("5b_results").candidacyLinks[0].split("/").pop();

function futureDateStr(daysAhead) {
	const d = new Date();
	d.setDate(d.getDate() + daysAhead);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function toast(page) {
	return (
		await page
			.locator(".ant-message-notice-content")
			.allTextContents()
			.catch(() => [])
	).join("|");
}

(async () => {
	const P = "org-harry";
	const { ctx, page } = await L.launch(P);
	const results = {};
	try {
		await L.orgLogin(page, P, "harry@gryffindor.example", DOMAIN);

		// First, complete the interview from the candidacy detail (org side) if there's a complete action
		await page.goto(L.ORG_URL + `/candidacies/${CAND}`, {
			waitUntil: "networkidle",
		});
		await L.sleep(1000);
		await L.shot(page, "candidacy_before_offer");

		// Extend offer
		await page.goto(L.ORG_URL + `/candidacies/${CAND}/extend-offer`, {
			waitUntil: "networkidle",
		});
		await L.sleep(1000);
		await L.shot(page, "extend_offer_form");
		await page.locator('input[type="file"]').first().setInputFiles(OFFER);
		await L.sleep(500);
		// start date
		const picker = page.locator(".ant-picker-input input").first();
		if (await picker.count()) {
			await picker.click();
			await picker.fill(futureDateStr(30));
			await page.keyboard.press("Enter");
		}
		const notes = page.locator("form textarea").first();
		if (await notes.count())
			await notes.fill(
				"Excited to have you join us. Please review the attached offer letter."
			);
		await L.shot(page, "extend_offer_filled");
		await page
			.getByRole("button", { name: /extend offer|submit|send offer/i })
			.first()
			.click();
		await L.sleep(2500);
		results.offerToast = await toast(page);
		results.afterUrl = page.url();
		console.log("OFFER ->", results.offerToast, results.afterUrl);

		await page.goto(L.ORG_URL + `/candidacies/${CAND}`, {
			waitUntil: "networkidle",
		});
		await L.sleep(1200);
		await L.shot(page, "candidacy_after_offer");
		const t = await page.locator("body").innerText();
		results.stateMentions = (t.match(/offer/gi) || []).length;
		console.log("candidacy 'offer' mentions:", results.stateMentions);
	} catch (e) {
		console.log("ERR", e.message.slice(0, 220));
		await L.shot(page, "offer_ERR");
	} finally {
		fs.writeFileSync(
			L.ISSUES + "/5e_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("5e_offer");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
