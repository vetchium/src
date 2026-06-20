// Shared harness for the Vetchium exploratory (manual-style) UI test run.
//
// This is intentionally SEPARATE from the Playwright `npm test` suite under
// playwright/tests/. It drives the real UI through headless Chromium, one
// isolated browser profile per persona, against the docker-compose-full.json
// stack with its `seed-users` Harry-Potter dataset. See README.md.
//
// Run scripts from the playwright/ directory so `require("playwright")` resolves:
//   cd playwright && node exploratory/scripts/00-smoke.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ORG_URL = process.env.ORG_URL || "http://localhost:3002";
const HUB_URL = process.env.HUB_URL || "http://localhost:3000";
const MAILPIT =
	(process.env.MAILPIT_URL || "http://localhost:8025") + "/api/v1";
const PASSWORD = process.env.SEED_PASSWORD || "Password123$";

// All run artefacts (screenshots, profiles, per-phase result JSON) go here.
// Override with EXPLORE_OUT to keep runs separate. Git-ignored by default.
const ROOT = process.env.EXPLORE_OUT || path.join(__dirname, "output");
const SHOTS = path.join(ROOT, "shots");
const PROFILES = path.join(ROOT, "profiles");
const ISSUES = path.join(ROOT, "issues");
const FIXTURES = path.join(__dirname, "fixtures");
for (const d of [SHOTS, PROFILES, ISSUES]) fs.mkdirSync(d, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- mailpit ----------------
async function mailpitSearch(toEmail) {
	const q = encodeURIComponent(`to:${toEmail}`);
	const res = await fetch(`${MAILPIT}/search?query=${q}`);
	if (!res.ok) return [];
	const data = await res.json();
	return data.messages ?? [];
}
async function mailpitText(id) {
	const res = await fetch(`${MAILPIT}/message/${id}`);
	if (!res.ok) throw new Error(`mailpit fetch ${id} failed`);
	const data = await res.json();
	return data.Text || "";
}
async function clearEmails(email) {
	const msgs = await mailpitSearch(email);
	if (msgs.length) {
		await fetch(`${MAILPIT}/messages`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ IDs: msgs.map((m) => m.ID) }),
		});
	}
}
// Poll mailpit until a 6-digit TFA code arrives for `email`.
async function waitTfaCode(email, sinceMs, tries = 20, delay = 1500) {
	for (let i = 0; i < tries; i++) {
		const msgs = await mailpitSearch(email);
		for (const m of msgs) {
			const text = await mailpitText(m.ID);
			const code = text.match(/\b(\d{6})\b/);
			if (code) return code[1];
		}
		await sleep(delay);
	}
	throw new Error(`No TFA code for ${email}`);
}
async function waitEmail(
	email,
	predicate = () => true,
	tries = 20,
	delay = 1500
) {
	for (let i = 0; i < tries; i++) {
		const msgs = await mailpitSearch(email);
		for (const m of msgs) {
			const text = await mailpitText(m.ID);
			if (predicate(text)) return text;
		}
		await sleep(delay);
	}
	throw new Error(`No matching email for ${email}`);
}

// ---------------- persona / browser ----------------
// Per-process issue collector: console errors, page errors, 4xx/5xx responses.
const issues = [];
function logIssue(persona, kind, detail) {
	issues.push({ persona, kind, detail, ts: new Date().toISOString() });
}

async function launch(persona) {
	// Each persona gets its own persistent profile dir so cookies / cache / tokens
	// never bleed between personas.
	const userDataDir = path.join(PROFILES, persona);
	const ctx = await chromium.launchPersistentContext(userDataDir, {
		headless: process.env.HEADED !== "1",
		viewport: { width: 1440, height: 900 },
		ignoreHTTPSErrors: true,
	});
	const page = ctx.pages()[0] || (await ctx.newPage());
	attachListeners(page, persona);
	ctx.on("page", (p) => attachListeners(p, persona));
	return { ctx, page };
}

function attachListeners(page, persona) {
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			logIssue(persona, "console.error", {
				url: page.url(),
				text: msg.text().slice(0, 500),
			});
		}
	});
	page.on("pageerror", (err) => {
		logIssue(persona, "pageerror", {
			url: page.url(),
			text: String(err).slice(0, 500),
		});
	});
	page.on("response", (resp) => {
		const s = resp.status();
		const u = resp.url();
		if (
			s >= 400 &&
			/\/(org|hub|admin|public)\//.test(u) &&
			!/\.(png|jpg|svg|ico|woff2?)/.test(u)
		) {
			logIssue(persona, "http>=400", {
				status: s,
				method: resp.request().method(),
				url: u.replace("http://localhost:8080", ""),
			});
		}
	});
}

let shotCounter = 0;
async function shot(page, label) {
	shotCounter++;
	const n = String(shotCounter).padStart(3, "0");
	const safe = label.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
	const file = path.join(SHOTS, `${n}_${safe}.png`);
	try {
		await page.screenshot({ path: file, fullPage: true });
	} catch (e) {
		try {
			await page.screenshot({ path: file });
		} catch (_) {}
	}
	return file;
}

// ---------------- logins ----------------
async function alreadyLoggedIn(page, baseUrl) {
	// Navigate to /login; if a session exists the app redirects away from /login.
	await page.goto(baseUrl + "/login", { waitUntil: "networkidle" });
	await sleep(600);
	const onLogin = await page
		.getByPlaceholder(/password/i)
		.first()
		.isVisible()
		.catch(() => false);
	return !onLogin;
}

