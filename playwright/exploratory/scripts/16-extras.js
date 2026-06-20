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
	// Opening lifecycle: pause then reopen opening #5 (no applicants)
	{
		const { ctx, page } = await L.launch("org-harry");
		try {
			await L.orgLogin(
				page,
				"org-harry",
				"harry@gryffindor.example",
				"gryffindor.example"
			);
			await page.goto(L.ORG_URL + "/openings/5", { waitUntil: "networkidle" });
			await L.sleep(900);
			await L.shot(page, "opening5_detail");
			// Pause
			const pause = page.getByRole("button", { name: /^pause$/i }).first();
			if (await pause.count()) {
				await pause.click();
				await L.sleep(800);
				const ok = page.locator(".ant-modal button.ant-btn-primary").first();
				if (await ok.count()) {
					await ok.click();
					await L.sleep(1500);
				}
				results.pause = await toast(page);
				await L.shot(page, "opening5_paused");
			}
			// Reopen
			await page.goto(L.ORG_URL + "/openings/5", { waitUntil: "networkidle" });
			await L.sleep(900);
			const reopen = page
				.getByRole("button", { name: /reopen|resume|re-open/i })
				.first();
			if (await reopen.count()) {
				await reopen.click();
				await L.sleep(800);
				const ok = page.locator(".ant-modal button.ant-btn-primary").first();
				if (await ok.count()) {
					await ok.click();
					await L.sleep(1500);
				}
				results.reopen = await toast(page);
				await L.shot(page, "opening5_reopened");
			}
			console.log("LIFECYCLE pause:", results.pause, "reopen:", results.reopen);
		} catch (e) {
			console.log("lifecycle ERR", e.message.slice(0, 150));
			await L.shot(page, "lifecycle_ERR");
		} finally {
			await ctx.close();
		}
	}

	// Hub profile edit (neville)
	{
		const { ctx, page } = await L.launch("hub-neville");
		try {
			await L.hubLogin(page, "hub-neville", "neville@hub.example");
			await page.goto(L.HUB_URL + "/settings/profile", {
				waitUntil: "networkidle",
			});
			await L.sleep(1200);
			await L.shot(page, "hub_profile_settings");
			const inputs = await page.evaluate(() => ({
				textareas: document.querySelectorAll("textarea").length,
				inputs: document.querySelectorAll("input").length,
				buttons: [...document.querySelectorAll("button")]
					.map((b) => b.textContent.trim())
					.filter(Boolean)
					.slice(0, 15),
			}));
			results.profileForm = inputs;
			console.log("PROFILE form:", JSON.stringify(inputs));
			// try editing the bio textarea + save
			const ta = page.locator("textarea").first();
			if (await ta.count()) {
				await ta.fill(
					"Herbology enthusiast and reliability engineer. Passionate about resilient systems."
				);
				const save = page.getByRole("button", { name: /save|update/i }).first();
				if (await save.count()) {
					await save.click();
					await L.sleep(2000);
				}
				results.profileSave = await toast(page);
				await L.shot(page, "hub_profile_saved");
				console.log("PROFILE save:", results.profileSave);
			}
		} catch (e) {
			console.log("profile ERR", e.message.slice(0, 150));
			await L.shot(page, "hub_profile_ERR");
		} finally {
			await ctx.close();
		}
	}

	// Logout test (org)
	{
		const { ctx, page } = await L.launch("logout-test");
		try {
			await L.orgLogin(
				page,
				"logout-test",
				"admin@hufflepuff.example",
				"hufflepuff.example"
			);
			await page.goto(L.ORG_URL + "/", { waitUntil: "networkidle" });
			await L.sleep(600);
			const lo = page
				.getByRole("button", { name: /logout|log out|sign out/i })
				.first();
			if (await lo.count()) {
				await lo.click();
				await L.sleep(1500);
				results.logoutUrl = page.url();
				await L.shot(page, "after_logout");
				// try accessing a protected page after logout
				await page.goto(L.ORG_URL + "/users", { waitUntil: "networkidle" });
				await L.sleep(800);
				results.afterLogoutProtected = page.url();
				await L.shot(page, "after_logout_protected");
				console.log(
					"LOGOUT url:",
					results.logoutUrl,
					"protected->",
					results.afterLogoutProtected
				);
			}
		} catch (e) {
			console.log("logout ERR", e.message.slice(0, 150));
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/7d_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("7d_extras");
	console.log("RESULTS", JSON.stringify(results));
})();
