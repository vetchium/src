import { randomBytes } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { GetOperationRequest } from "typespec/hub/operations/operations";
import type { SetAliasRequest } from "typespec/hub/profile/alias";
import type {
  AddProfessionalEmailRequest,
  ListProfessionalEmailsRequest,
  ProfessionalEmailIDRequest,
  VerifyProfessionalEmailRequest,
} from "typespec/hub/profile/professional_email";
import type {
  ChangeLanguageAbilityRequest,
  DeleteProfileEntryRequest,
  ReadProfileRequest,
  SaveCertificationRequest,
  SaveEducationalQualificationRequest,
  SaveWebsiteRequest,
  SaveWorkExperienceRequest,
  SetPublicFieldsRequest,
} from "typespec/hub/profile/public";
import type { SetSubscriptionPlanRequest } from "typespec/hub/subscriptions/subscriptions";
import type { TestTenant } from "./admin-db.ts";
import { apiOrigin } from "./portals.ts";

export const MAILPIT_ORIGIN =
  process.env.PLAYWRIGHT_MAILPIT_BASE_URL ?? "http://127.0.0.1:18025";

export function hubIdempotencyKey(): string {
  return `e2e-${randomBytes(30).toString("base64url")}`;
}

export interface ProfileMutationOptions {
  token: string;
  idempotencyKey: string;
}

export class HubAPI {
  readonly idempotencyKeys = new Set<string>();
  readonly origin: string;

  constructor(
    readonly request: APIRequestContext,
    readonly tenant: TestTenant = "sgp",
  ) {
    this.origin = apiOrigin(tenant);
  }

  post(
    path: string,
    data?: unknown,
    options: {
      token?: string;
      idempotencyKey?: string;
      timeout?: number;
    } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      this.idempotencyKeys.add(options.idempotencyKey);
    }
    return this.request.post(`${this.origin}/api/hub${path}`, {
      data,
      headers,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
  }

  postRaw(
    path: string,
    body: string,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      this.idempotencyKeys.add(options.idempotencyKey);
    }
    return this.request.post(`${this.origin}/api/hub${path}`, {
      data: body,
      headers,
    });
  }

  get(path: string, token: string): Promise<APIResponse> {
    return this.request.get(`${this.origin}/api/hub${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  mySubscription(token: string): Promise<APIResponse> {
    return this.get("/my-subscription", token);
  }

  readProfile(body: ReadProfileRequest, token: string): Promise<APIResponse> {
    return this.post("/profile/read", body, { token });
  }

  setPublicFields(
    body: SetPublicFieldsRequest,
    options: { token: string; idempotencyKey: string },
  ): Promise<APIResponse> {
    return this.post("/profile/set-public-fields", body, options);
  }

  aliasState(token: string): Promise<APIResponse> {
    return this.get("/profile/alias/state", token);
  }

  setAlias(
    body: SetAliasRequest,
    options: { token: string; idempotencyKey: string },
  ): Promise<APIResponse> {
    return this.post("/profile/alias/set", body, options);
  }

  operationStatus(
    body: GetOperationRequest,
    token: string,
  ): Promise<APIResponse> {
    return this.post("/operations/status", body, { token });
  }

  saveWorkExperience(
    body: SaveWorkExperienceRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/save-work-experience", body, options);
  }

  deleteWorkExperience(
    body: DeleteProfileEntryRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/delete-work-experience", body, options);
  }

  saveCertification(
    body: SaveCertificationRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/save-certification", body, options);
  }

  deleteCertification(
    body: DeleteProfileEntryRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/delete-certification", body, options);
  }

  saveWebsite(
    body: SaveWebsiteRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/save-website", body, options);
  }

  deleteWebsite(
    body: DeleteProfileEntryRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/delete-website", body, options);
  }

  saveEducation(
    body: SaveEducationalQualificationRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/save-education", body, options);
  }

  deleteEducation(
    body: DeleteProfileEntryRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/delete-education", body, options);
  }

  addLanguageAbility(
    body: ChangeLanguageAbilityRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/add-language", body, options);
  }

  deleteLanguageAbility(
    body: ChangeLanguageAbilityRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/delete-language", body, options);
  }

  listProfessionalEmails(
    body: ListProfessionalEmailsRequest,
    token: string,
  ): Promise<APIResponse> {
    return this.post("/profile/professional-email/list", body, { token });
  }

  addProfessionalEmail(
    body: AddProfessionalEmailRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/professional-email/add", body, options);
  }

  deleteProfessionalEmail(
    body: ProfessionalEmailIDRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/professional-email/delete", body, options);
  }

  requestProfessionalEmailCode(
    body: ProfessionalEmailIDRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/professional-email/request-code", body, options);
  }

  verifyProfessionalEmailCode(
    body: VerifyProfessionalEmailRequest,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    return this.post("/profile/professional-email/verify", body, options);
  }

  removePicture(options: ProfileMutationOptions): Promise<APIResponse> {
    return this.post("/profile/picture/remove", {}, options);
  }

  /** The one profile write whose body is raw image bytes rather than JSON. */
  uploadPicture(
    contentType: string,
    body: Buffer,
    options: ProfileMutationOptions,
  ): Promise<APIResponse> {
    this.idempotencyKeys.add(options.idempotencyKey);
    return this.request.post(`${this.origin}/api/hub/profile/picture/upload`, {
      data: body,
      headers: {
        "Content-Type": contentType,
        Authorization: `Bearer ${options.token}`,
        "Idempotency-Key": options.idempotencyKey,
      },
    });
  }

  setSubscriptionPlan(
    body: SetSubscriptionPlanRequest,
    options: { token: string; idempotencyKey: string; timeout?: number },
  ): Promise<APIResponse> {
    return this.post("/set-subscription-plan", body, options);
  }

  setSubscriptionPlanRaw(
    body: Record<string, unknown> | string,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    return typeof body === "string"
      ? this.postRaw("/set-subscription-plan", body, options)
      : this.post("/set-subscription-plan", body, options);
  }
}
