const L = require("../lib");
const DOMAIN = "gryffindor.example";

async function toast(page) {
	const t = await page
		.locator(".ant-message-notice-content")
		.allTextContents()
		.catch(() => []);
	return t.join("|");
}

(async () => {
	const P = "org-harry";
	const { ctx, page } = await L.launch(P);
	const results = {};
	try {
		await L.orgLogin(page, P, "harry@gryffindor.example", DOMAIN);

		// Go to opening 1 applications, capture openingId + per-candidate view links
		await page.goto(L.ORG_URL + "/openings/1", { waitUntil: "networkidle" });
		await L.sleep(800);
		await page.getByRole("button", { name: /view applications/i }).click();
		await page.waitForFunction(
			() => /\/applications$/.test(location.pathname),
			null,
			{ timeout: 10000 }
		);
		await L.sleep(1000);
		const map = await page.evaluate(() => {
			const rows = [...document.querySelectorAll("tr")];
			const out = {};
			for (const r of rows) {
				const nameA = r.querySelector("td a");
				const viewA = [...r.querySelectorAll("a")].find((a) =>
					/applications\/[0-9a-f-]{36}/.test(a.getAttribute("href") || "")
				);
				if (nameA && viewA)
					out[nameA.textContent.trim()] = viewA.getAttribute("href");
			}
			return out;
		});
		console.log("candidate->link:", JSON.stringify(map, null, 0));
		results.candidates = Object.keys(map);

		async function openApp(name) {
			await page.goto(L.ORG_URL + map[name], { waitUntil: "networkidle" });
			await L.sleep(900);
		}

		// Shortlist Harry Potter
		if (map["Harry Potter"]) {
			await openApp("Harry Potter");
			await L.shot(page, "app_harry_detail");
			await page.getByRole("button", { name: /^shortlist$/i }).click();
			await L.sleep(2000);
			results.shortlistHarry = await toast(page);
			await L.shot(page, "app_harry_shortlisted");
		}
		// Shortlist Hermione Granger
		if (map["Hermione Granger"]) {
			await openApp("Hermione Granger");
			await page.getByRole("button", { name: /^shortlist$/i }).click();
			await L.sleep(2000);
			results.shortlistHermione = await toast(page);
		}
		// Reject Ron Weasley
		if (map["Ron Weasley"]) {
			await openApp("Ron Weasley");
			await page.getByRole("button", { name: /^reject$/i }).click();
			await L.sleep(1500);
			// confirm if modal
			const ok = page
				.locator(
					".ant-modal button.ant-btn-primary, .ant-modal button.ant-btn-dangerous"
				)
				.first();
			if (await ok.count()) {
				await ok.click();
				await L.sleep(1500);
			}
			results.rejectRon = await toast(page);
			await L.shot(page, "app_ron_rejected");
		}
		// Label Cho Chang (click first non-None label button)
		if (map["Cho Chang"]) {
			await openApp("Cho Chang");
			const labelBtns = page.locator(".ant-card button.ant-btn-sm");
			const cnt = await labelBtns.count();
			if (cnt > 1) {
				await labelBtns.nth(1).click();
				await L.sleep(1500);
			}
			results.labelCho = await toast(page);
			await L.shot(page, "app_cho_labeled");
		}

		// Candidacies list
		await page.goto(L.ORG_URL + "/candidacies", { waitUntil: "networkidle" });
		await L.sleep(1200);
		await L.shot(page, "candidacies_list");
		const candTxt = (await page.locator("body").innerText()).slice(0, 600);
		console.log("CANDIDACIES:\n", candTxt);
		const candLinks = await page.evaluate(() =>
			[...document.querySelectorAll('a[href*="/candidacies/"]')].map((a) =>
				a.getAttribute("href")
			)
		);
		console.log("candidacy links:", JSON.stringify([...new Set(candLinks)]));
		results.candidacyLinks = [...new Set(candLinks)];
	} catch (e) {
		console.log("ERR", e.message.slice(0, 200));
		await L.shot(page, "review_ERR");
	} finally {
		require("fs").writeFileSync(
			L.ISSUES + "/5b_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("5b_review");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
