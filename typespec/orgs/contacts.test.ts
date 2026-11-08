import assert from "node:assert/strict";
import test from "node:test";

import {
  AgencyMessageDeletedKind,
  AgencyPointerChangedKind,
  agencyMessageAggregateID,
  contactAggregateID,
  HubAccountDeletedKind,
  HubAgencyRequestsChangedKind,
  HubChatRequestAnswerKind,
  HubChatRequestKind,
  HubConversationMessageDeleteKind,
  HubConversationReplyKind,
  validateAgencyMessageDeletedPayload,
  validateAgencyPointerChangedPayload,
  validateAgencyPointerRequest,
  validateHubAccountDeletedPayload,
  validateHubAgencyRequestsChangedPayload,
  validateHubChatRequestAnswerPayload,
  validateHubChatRequestPayload,
  validateHubChatRequestResult,
  validateHubConversationMessageDeletePayload,
  validateHubConversationReplyPayload,
  validateMeshReadConversationRequest,
} from "../federation/marketplace.ts";
import {
  normalizeHubSendChatRequestRequest,
  validateHubAcceptChatRequestRequest,
  validateHubDeclineChatRequestRequest,
  validateDeleteMessageRequest as validateHubDeleteMessageRequest,
  validateGetConversationRequest as validateHubGetConversationRequest,
  validateHubSendChatRequestRequest,
  validateListHubChatRequestsRequest,
  validateListOpeningAgenciesRequest,
} from "../hub/messages/messages.ts";
import {
  isChatRequestNote,
  isContactNameQuery,
  isNoteText,
  maxChatRequestNoteLength,
  maxNoteLength,
  normalizeSendChatRequestRequest,
  validateAcceptChatRequestRequest,
  validateAddContactNoteRequest,
  validateAddPersonNoteRequest,
  validateContactReference,
  validateDeclineChatRequestRequest,
  validateDeleteMessageRequest,
  validateEditContactNoteRequest,
  validateGetConversationRequest,
  validateListChatRequestsRequest,
  validateListContactNotesRequest,
  validateListContactsRequest,
  validateSendChatRequestRequest,
  validateViewHubProfileRequest,
} from "./marketplace/contacts/contacts.ts";
import {
  validatePeerReadAgencyProfileRequest,
  validateRelayReadAgencyProfileRequest,
} from "./marketplace/contacts/federation.ts";

const handle = "priyaaaa-00000000001";
const agency_domain = "agency.test";
const org_did = "01900000-0000-7000-8000-000000000003";
const hub_user_did = "01900000-0000-7000-8000-000000000004";

test("a note is 1 to 5,000 code points once trimmed", () => {
  assert.equal(isNoteText("a"), true);
  assert.equal(isNoteText("  a  "), true);
  assert.equal(isNoteText(" \n "), false);
  assert.equal(isNoteText("é".repeat(maxNoteLength)), true);
  assert.equal(isNoteText("é".repeat(maxNoteLength + 1)), false);
  assert.equal(isNoteText("😀".repeat(maxNoteLength)), true);
});

test("contact requests name the field they reject", () => {
  assert.deepEqual(validateViewHubProfileRequest({ address: "priya" }), []);
  assert.deepEqual(validateViewHubProfileRequest({ address: "" }), ["address"]);
  assert.deepEqual(validateContactReference({ handle }), []);
  assert.deepEqual(validateContactReference({ handle: "priya" }), ["handle"]);
  assert.deepEqual(validateListContactsRequest({ limit: 100 }), []);
  assert.deepEqual(validateListContactsRequest({ limit: 101 }), ["limit"]);
  assert.deepEqual(validateListContactsRequest({ pagination_key: "" }), [
    "pagination_key",
  ]);
  assert.deepEqual(validateListContactNotesRequest({ handle }), []);
  assert.deepEqual(validateListContactNotesRequest({ handle: "x", limit: 0 }), [
    "handle",
    "limit",
  ]);
  assert.deepEqual(
    validateAddPersonNoteRequest({ address: "priya", text: "hi" }),
    [],
  );
  assert.deepEqual(validateAddPersonNoteRequest({ address: "x", text: " " }), [
    "address",
    "text",
  ]);
  assert.deepEqual(validateAddContactNoteRequest({ handle, text: "hi" }), []);
  assert.deepEqual(validateAddContactNoteRequest({ handle: "x", text: "" }), [
    "handle",
    "text",
  ]);
  assert.deepEqual(
    validateEditContactNoteRequest({ handle, note_number: 1, text: "hi" }),
    [],
  );
  assert.deepEqual(
    validateEditContactNoteRequest({ handle: "x", note_number: 0, text: "" }),
    ["handle", "note_number", "text"],
  );
  assert.deepEqual(
    validateDeleteMessageRequest({ handle, message_number: 3 }),
    [],
  );
  assert.deepEqual(
    validateDeleteMessageRequest({ handle, message_number: 1.5 }),
    ["message_number"],
  );
});

