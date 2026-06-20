const L = require("../lib");
const DOMAIN = "gryffindor.example";
const fs = require("fs");

async function toast(page) {
	return (
		await page
			.locator(".ant-message-notice-content")
			.allTextContents()
			.catch(() => [])
	).join("|");
}

(async () => {
	const P = "org-interviewer";
	const { ctx, page } = await L.launch(P);
	const results = {};
	try {
		await L.orgLogin(page, P, "interviewer2@gryffindor.example", DOMAIN);
		console.log("interviewer login ok", page.url());

		await page.goto(L.ORG_URL + "/my-interviews", { waitUntil: "networkidle" });
		await L.sleep(1200);
		await L.shot(page, "interviewer_my_interviews");
		const txt = (await page.locator("body").innerText()).slice(0, 500);
		console.log("MY INTERVIEWS:\n", txt);
		const links = await page.evaluate(() =>
			[...document.querySelectorAll("a")]
				.map((a) => a.getAttribute("href"))
				.filter((h) => h && /feedback|candidac/.test(h))
		);
		console.log("links:", JSON.stringify([...new Set(links)]));

		// RSVP yes if button present
		const rsvpYes = page
			.getByRole("button", { name: /yes|attending|accept/i })
			.first();
		if (await rsvpYes.count()) {
			await rsvpYes.click();
			await L.sleep(1500);
			results.rsvp = await toast(page);
			console.log("RSVP ->", results.rsvp);
		}

		// Go to candidacy detail, then find the per-interview "View interview" link
		// which routes to /candidacies/:id/interviews/:interviewId/feedback.
		const candPath =
			links.find((h) => /candidac/.test(h)) ||
			L.readResult("5b_results").candidacyLinks[0];
		await page.goto(L.ORG_URL + candPath, { waitUntil: "networkidle" });
		await L.sleep(1200);
		const fb = await page.evaluate(
			() =>
				[...document.querySelectorAll("a")]
					.map((a) => a.getAttribute("href"))
					.find((h) => h && /\/feedback$/.test(h)) || null
		);
		console.log("feedback link:", fb);
		if (fb) {
			await page.goto(L.ORG_URL + fb, { waitUntil: "networkidle" });
			await L.sleep(1200);
			await L.shot(page, "interviewer_feedback_form");
			// decision: click a decision button (prefer one containing 'Yes')
			const decision = page
				.locator("form .ant-space button")
				.filter({ hasText: /yes/i })
				.first();
			if (await decision.count()) await decision.click();
			else await page.locator("form .ant-space button").first().click();
			await L.sleep(300);
			const tas = page.locator("form textarea");
			const n = await tas.count();
			const fills = [
				"Strong system design fundamentals; clear communication; solid distributed-systems knowledge.",
				"Limited hands-on with our specific observability stack.",
				"Overall a strong candidate; recommend moving forward to offer.",
				"Thank you for a great conversation — we enjoyed discussing consensus protocols.",
			];
			for (let i = 0; i < n && i < fills.length; i++)
				await tas.nth(i).fill(fills[i]);
			await L.shot(page, "interviewer_feedback_filled");
			await page.getByRole("button", { name: /submit feedback/i }).click();
			await L.sleep(2500);
			results.feedback = await toast(page);
			console.log("FEEDBACK ->", results.feedback);
			await L.shot(page, "interviewer_feedback_result");
			// mark complete if available
			const complete = page
				.getByRole("button", { name: /mark complete|complete interview/i })
				.first();
			if (await complete.count()) {
				await complete.click();
				await L.sleep(1500);
				const ok = page.locator(".ant-modal button.ant-btn-primary").first();
				if (await ok.count()) {
					await ok.click();
					await L.sleep(1500);
				}
				results.complete = await toast(page);
				console.log("COMPLETE ->", results.complete);
			}
		} else {
			console.log("no feedback link found");
		}
	} catch (e) {
		console.log("ERR", e.message.slice(0, 220));
		await L.shot(page, "interviewer_ERR");
	} finally {
		fs.writeFileSync(
			L.ISSUES + "/5d_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("5d_interviewer");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
