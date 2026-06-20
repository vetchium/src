const L = require("../lib");
const fs = require("fs");
const results = {};

(async () => {
	// ---- RBAC: ron (read-only view_openings/view_applications) ----
	{
		const { ctx, page } = await L.launch("org-ron");
		try {
			await L.orgLogin(
				page,
				"org-ron",
				"ron@gryffindor.example",
				"gryffindor.example"
			);
			// open opening 1 applications -> first application detail
			await page.goto(L.ORG_URL + "/openings/1", { waitUntil: "networkidle" });
			await L.sleep(800);
			const va = page.getByRole("button", { name: /view applications/i });
			if (await va.count()) {
				await va.click();
				await L.sleep(1200);
			}
			await L.shot(page, "ron_applications_list");
			// open first application
			const viewLink = page.locator('a[href*="/applications/"]').first();
			if (await viewLink.count()) {
				await viewLink.click();
				await L.sleep(1200);
			}
			await L.shot(page, "ron_application_detail");
			const btns = await page.evaluate(() =>
				[...document.querySelectorAll("button")]
					.map((b) => b.textContent.trim())
					.filter(Boolean)
			);
			results.ron_appDetailButtons = [...new Set(btns)];
			results.ron_hasShortlist = btns.some((b) => /shortlist/i.test(b));
			results.ron_hasReject = btns.some((b) => /^reject$/i.test(b));
			console.log(
				"RON app detail buttons:",
				JSON.stringify(results.ron_appDetailButtons)
			);
			console.log(
				"RON hasShortlist:",
				results.ron_hasShortlist,
				"hasReject:",
				results.ron_hasReject
			);

			// ron navigates to /users (no view_users role)
			await page.goto(L.ORG_URL + "/users", { waitUntil: "networkidle" });
			await L.sleep(1200);
			await L.shot(page, "ron_users_noaccess");
			results.ron_usersBody = (await page.locator("body").innerText()).slice(
				0,
				200
			);
			console.log(
				"RON /users body:",
				results.ron_usersBody.replace(/\n/g, " ").slice(0, 150)
			);

			// direct API call as ron via page.request (carries cookies)
			try {
				const resp = await page.request.post(
					L.ORG_URL.replace("3002", "8080") + "/org/shortlist-application",
					{
						headers: { "Content-Type": "application/json" },
						data: { application_id: "00000000-0000-0000-0000-000000000000" },
						failOnStatusCode: false,
					}
				);
				results.ron_shortlistApiStatus = resp.status();
				console.log(
					"RON shortlist API status (no auth header):",
					resp.status()
				);
			} catch (e) {
				console.log("ron api err", e.message.slice(0, 80));
			}
		} catch (e) {
			console.log("ron ERR", e.message.slice(0, 160));
			await L.shot(page, "ron_ERR");
		} finally {
			await ctx.close();
		}
	}

	// ---- Validation: org login bad credentials ----
	{
		const { ctx, page } = await L.launch("val-login");
		try {
			await page.goto(L.ORG_URL + "/login", { waitUntil: "networkidle" });
			await L.sleep(500);
			// invalid email format
			await page
				.getByPlaceholder(/domain/i)
				.first()
				.fill("gryffindor.example");
			await page.getByPlaceholder(/email/i).first().fill("not-an-email");
			await page
				.getByPlaceholder(/password/i)
				.first()
				.fill("x");
			await page.locator("body").click();
			await L.sleep(500);
			await L.shot(page, "val_login_invalid_format");
			results.loginInvalidFmt = (
				await page
					.locator(".ant-form-item-explain-error")
					.allTextContents()
					.catch(() => [])
			).join("|");
			// wrong credentials (valid format)
			await page
				.getByPlaceholder(/email/i)
				.first()
				.fill("admin@gryffindor.example");
			await page
				.getByPlaceholder(/password/i)
				.first()
				.fill("WrongPassword123$");
			await page
				.getByRole("button", { name: /log ?in|sign ?in/i })
				.first()
				.click();
			await L.sleep(2500);
			await L.shot(page, "val_login_wrong_creds");
			results.loginWrongCreds = (
				await page
					.locator(".ant-alert, .ant-message-notice-content")
					.allTextContents()
					.catch(() => [])
			).join("|");
			console.log(
				"LOGIN invalidFmt:",
				results.loginInvalidFmt,
				"| wrongCreds:",
				results.loginWrongCreds
			);
		} catch (e) {
			console.log("val login ERR", e.message.slice(0, 120));
		} finally {
			await ctx.close();
		}
	}

	// ---- Validation: create-opening empty submit (harry has manage_openings) ----
	{
		const { ctx, page } = await L.launch("org-harry");
		try {
			await L.orgLogin(
				page,
				"org-harry",
				"harry@gryffindor.example",
				"gryffindor.example"
			);
			await page.goto(L.ORG_URL + "/openings/new", {
				waitUntil: "networkidle",
			});
			await L.sleep(1000);
			await L.shot(page, "create_opening_blank");
			// try to submit immediately
			const submit = page
				.getByRole("button", { name: /create|submit|save/i })
				.first();
			if (await submit.count()) {
				await submit.click();
				await L.sleep(1000);
			}
			await L.shot(page, "create_opening_validation");
			results.createOpeningErrors = (
				await page
					.locator(".ant-form-item-explain-error")
					.allTextContents()
					.catch(() => [])
			).slice(0, 12);
			console.log(
				"CREATE OPENING errors:",
				JSON.stringify(results.createOpeningErrors)
			);
		} catch (e) {
			console.log("create opening ERR", e.message.slice(0, 120));
			await L.shot(page, "create_opening_ERR");
		} finally {
			await ctx.close();
		}
	}

	fs.writeFileSync(
		L.ISSUES + "/7b_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("7b_rbac_validation");
	console.log("RESULTS", JSON.stringify(results));
})();
