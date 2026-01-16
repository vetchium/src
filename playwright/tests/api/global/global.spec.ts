import { test, expect } from "@playwright/test";
import { GlobalAPIClient } from "../../../lib/global-api-client";

test.describe("POST /global/get-regions", () => {
	test("returns active regions", async ({ request }) => {
		const api = new GlobalAPIClient(request);

		const response = await api.getRegions();

		expect(response.status).toBe(200);
		expect(response.body.regions).toBeDefined();
		expect(Array.isArray(response.body.regions)).toBe(true);
		// At least 3 active regions (ind1, usa1, deu1)
		expect(response.body.regions.length).toBeGreaterThanOrEqual(3);
		// Verify structure
		response.body.regions.forEach((region: any) => {
			expect(region.region_code).toBeDefined();
			expect(region.region_name).toBeDefined();
		});
	});
});

test.describe("POST /global/get-supported-languages", () => {
	test("returns supported languages with default flag", async ({ request }) => {
		const api = new GlobalAPIClient(request);

		const response = await api.getSupportedLanguages();

		expect(response.status).toBe(200);
		expect(response.body.languages).toBeDefined();
		expect(Array.isArray(response.body.languages)).toBe(true);
		// At least 3 languages (en-US, de-DE, ta-IN)
		expect(response.body.languages.length).toBeGreaterThanOrEqual(3);

		// Verify one language is marked as default
		const defaultLangs = response.body.languages.filter(
			(lang: any) => lang.is_default
		);
		expect(defaultLangs.length).toBe(1);
		expect(defaultLangs[0].language_code).toBe("en-US");
	});
});
