import assert from "node:assert/strict";
import test from "node:test";

import {
  AgencyPointerChangedKind,
  HubAccountDeletedKind,
  HubAgencyMessagesChangedKind,
  HubConversationDeleteKind,
  HubConversationReplyKind,
  validateAgencyPointerChangedPayload,
  validateHubAccountDeletedPayload,
  validateHubAgencyMessagesChangedPayload,
  validateHubConversationDeletePayload,
  validateHubConversationReplyPayload,
  validateMeshReadConversationRequest,
} from "../federation/marketplace.ts";
import { validateGetConversationRequest as validateHubGetConversationRequest } from "../hub/messages/messages.ts";
import {
  isContactNameQuery,
  isNoteText,
  maxNoteLength,
  validateAddContactNoteRequest,
  validateAddPersonNoteRequest,
  validateContactReference,
  validateDeleteContactNoteRequest,
  validateEditContactNoteRequest,
  validateGetConversationRequest,
  validateListContactNotesRequest,
  validateListContactsRequest,
  validateViewHubProfileRequest,
} from "./marketplace/contacts/contacts.ts";
import {
  validatePeerReadAgencyProfileRequest,
  validateRelayReadAgencyProfileRequest,
} from "./marketplace/contacts/federation.ts";

const contact_id = "01900000-0000-7000-8000-000000000001";
const note_id = "01900000-0000-7000-8000-000000000002";
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
  assert.deepEqual(validateContactReference({ contact_id }), []);
  assert.deepEqual(validateContactReference({ contact_id: "x" }), [
    "contact_id",
  ]);
  assert.deepEqual(validateListContactsRequest({ limit: 100 }), []);
  assert.deepEqual(validateListContactsRequest({ limit: 101 }), ["limit"]);
  assert.deepEqual(validateListContactsRequest({ pagination_key: "" }), [
    "pagination_key",
  ]);
  assert.deepEqual(validateListContactNotesRequest({ contact_id }), []);
  assert.deepEqual(
    validateListContactNotesRequest({ contact_id: "x", limit: 0 }),
    ["contact_id", "limit"],
  );
  assert.deepEqual(
    validateAddPersonNoteRequest({ address: "priya", text: "hi" }),
    [],
  );
  assert.deepEqual(validateAddPersonNoteRequest({ address: "x", text: " " }), [
    "address",
    "text",
  ]);
  assert.deepEqual(
    validateAddContactNoteRequest({ contact_id, text: "hi" }),
    [],
  );
  assert.deepEqual(
    validateAddContactNoteRequest({ contact_id: "x", text: "" }),
    ["contact_id", "text"],
  );
  assert.deepEqual(
    validateEditContactNoteRequest({ contact_id, note_id, text: "hi" }),
    [],
  );
  assert.deepEqual(
    validateEditContactNoteRequest({ contact_id: "x", note_id: "y", text: "" }),
    ["contact_id", "note_id", "text"],
  );
  assert.deepEqual(
    validateDeleteContactNoteRequest({ contact_id, note_id }),
    [],
  );
  assert.deepEqual(
    validateDeleteContactNoteRequest({ contact_id, note_id: "y" }),
    ["note_id"],
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
  assert.equal(HubAgencyMessagesChangedKind, "hub-agency-messages-changed");
  assert.deepEqual(
    validateAgencyPointerChangedPayload({
      contact_id,
      agency_org_did: org_did,
      hub_user_did,
      present: true,
    }),
    [],
  );
  assert.deepEqual(
    validateAgencyPointerChangedPayload({
      contact_id: "x",
      agency_org_did: "y",
      hub_user_did: "z",
      present: false,
    }),
    ["contact_id", "agency_org_did", "hub_user_did"],
  );
  assert.deepEqual(validateHubAccountDeletedPayload({ hub_user_did }), []);
  assert.deepEqual(validateHubAccountDeletedPayload({ hub_user_did: "z" }), [
    "hub_user_did",
  ]);
  assert.deepEqual(
    validateHubAgencyMessagesChangedPayload({
      contact_id,
      hub_user_did,
      messages_off: true,
    }),
    [],
  );
  assert.deepEqual(
    validateHubAgencyMessagesChangedPayload({
      contact_id: "x",
      hub_user_did: "z",
      messages_off: false,
    }),
    ["contact_id", "hub_user_did"],
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
    "unread",
    "has_conversation",
    "not_contacted",
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
  assert.deepEqual(
    validateGetConversationRequest({ contact_id, limit: 1 }),
    [],
  );
  assert.deepEqual(
    validateGetConversationRequest({
      contact_id: "x",
      pagination_key: "",
      limit: 101,
    }),
    ["pagination_key", "limit", "contact_id"],
  );
  assert.deepEqual(
    validateHubGetConversationRequest({ contact_id, limit: 100 }),
    [],
  );
  assert.deepEqual(
    validateHubGetConversationRequest({ contact_id: "x", limit: 0 }),
    ["limit", "contact_id"],
  );
  assert.deepEqual(
    validateMeshReadConversationRequest({
      contact_id,
      hub_user_did,
      agency_org_did: org_did,
      limit: 100,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshReadConversationRequest({
      contact_id: "x",
      hub_user_did: "y",
      agency_org_did: "z",
      pagination_key: "",
      limit: 101,
    }),
    ["pagination_key", "limit", "contact_id", "hub_user_did", "agency_org_did"],
  );
});

test("Hub conversation commands carry the Hub user's name and handle", () => {
  assert.equal(HubConversationReplyKind, "hub-conversation-reply");
  assert.equal(HubConversationDeleteKind, "hub-conversation-delete");
  const reply = {
    contact_id,
    hub_user_did,
    hub_user_display_name: "Ada Lovelace",
    hub_user_handle: "abcd1234-0123456789a",
    text: "Interested",
  };
  assert.deepEqual(validateHubConversationReplyPayload(reply), []);
  assert.deepEqual(
    validateHubConversationReplyPayload({
      contact_id: "x",
      hub_user_did: "y",
      hub_user_display_name: "",
      hub_user_handle: "nope",
      text: " ",
    }),
    [
      "contact_id",
      "hub_user_did",
      "hub_user_display_name",
      "hub_user_handle",
      "text",
    ],
  );
  assert.deepEqual(
    validateHubConversationDeletePayload({ contact_id, hub_user_did }),
    [],
  );
  assert.deepEqual(
    validateHubConversationDeletePayload({
      contact_id: "x",
      hub_user_did: "y",
    }),
    ["contact_id", "hub_user_did"],
  );
});
