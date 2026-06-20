const L = require("../lib");
const RESUME = L.FIXTURES + "/resume.md";

// hub user -> [opening numbers to apply to]
const APPLICANTS = [
	{ email: "harry@hub.example", persona: "hub-harry", openings: [1] },
	{ email: "hermione@hub.example", persona: "hub-hermione", openings: [1] },
	{ email: "ron@hub.example", persona: "hub-ron", openings: [1] },
	{ email: "cho@hub.example", persona: "hub-cho", openings: [1] },
	{ email: "neville@hub.example", persona: "hub-neville", openings: [4] },
	{ email: "luna@hub.example", persona: "hub-luna", openings: [3] },
];

function coverLetter(name, n) {
	return (
		`Dear Gryffindor Hiring Team,\n\nMy name is ${name} and I am excited to apply for opening #${n}. ` +
		`I bring strong experience in distributed systems, reliability, and platform engineering, ` +
		`and I am confident I can contribute meaningfully to your team. I have attached my resume ` +
		`for your review and would welcome the opportunity to discuss my fit further. Thank you for your consideration.`
	);
}

async function applyOne(page, persona, email, n) {
	const url = `${L.HUB_URL}/org/gryffindor.example/openings/${n}/apply`;
	await page.goto(url, { waitUntil: "networkidle" });
	await L.sleep(800);
	const name = persona.replace("hub-", "");
	await page.locator("textarea").first().fill(coverLetter(name, n));
	await page.locator('input[type="file"]').first().setInputFiles(RESUME);
	await L.sleep(600);
	await L.shot(page, `apply_${persona}_op${n}_filled`);
	await page.getByRole("button", { name: /submit application/i }).click();
	await L.sleep(2500);
	const toast = await page
		.locator(".ant-message-notice-content")
		.allTextContents()
		.catch(() => []);
	const url2 = page.url();
	await L.shot(page, `apply_${persona}_op${n}_result`);
	console.log(
		`  ${persona} -> op${n}: url=${url2.replace(L.HUB_URL, "")} toast=${toast.join("|")}`
	);
	return { url: url2, toast: toast.join("|") };
}

(async () => {
	const results = {};
	for (const a of APPLICANTS) {
		const { ctx, page } = await L.launch(a.persona);
		try {
			await L.hubLogin(page, a.persona, a.email);
			for (const n of a.openings) {
				try {
					results[`${a.persona}_${n}`] = await applyOne(
						page,
						a.persona,
						a.email,
						n
					);
				} catch (e) {
					console.log(`  ${a.persona} op${n} ERR ${e.message.slice(0, 120)}`);
					results[`${a.persona}_${n}`] = { err: e.message.slice(0, 150) };
					await L.shot(page, `apply_${a.persona}_op${n}_ERR`);
				}
			}
			// my-applications view
			await page.goto(L.HUB_URL + "/my-applications", {
				waitUntil: "networkidle",
			});
			await L.sleep(1000);
			await L.shot(page, `myapps_${a.persona}`);
		} catch (e) {
			console.log(`${a.persona} FATAL ${e.message.slice(0, 120)}`);
		} finally {
			await ctx.close();
		}
	}
	require("fs").writeFileSync(
		L.ISSUES + "/4b_results.json",
		JSON.stringify(results, null, 2)
	);
	L.dumpIssues("4b_hub_apply");
	console.log("ISSUES", L.issues.length);
})();