async function orgLogin(page, persona, email, domain) {
	if (await alreadyLoggedIn(page, ORG_URL)) {
		await page.goto(ORG_URL + "/", { waitUntil: "networkidle" });
		return;
	}
	const since = Date.now();
	await clearEmails(email);
	await page.goto(ORG_URL + "/login", { waitUntil: "networkidle" });
	await page
		.getByPlaceholder(/domain/i)
		.first()
		.fill(domain);
	await page.getByPlaceholder(/email/i).first().fill(email);
	await page
		.getByPlaceholder(/password/i)
		.first()
		.fill(PASSWORD);
	await page
		.getByRole("button", { name: /log ?in|sign ?in/i })
		.first()
		.click();
	await page
		.getByPlaceholder(/code/i)
		.first()
		.waitFor({ state: "visible", timeout: 15000 });
	const code = await waitTfaCode(email, since);
	await page.getByPlaceholder(/code/i).first().fill(code);
	await page
		.getByRole("button", { name: /verify|submit|continue|log ?in/i })
		.first()
		.click();
	await page.waitForFunction(
		() => !/\/login|\/tfa/.test(location.pathname),
		null,
		{ timeout: 20000 }
	);
	await sleep(800);
}

async function hubLogin(page, persona, email) {
	if (await alreadyLoggedIn(page, HUB_URL)) {
		await page.goto(HUB_URL + "/", { waitUntil: "networkidle" });
		return;
	}
	const since = Date.now();
	await clearEmails(email);
	await page.goto(HUB_URL + "/login", { waitUntil: "networkidle" });
	await page.getByPlaceholder(/email/i).first().fill(email);
	await page
		.getByPlaceholder(/password/i)
		.first()
		.fill(PASSWORD);
	await page
		.getByRole("button", { name: /log ?in|sign ?in/i })
		.first()
		.click();
	await page
		.getByPlaceholder(/code/i)
		.first()
		.waitFor({ state: "visible", timeout: 15000 });
	const code = await waitTfaCode(email, since);
	await page.getByPlaceholder(/code/i).first().fill(code);
	await page
		.getByRole("button", { name: /verify|submit|continue|log ?in/i })
		.first()
		.click();
	await page.waitForFunction(
		() => !/\/login|\/tfa/.test(location.pathname),
		null,
		{ timeout: 20000 }
	);
	await sleep(800);
}

// ---------------- AntD v6 Select helpers ----------------
// In AntD v6 the clickable element is the `.ant-select` wrapper (NOT a
// `.ant-select-selector` child), the placeholder lives in `.ant-select-placeholder`,
// and long option lists are virtualised. These helpers open the select, type into
// its own search input to defeat virtualisation, and fall back to wheel-scrolling.
const DROP = ".ant-select-dropdown:not(.ant-select-dropdown-hidden)";

async function chooseOption(page, sel, title) {
	const optSel = `${DROP} .ant-select-item-option[title="${title}"]`;
	const input = sel.locator("input").first();
	if (await input.count()) {
		const frag = title.includes(":") ? title.split(":")[1] : title;
		try {
			await input.pressSequentially(frag, { delay: 20 });
			await sleep(500);
		} catch (_) {}
	}
	if (await page.locator(optSel).count()) {
		await page.locator(optSel).first().click();
		if (await input.count()) {
			const val = await input.inputValue().catch(() => "");
			for (let i = 0; i < (val ? val.length : 0); i++)
				await page.keyboard.press("Backspace");
		}
		return;
	}
	await page
		.locator(DROP)
		.first()
		.hover()
		.catch(() => {});
	for (let i = 0; i < 25; i++) {
		if (await page.locator(optSel).count()) {
			await page.locator(optSel).first().click();
			return;
		}
		await page.mouse.wheel(0, 250);
		await sleep(120);
	}
	throw new Error("option not found: " + title);
}

// Pick option(s) from a select identified by its placeholder text within `scope`.
async function pickSelect(page, scope, placeholder, values, multi = false) {
	const root = scope || page;
	const sel = root
		.locator(".ant-select")
		.filter({
			has: page.locator(`.ant-select-placeholder:has-text("${placeholder}")`),
		})
		.first();
	await sel.click();
	await sleep(400);
	for (const v of values) {
		await chooseOption(page, sel, v);
		await sleep(250);
	}
	if (multi) await page.keyboard.press("Escape");
}

// Pick an option from the Nth select within `scope` (0-based). Note: the navbar
// language switcher is a `.ant-select` too — scope to a form/dialog to skip it.
async function pickSelectByIndex(page, scope, index, title) {
	const root = scope || page;
	const sel = root.locator(".ant-select").nth(index);
	await sel.click();
	await sleep(400);
	if (title) await chooseOption(page, sel, title);
	else await page.locator(`${DROP} .ant-select-item-option`).first().click();
	await sleep(250);
}

// ---------------- result chaining + issue dump ----------------
// Phases hand ids (candidacy ids, handles, …) to later phases via small JSON files.
function writeResult(name, obj) {
	fs.writeFileSync(
		path.join(ISSUES, `${name}.json`),
		JSON.stringify(obj, null, 2)
	);
}
function readResult(name) {
	return JSON.parse(fs.readFileSync(path.join(ISSUES, `${name}.json`), "utf8"));
}
function dumpIssues(tag) {
	const file = path.join(ISSUES, `${tag}.issues.json`);
	fs.writeFileSync(file, JSON.stringify(issues, null, 2));
	return file;
}

module.exports = {
	ORG_URL,
	HUB_URL,
	MAILPIT,
	PASSWORD,
	FIXTURES,
	ISSUES,
	SHOTS,
	sleep,
	launch,
	shot,
	orgLogin,
	hubLogin,
	alreadyLoggedIn,
	clearEmails,
	waitTfaCode,
	waitEmail,
	mailpitSearch,
	mailpitText,
	logIssue,
	issues,
	dumpIssues,
	writeResult,
	readResult,
	pickSelect,
	pickSelectByIndex,
};
