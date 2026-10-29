import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationStatusValues,
  effectiveListMyApplicationsLimit,
  isApplicationStatus,
  isPendingActionKind,
  myInterviewStateValues,
  normalizeApplicationReference,
  normalizeApplyToOpeningRequest,
  normalizeRequestInterviewRescheduleRequest,
  pendingActionKindValues,
  validateAcceptInterviewRequest,
  validateApplicationReference,
  validateApplyToOpeningRequest,
  validateBackgroundCheckConsentRequest,
  validateListMyApplicationsRequest,
  validateRequestInterviewRescheduleRequest,
  validateRespondToOfferRequest,
} from "./applications.ts";
import { validateMeshGetApplicationRequest } from "./federation.ts";

test("the Hub status and pending action vocabularies match the contract", () => {
  assert.deepEqual(applicationStatusValues, [
    "applied",
    "in_review",
    "interviewing",
    "offer",
    "hired",
    "not_progressing",
    "withdrawn",
  ]);
  assert.deepEqual(pendingActionKindValues, [
    "interview_response",
    "background_check_consent",
    "offer_response",
  ]);
  assert.equal(isApplicationStatus("archived"), false);
  assert.equal(isPendingActionKind("sign"), false);
});

const answerID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

test("apply normalization trims the note and leaves the caller's request", () => {
  const request = {
    domain: " Example.COM ",
    opening_number: 1,
    cover_note: "  hello ",
    referral_agency_domain: " Agency.COM ",
  };
  const normalized = normalizeApplyToOpeningRequest(request);
  assert.equal(normalized.domain, "example.com");
  assert.equal(normalized.cover_note, "hello");
  assert.equal(normalized.referral_agency_domain, "agency.com");
  assert.equal(request.cover_note, "  hello ");
  assert.equal(request.referral_agency_domain, " Agency.COM ");
  assert.equal(
    "cover_note" in
      normalizeApplyToOpeningRequest({ ...request, cover_note: "  " }),
    false,
  );
  const answers = [{ question_id: answerID, value: [" a "] }];
  assert.deepEqual(
    normalizeApplyToOpeningRequest({ ...request, answers }).answers,
    [{ question_id: answerID, value: ["a"] }],
  );
  assert.deepEqual(answers[0]?.value, [" a "]);
});

test("apply validation reports each invalid field", () => {
  assert.deepEqual(
    validateApplyToOpeningRequest({
      domain: "example.com",
      opening_number: 1,
      cover_note: "é".repeat(5000),
      referral_agency_domain: "agency.com",
    }),
    [],
  );
  assert.deepEqual(
    validateApplyToOpeningRequest({
      domain: "not a domain",
      opening_number: 0,
      cover_note: "a".repeat(5001),
      referral_agency_domain: "not an agency domain",
      answers: [{ question_id: "x", value: 1.5 }],
    }),
    [
      "domain",
      "opening_number",
      "referral_agency_domain",
      "cover_note",
      "answers.0.question_id",
      "answers.0.value",
    ],
  );
});

test("application references and mesh reads validate every field", () => {
  const reference = normalizeApplicationReference({
    domain: "Example.com",
    opening_number: 1,
    application_number: 1,
  });
  assert.equal(reference.domain, "example.com");
  assert.deepEqual(validateApplicationReference(reference), []);
  assert.deepEqual(
    validateApplicationReference({
      domain: "",
      opening_number: 0,
      application_number: 0,
    }),
    ["domain", "opening_number", "application_number"],
  );
  assert.deepEqual(
    validateMeshGetApplicationRequest({
      ...reference,
      applicant_did: "01900000-0000-4000-8000-000000000001",
    }),
    ["applicant_did"],
  );
});

test("list validation bounds the limit and defaults it to 50", () => {
  assert.equal(effectiveListMyApplicationsLimit({}), 50);
  assert.deepEqual(validateListMyApplicationsRequest({ limit: 50 }), []);
  assert.deepEqual(validateListMyApplicationsRequest({ limit: 51 }), ["limit"]);
  assert.deepEqual(validateListMyApplicationsRequest({ limit: 0 }), ["limit"]);
});

test("offer answers name a positive offer number", () => {
  const reference = {
    domain: "example.com",
    opening_number: 1,
    application_number: 2,
  };
  assert.deepEqual(
    validateRespondToOfferRequest({ ...reference, offer_number: 1 }),
    [],
  );
  assert.deepEqual(
    validateRespondToOfferRequest({
      ...reference,
      application_number: 0,
      offer_number: 1.5,
    }),
    ["application_number", "offer_number"],
  );
});

test("interview responses validate the reference, the number, and the note", () => {
  assert.deepEqual(myInterviewStateValues, ["scheduled", "cancelled"]);
  const accept = {
    domain: "example.com",
    opening_number: 1,
    application_number: 2,
    interview_number: 3,
  };
  assert.deepEqual(validateAcceptInterviewRequest(accept), []);
  assert.deepEqual(
    validateAcceptInterviewRequest({ ...accept, interview_number: 0 }),
    ["interview_number"],
  );
  const reschedule = { ...accept, domain: " Example.COM", note: "  later " };
  assert.equal(
    normalizeRequestInterviewRescheduleRequest(reschedule).note,
    "later",
  );
  assert.equal(reschedule.note, "  later ");
  assert.deepEqual(validateRequestInterviewRescheduleRequest(reschedule), []);
  assert.deepEqual(
    validateRequestInterviewRescheduleRequest({ ...accept, note: " " }),
    ["note"],
  );
  assert.deepEqual(
    validateRequestInterviewRescheduleRequest({
      ...accept,
      note: "é".repeat(501),
    }),
    ["note"],
  );
});

test("consent answers validate the reference and the check number", () => {
  const request = {
    domain: "example.com",
    opening_number: 1,
    application_number: 2,
    check_number: 1,
  };
  assert.deepEqual(validateBackgroundCheckConsentRequest(request), []);
  assert.deepEqual(
    validateBackgroundCheckConsentRequest({
      ...request,
      application_number: 0,
      check_number: 0,
    }),
    ["application_number", "check_number"],
  );
});
