const L = require("../lib");
const fs = require("fs");

(async () => {
	const P = "hub-hermione";
	const { ctx, page } = await L.launch(P);
	const results = {};
	try {
		await L.hubLogin(page, P, "hermione@hub.example");
		await page.goto(L.HUB_URL + "/my-candidacies", {
			waitUntil: "networkidle",
		});
		await L.sleep(1200);
		await L.shot(page, "hub_my_candidacies");
		const txt = (await page.locator("body").innerText()).slice(0, 400);
		console.log("MY CANDIDACIES:\n", txt);
		const link = await page.evaluate(
			() =>
				[...document.querySelectorAll('a[href*="/my-candidacies/"]')].map((a) =>
					a.getAttribute("href")
				)[0] || null
		);
		console.log("candidacy link:", link);
		if (link) {
			await page.goto(L.HUB_URL + link, { waitUntil: "networkidle" });
			await L.sleep(1500);
			await L.shot(page, "hub_candidacy_detail");
			const body = await page.locator("body").innerText();
			results.hasOffer = /offer/i.test(body);
			results.buttons = await page.evaluate(() =>
				[...document.querySelectorAll("button")]
					.map((b) => b.textContent.trim())
					.filter(Boolean)
			);
			console.log("BUTTONS:", JSON.stringify(results.buttons));
			console.log("offer section present:", results.hasOffer);
		}
	} catch (e) {
		console.log("ERR", e.message.slice(0, 200));
		await L.shot(page, "hub_offer_ERR");
	} finally {
		fs.writeFileSync(
			L.ISSUES + "/5f_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("5f_hub_offer");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
