import assert from "node:assert/strict";
import test from "node:test";
import { dateTimeFormat, dateTimeLocale } from "./date-time.ts";

const moment = "2026-10-13T10:15:30Z";

test("a browser locale of the portal language sets the conventions", () => {
  assert.equal(dateTimeLocale("en-US", ["en-GB", "de-DE"]), "en-GB");
  assert.equal(dateTimeLocale("en-US", ["fr-FR", "en-IN"]), "en-IN");
  assert.equal(dateTimeLocale("de-DE", ["en-GB", "de-AT"]), "de-AT");
  assert.equal(dateTimeLocale("ta", ["ta-LK"]), "ta-LK");
});

test("another language or an unparsable tag keeps the portal language", () => {
  assert.equal(dateTimeLocale("de-DE", ["en-GB"]), "de-DE");
  assert.equal(dateTimeLocale("en-US", ["invalid tag", "fr-FR"]), "en-US");
  assert.equal(dateTimeLocale("en-US", []), "en-US");
});

test("moments show the viewer's time zone; dates do not", () => {
  const british = dateTimeFormat("en-US", ["en-GB"], "Asia/Kolkata");
  assert.equal(british.dateTime(moment), "13 Oct 2026, 15:45 GMT+5:30");
  assert.equal(
    british.preciseDateTime(new Date(moment)),
    "13 Oct 2026, 15:45:30 GMT+5:30",
  );
  assert.equal(british.time(moment), "15:45 GMT+5:30");
  assert.equal(british.date(moment), "13 Oct 2026");
  assert.equal(british.date(moment, "long"), "13 October 2026");

  const american = dateTimeFormat("en-US", ["en-US"], "America/Los_Angeles");
  assert.match(american.dateTime(moment), /^Oct 13, 2026, 3:15\sAM PDT$/);

  const german = dateTimeFormat("de-DE", ["en-GB"], "Europe/Berlin");
  assert.equal(german.dateTime(moment), "13. Okt. 2026, 12:15 MESZ");
});

test("the calendar date follows the viewer's time zone", () => {
  const late = "2026-10-13T20:00:00Z";
  assert.equal(
    dateTimeFormat("en-US", ["en-GB"], "Asia/Tokyo").date(late),
    "14 Oct 2026",
  );
});