test("agency profile reads name their fields", () => {
  assert.deepEqual(
    validateRelayReadAgencyProfileRequest({
      agency_org_did: org_did,
      address: "priya",
    }),
    [],
  );
  assert.deepEqual(
    validateRelayReadAgencyProfileRequest({
      agency_org_did: "x",
      address: "",
    }),
    ["agency_org_did", "address"],
  );
  assert.deepEqual(
    validatePeerReadAgencyProfileRequest({
      agency_org_did: org_did,
      target_hub_user_did: hub_user_did,
    }),
    [],
  );
  assert.deepEqual(
    validatePeerReadAgencyProfileRequest({
      agency_org_did: "x",
      target_hub_user_did: "y",
    }),
    ["agency_org_did", "target_hub_user_did"],
  );
});

test("agency event payloads name their fields", () => {
  assert.equal(AgencyPointerChangedKind, "agency-pointer-changed");
  assert.equal(HubAccountDeletedKind, "hub-account-deleted");
  assert.equal(HubAgencyRequestsChangedKind, "hub-agency-requests-changed");
  assert.equal(AgencyMessageDeletedKind, "agency-message-deleted");
  assert.equal(
    contactAggregateID(org_did, hub_user_did),
    `${org_did}:${hub_user_did}`,
  );
  assert.equal(
    agencyMessageAggregateID(org_did, hub_user_did, 7),
    `${org_did}:${hub_user_did}:7`,
  );
  assert.deepEqual(
    validateAgencyPointerChangedPayload({
      agency_org_did: org_did,
      hub_user_did,
      present: true,
    }),
    [],
  );
  assert.deepEqual(
    validateAgencyPointerChangedPayload({
      agency_org_did: "y",
      hub_user_did: "z",
      present: false,
    }),
    ["agency_org_did", "hub_user_did"],
  );
  assert.deepEqual(validateHubAccountDeletedPayload({ hub_user_did }), []);
  assert.deepEqual(validateHubAccountDeletedPayload({ hub_user_did: "z" }), [
    "hub_user_did",
  ]);
  assert.deepEqual(
    validateHubAgencyRequestsChangedPayload({
      agency_org_did: org_did,
      hub_user_did,
      requests_off: true,
    }),
    [],
  );
  assert.deepEqual(
    validateHubAgencyRequestsChangedPayload({
      agency_org_did: "x",
      hub_user_did: "z",
      requests_off: false,
    }),
    ["agency_org_did", "hub_user_did"],
  );
  assert.deepEqual(
    validateAgencyMessageDeletedPayload({
      agency_org_did: org_did,
      hub_user_did,
      agency_domain,
      message_number: 4,
    }),
    [],
  );
  assert.deepEqual(
    validateAgencyMessageDeletedPayload({
      agency_org_did: "x",
      hub_user_did: "y",
      agency_domain: "z",
      message_number: 0,
    }),
    ["agency_org_did", "hub_user_did", "agency_domain", "message_number"],
  );
});

test("the Contacts list takes a known filter and a 2 to 100 code point name query", () => {
  assert.equal(isContactNameQuery("ad"), true);
  assert.equal(isContactNameQuery("é".repeat(100)), true);
  assert.equal(isContactNameQuery("a"), false);
  assert.equal(isContactNameQuery("é".repeat(101)), false);
  assert.equal(isContactNameQuery(" ada"), false);
  for (const filter of [
    "all",
    "requests_received",
    "unread",
    "requests_sent",
    "has_conversation",
  ] as const) {
    assert.deepEqual(validateListContactsRequest({ filter }), []);
  }
  assert.deepEqual(
    validateListContactsRequest({ filter: "unread", name_query: "ada" }),
    [],
  );
  assert.deepEqual(
    validateListContactsRequest({
      limit: 0,
      filter: "archived" as never,
      name_query: "a",
    }),
    ["limit", "filter", "name_query"],
  );
});

