const L = require("../lib");
const DOMAIN = "gryffindor.example";
const fs = require("fs");

function futureStr(daysAhead, hour) {
	const d = new Date();
	d.setDate(d.getDate() + daysAhead);
	d.setHours(hour, 0, 0, 0);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00:00`;
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
		const cands = JSON.parse(
			fs.readFileSync(L.ISSUES + "/5b_results.json")
		).candidacyLinks;
		const candPath = cands[0]; // e.g. /candidacies/<uuid>
		const candId = candPath.split("/").pop();
		results.candId = candId;

		// Candidacy detail
		await page.goto(L.ORG_URL + candPath, { waitUntil: "networkidle" });
		await L.sleep(1200);
		await L.shot(page, "candidacy_detail");
		const btns = await page.evaluate(() =>
			[...document.querySelectorAll("button, a")]
				.map((b) => b.textContent.trim())
				.filter(Boolean)
		);
		console.log("candidacy buttons:", JSON.stringify([...new Set(btns)]));

		// Schedule interview
		await page.goto(L.ORG_URL + candPath + "/schedule-interview", {
			waitUntil: "networkidle",
		});
		await L.sleep(1000);
		await L.shot(page, "schedule_form_blank");

		// interview type (scope to the form to avoid the navbar language select)
		await L.pickSelectByIndex(page, page.locator("form"), 0, "Video");
		// start datetime (picker input 0)
		const pickers = page.locator(".ant-picker-input input");
		await pickers.nth(0).click();
		await pickers.nth(0).fill(futureStr(3, 10));
		await page.keyboard.press("Enter");
		await L.sleep(600);
		// end datetime (picker input 1) — may be auto-set; set explicitly anyway
		await pickers.nth(1).click();
		await pickers.nth(1).fill(futureStr(3, 11));
		await page.keyboard.press("Enter");
		await L.sleep(400);
		// location + description
		const loc = page.getByLabel(/location/i).first();
		if (await loc.count()) await loc.fill("Google Meet link TBD");
		// interviewer tags: type email + Enter
		const tagSel = page
			.locator(".ant-select-multiple input, .ant-select input")
			.last();
		await tagSel.click();
		await page.keyboard.type("interviewer2@gryffindor.example");
		await page.keyboard.press("Enter");
		await L.sleep(400);
		await L.shot(page, "schedule_form_filled");
		await page.getByRole("button", { name: /^schedule$/i }).click();
		await L.sleep(2500);
		results.scheduleToast = await toast(page);
		results.afterUrl = page.url();
		console.log("SCHEDULE ->", results.scheduleToast, results.afterUrl);
		await L.shot(page, "schedule_result");

		// Re-open candidacy to see the interview
		await page.goto(L.ORG_URL + candPath, { waitUntil: "networkidle" });
		await L.sleep(1200);
		await L.shot(page, "candidacy_after_schedule");
		const itxt = await page.locator("body").innerText();
		const m = itxt.match(/interview/gi);
		console.log("candidacy mentions 'interview':", m ? m.length : 0);
	} catch (e) {
		console.log("ERR", e.message.slice(0, 220));
		await L.shot(page, "schedule_ERR");
	} finally {
		fs.writeFileSync(
			L.ISSUES + "/5c_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("5c_schedule");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
