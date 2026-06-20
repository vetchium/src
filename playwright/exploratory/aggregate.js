// Summarise console errors / page errors / 4xx-5xx responses captured across all
// phases. Reads every *.issues.json under output/issues/ and prints a de-duplicated,
// count-sorted table — the quickest way to spot systematic UI/back-end problems.
const fs = require("fs");
const path = require("path");

const ISSUES = process.env.EXPLORE_OUT
	? path.join(process.env.EXPLORE_OUT, "issues")
	: path.join(__dirname, "output", "issues");

const seen = new Map();
for (const f of fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES) : []) {
	if (!f.endsWith(".issues.json")) continue;
	let data;
	try {
		data = JSON.parse(fs.readFileSync(path.join(ISSUES, f), "utf8"));
	} catch {
		continue;
	}
	for (const i of data) {
		if (!i || !i.kind) continue;
		const d = i.detail || {};
		const url = (d.url || "")
			.replace(/https?:\/\/localhost:\d+/, "")
			.replace(/[0-9a-f-]{36}/g, "<id>");
		const text = String(d.text || "").slice(0, 90);
		const key = `${i.kind}\t${d.status || ""}\t${url.slice(0, 48)}\t${text}`;
		seen.set(key, (seen.get(key) || 0) + 1);
	}
}

const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
if (rows.length === 0) {
	console.log("No console/network issues captured.");
} else {
	console.log(`Captured ${rows.length} distinct console/network issues:\n`);
	for (const [key, n] of rows) {
		const [kind, status, url, text] = key.split("\t");
		console.log(
			`${String(n).padStart(3)}x  ${kind.padEnd(13)} ${String(status).padEnd(4)} ${url.padEnd(48)} ${text}`
		);
	}
}