test("conversation reads page through messages on every side", () => {
  assert.deepEqual(validateGetConversationRequest({ handle, limit: 1 }), []);
  assert.deepEqual(
    validateGetConversationRequest({
      handle: "x",
      pagination_key: "",
      limit: 101,
    }),
    ["handle", "pagination_key", "limit"],
  );
  assert.deepEqual(
    validateHubGetConversationRequest({ agency_domain, limit: 100 }),
    [],
  );
  assert.deepEqual(
    validateHubGetConversationRequest({ agency_domain: "x", limit: 0 }),
    ["agency_domain", "limit"],
  );
  assert.deepEqual(
    validateHubDeleteMessageRequest({ agency_domain, message_number: 2 }),
    [],
  );
  assert.deepEqual(
    validateHubDeleteMessageRequest({ agency_domain: "x", message_number: 0 }),
    ["agency_domain", "message_number"],
  );
  assert.deepEqual(
    validateMeshReadConversationRequest({
      hub_user_did,
      agency_org_did: org_did,
      limit: 100,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshReadConversationRequest({
      hub_user_did,
      agency_org_did: org_did,
      message_number: 3,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshReadConversationRequest({
      hub_user_did: "y",
      agency_org_did: "z",
      message_number: 0,
      pagination_key: "",
      limit: 101,
    }),
    [
      "pagination_key",
      "limit",
      "hub_user_did",
      "agency_org_did",
      "message_number",
    ],
  );
});

test("Hub conversation commands carry the Hub user's name and handle", () => {
  assert.equal(HubConversationReplyKind, "hub-conversation-reply");
  assert.equal(
    HubConversationMessageDeleteKind,
    "hub-conversation-message-delete",
  );
  const reply = {
    agency_org_did: org_did,
    hub_user_did,
    hub_user_display_name: "Ada Lovelace",
    hub_user_handle: "abcd1234-0123456789a",
    text: "Interested",
    window_seconds: 1,
  };
  assert.deepEqual(validateHubConversationReplyPayload(reply), []);
  assert.deepEqual(
    validateHubConversationReplyPayload({
      agency_org_did: "x",
      hub_user_did: "y",
      hub_user_display_name: "",
      hub_user_handle: "nope",
      text: " ",
      window_seconds: 0,
    }),
    [
      "agency_org_did",
      "hub_user_did",
      "hub_user_display_name",
      "hub_user_handle",
      "text",
      "window_seconds",
    ],
  );
  assert.deepEqual(
    validateHubConversationMessageDeletePayload({
      agency_org_did: org_did,
      hub_user_did,
      message_number: 2,
    }),
    [],
  );
  assert.deepEqual(
    validateHubConversationMessageDeletePayload({
      agency_org_did: "x",
      hub_user_did: "y",
      message_number: 0,
    }),
    ["agency_org_did", "hub_user_did", "message_number"],
  );
});

const request_number = 1;
const opening = { consumer_domain: "client.test", opening_number: 1 };

test("a chat request note is 1 to 1,000 code points once trimmed", () => {
  assert.equal(isChatRequestNote("a"), true);
  assert.equal(isChatRequestNote("  a  "), true);
  assert.equal(isChatRequestNote(" \n "), false);
  assert.equal(isChatRequestNote("é".repeat(maxChatRequestNoteLength)), true);
  assert.equal(
    isChatRequestNote("é".repeat(maxChatRequestNoteLength + 1)),
    false,
  );
});

test("agency chat requests name a person and the field they reject", () => {
  const original = { address: " priya ", note: " hi ", suggestion: opening };
  const normalized = normalizeSendChatRequestRequest(original);
  assert.deepEqual(normalized, {
    address: "priya",
    note: "hi",
    suggestion: opening,
  });
  assert.equal(original.address, " priya ");
  assert.deepEqual(validateSendChatRequestRequest(normalized), []);
  assert.deepEqual(
    validateSendChatRequestRequest({ address: handle, suggestion: opening }),
    [],
  );
  assert.deepEqual(
    validateSendChatRequestRequest({
      address: "x",
      suggestion: { consumer_domain: "x", opening_number: 0 },
      note: " ",
    }),
    ["address", "suggestion", "note"],
  );
  assert.deepEqual(
    validateListChatRequestsRequest({ direction: "to_agency" }),
    [],
  );
  assert.deepEqual(
    validateListChatRequestsRequest({
      direction: "sideways" as never,
      limit: 101,
    }),
    ["direction", "limit"],
  );
  assert.deepEqual(
    validateAcceptChatRequestRequest({ handle, request_number }),
    [],
  );
  assert.deepEqual(
    validateAcceptChatRequestRequest({ handle: "x", request_number: 0 }),
    ["handle", "request_number"],
  );
  assert.deepEqual(
    validateDeclineChatRequestRequest({
      handle,
      request_number,
      scope: "sender",
    }),
    [],
  );
  assert.deepEqual(
    validateDeclineChatRequestRequest({
      handle,
      request_number: -1,
      scope: "forever" as never,
    }),
    ["request_number", "scope"],
  );
});

test("Hub chat requests name an Opening, an agency, and the field they reject", () => {
  const original = {
    domain: " Client.Test ",
    opening_number: 1,
    agency_domain: "Agency.Test",
    note: " hi ",
  };
  const normalized = normalizeHubSendChatRequestRequest(original);
  assert.equal(normalized.domain, "client.test");
  assert.equal(normalized.agency_domain, "agency.test");
  assert.equal(normalized.note, "hi");
  assert.equal(original.note, " hi ");
  assert.deepEqual(validateHubSendChatRequestRequest(normalized), []);
  assert.deepEqual(
    validateHubSendChatRequestRequest({
      domain: "x",
      opening_number: 0,
      agency_domain: "y",
      note: "a".repeat(maxChatRequestNoteLength + 1),
    }),
    ["domain", "opening_number", "agency_domain", "note"],
  );
  assert.deepEqual(
    validateListOpeningAgenciesRequest({
      domain: "client.test",
      opening_number: 1,
    }),
    [],
  );
  assert.deepEqual(
    validateListHubChatRequestsRequest({ direction: "to_hub_user" }),
    [],
  );
  assert.deepEqual(
    validateListHubChatRequestsRequest({
      direction: "x" as never,
      limit: 0,
    }),
    ["direction", "limit"],
  );
  assert.deepEqual(
    validateHubAcceptChatRequestRequest({ agency_domain, request_number }),
    [],
  );
  assert.deepEqual(
    validateHubDeclineChatRequestRequest({
      agency_domain: "x",
      request_number: 0,
      scope: "x" as never,
    }),
    ["agency_domain", "request_number", "scope"],
  );
});

test("chat request commands carry the window and a scope only when declining", () => {
  assert.equal(HubChatRequestKind, "hub-chat-request");
  assert.equal(HubChatRequestAnswerKind, "hub-chat-request-answer");
  const hubUser = {
    hub_user_did,
    hub_user_display_name: "Ada Lovelace",
    hub_user_handle: "abcd1234-0123456789a",
  };
  assert.deepEqual(
    validateHubChatRequestPayload({
      agency_org_did: org_did,
      ...hubUser,
      ...opening,
      note: "hi",
      window_seconds: 7776000,
      requests_off: false,
    }),
    [],
  );
  assert.deepEqual(
    validateHubChatRequestPayload({
      agency_org_did: org_did,
      ...hubUser,
      ...opening,
      note: " hi ",
      window_seconds: 0,
      requests_off: true,
    }),
    ["note", "window_seconds"],
  );
  const sent = {
    request: {
      request_number,
      direction: "to_agency" as const,
      state: "pending" as const,
      ...opening,
      sent_at: "2026-01-01T00:00:00Z",
    },
  };
  assert.deepEqual(validateHubChatRequestResult(sent), []);
  assert.deepEqual(
    validateHubChatRequestResult({
      ...sent,
      request: { ...sent.request, direction: "to_hub_user" },
    }),
    ["request.direction"],
  );
  const answer = {
    agency_org_did: org_did,
    request_number,
    ...hubUser,
    accept: true,
    window_seconds: 1,
  };
  assert.deepEqual(validateHubChatRequestAnswerPayload(answer), []);
  assert.deepEqual(
    validateHubChatRequestAnswerPayload({
      ...answer,
      accept: false,
      scope: "opening",
    }),
    [],
  );
  assert.deepEqual(
    validateHubChatRequestAnswerPayload({ ...answer, scope: "opening" }),
    ["scope"],
  );
  assert.deepEqual(
    validateHubChatRequestAnswerPayload({ ...answer, accept: false }),
    ["scope"],
  );
  const pending = {
    request_number,
    direction: "to_hub_user" as const,
    state: "pending" as const,
    ...opening,
    sent_at: "2026-11-01T00:00:00Z",
  };
  assert.deepEqual(validateAgencyPointerRequest(pending), []);
  assert.deepEqual(
    validateAgencyPointerRequest({
      ...pending,
      state: "declined",
      decline_scope: "sender",
      blocked_until: "2027-01-30T00:00:00Z",
    }),
    [],
  );
  assert.deepEqual(
    validateAgencyPointerRequest({
      ...pending,
      state: "declined",
      decline_scope: "sender",
    }),
    ["request.blocked_until"],
  );
});
