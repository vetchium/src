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
(async () => {
	const { ctx, page } = await L.launch("org-slytherin");
	try {
		await L.orgLogin(
			page,
			"org-slytherin",
			"admin@slytherin.example",
			"slytherin.example"
		);
		await page.goto(L.ORG_URL + "/marketplace", { waitUntil: "networkidle" });
		await L.sleep(1500);
		await L.shot(page, "slytherin_discover");
		// click the listing card
		const card = page
			.locator(".ant-card, [class*=card]")
			.filter({ hasText: /Floo Network/i })
			.first();
		if (await card.count()) {
			await card.click();
			await L.sleep(1500);
		} else {
			await page
				.getByText(/Floo Network/i)
				.first()
				.click();
			await L.sleep(1500);
		}
		await L.shot(page, "slytherin_listing_detail");
		console.log("LISTING URL:", page.url());
		const btns = await page.evaluate(() =>
			[...document.querySelectorAll("button")]
				.map((b) => b.textContent.trim())
				.filter(Boolean)
		);
		console.log("listing buttons:", JSON.stringify([...new Set(btns)]));
		const sub = page
			.getByRole("button", { name: /subscribe|request/i })
			.first();
		if (await sub.count()) {
			await sub.click();
			await L.sleep(800);
			await L.shot(page, "slytherin_subscribe_modal");
			const ta = page.locator(".ant-modal textarea").first();
			if (await ta.count())
				await ta.fill(
					"Slytherin would like to engage Floo Network for upcoming hires."
				);
			const ok = page.locator(".ant-modal button.ant-btn-primary").first();
			if (await ok.count()) {
				await ok.click();
				await L.sleep(2500);
			}
			results.subscribe = await toast(page);
			console.log("SUBSCRIBE ->", results.subscribe);
			await L.shot(page, "slytherin_subscribe_result");
		} else {
			results.subscribe = "no-subscribe-button";
		}
		// verify on My Subscriptions
		await page.goto(L.ORG_URL + "/marketplace/subscriptions", {
			waitUntil: "networkidle",
		});
		await L.sleep(1200);
		await L.shot(page, "slytherin_my_subscriptions");
		results.subsText = (await page.locator("body").innerText()).slice(0, 300);
	} catch (e) {
		console.log("ERR", e.message.slice(0, 200));
		results.subscribe = "ERR " + e.message.slice(0, 150);
		await L.shot(page, "slytherin_ERR");
	} finally {
		fs.writeFileSync(
			L.ISSUES + "/6e_results.json",
			JSON.stringify(results, null, 2)
		);
		L.dumpIssues("6e_subscribe");
		await ctx.close();
	}
	console.log("RESULTS", JSON.stringify(results));
})();
