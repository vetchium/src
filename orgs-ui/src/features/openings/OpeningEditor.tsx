import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { OpeningContentView } from "@vetchium/portal-ui/openings";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  ConfigProvider,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { isEmailAddress, normalizeEmailAddress } from "typespec/common/common";
import { countryCodeValues } from "typespec/common/countries";
import { currencyCatalog } from "typespec/common/currency_catalog";
import { languageCatalog } from "typespec/common/language_catalog";
import {
  MaxOpeningSalary,
  type OpeningContent,
} from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { APIError, isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { paths } from "../../app/paths";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { openingContentPresentation } from "./presentation";
import { openingProblem } from "./problems";
import {
  useCreateOpeningMutation,
  useSaveOpeningWorkingCopyMutation,
  useSetOpeningTeamMutation,
} from "./queries";

interface EditorValues {
  content?: OpeningContent;
  hiring_manager_email?: string;
  recruiter_email?: string;
  team_member_emails?: string[];
  internal_notes?: string;
}

function cleanContent(input: OpeningContent | undefined): OpeningContent {
  const content = input ?? {};
  const result: OpeningContent = {};
  for (const key of [
    "title",
    "description",
    "language",
    "employing_country",
    "work_arrangement",
    "location_details",
    "employment_type",
    "minimum_education",
  ] as const) {
    const value = content[key];
    if (value) Object.assign(result, { [key]: value });
  }
  if (content.positions !== undefined && content.positions !== null)
    result.positions = content.positions;
  if (content.experience_years) {
    const { min, max } = content.experience_years;
    if (min != null || max != null) {
      result.experience_years = {
        ...(min != null && { min }),
        ...(max != null && { max }),
      };
    }
  }
  if (
    content.work_arrangement === "remote" &&
    content.remote_eligibility?.kind
  ) {
    result.remote_eligibility =
      content.remote_eligibility.kind === "worldwide"
        ? { kind: "worldwide" }
        : content.remote_eligibility;
  }
  if (
    content.salary &&
    Object.values(content.salary).some((value) => value != null && value !== "")
  )
    result.salary = content.salary;
  return result;
}

/** Compares values whose object keys may arrive in any order. */
function sameValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entry]) => [key, canonical(entry)]),
          )
        : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function teamRequest(values: EditorValues) {
  const email = (value: string | undefined) =>
    value?.trim() ? normalizeEmailAddress(value) : undefined;
  return {
    hiring_manager_email: email(values.hiring_manager_email),
    recruiter_email: email(values.recruiter_email),
    team_member_emails: (values.team_member_emails ?? []).map((value) =>
      normalizeEmailAddress(value),
    ),
    internal_notes: values.internal_notes?.trim() || undefined,
  };
}

export function OpeningEditor({ opening }: { opening?: OrgOpening }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<EditorValues>();
  const content = Form.useWatch("content", form) as OpeningContent | undefined;
  const arrangement = Form.useWatch(["content", "work_arrangement"], form);
  const eligibilityKind = Form.useWatch(
    ["content", "remote_eligibility", "kind"],
    form,
  );
  const [memberSearch, setMemberSearch] = useState("");
  const [error, setError] = useState<string>();
  const contentLocked = ["publish", "revise"].includes(
    opening?.pending_request?.kind ?? "",
  );
  const create = useCreateOpeningMutation();
  const save = useSaveOpeningWorkingCopyMutation();
  const saveTeam = useSetOpeningTeamMutation();
  const contentKey = useIdempotencyKey(
    `opening-content:${opening?.opening_number ?? "new"}`,
  );
  const teamKey = useIdempotencyKey(
    `opening-team:${opening?.opening_number ?? "new"}`,
  );
  const lookupEmail = normalizeEmailAddress(memberSearch);
  const members = useQuery({
    queryKey: ["orgs", "opening-member-lookup", lookupEmail],
    queryFn: () =>
      orgsAPI.lookupOpeningTeamMember({ email_address: lookupEmail }),
    enabled: isEmailAddress(lookupEmail),
  });
  const memberOptions =
    members.data?.member !== undefined
      ? [{ value: members.data.member.email, label: members.data.member.email }]
      : [];
  const presentation = openingContentPresentation(t, i18n.language);
  const countryNames = new Intl.DisplayNames([i18n.language], {
    type: "region",
  });
  const countryOptions = countryCodeValues.map((value) => ({
    value,
    label: countryNames.of(value) ?? value,
  }));
  const languageNames = new Intl.DisplayNames([i18n.language], {
    type: "language",
  });
  const languageOptions = languageCatalog.map((value) => ({
    value,
    label: languageNames.of(value) ?? value,
  }));

  useEffect(() => {
    if (!opening) return;
    form.setFieldsValue({
      content: opening.working_content ?? opening.live_content ?? {},
      hiring_manager_email: opening.hiring_manager?.email,
      recruiter_email: opening.recruiter?.email,
      team_member_emails: opening.team_members.map((member) => member.email),
      internal_notes: opening.internal_notes,
    });
  }, [form, opening]);

  const handleError = (cause: unknown, rotateKey: () => void) => {
    const problem = openingProblem(cause);
    if (problem.kind === "version-conflict") {
      void queryClient.invalidateQueries({
        queryKey: ["orgs", "openings", "detail", opening?.opening_number],
      });
      setError(t("openings.errors.versionConflict"));
    } else if (problem.kind === "quota-exceeded") {
      setError(
        t("openings.errors.quota", {
          quota: problem.quota,
          count: problem.count,
        }),
      );
    } else if (problem.kind === "hiring-team-invalid") {
      const values = form.getFieldsValue();
      for (const field of [
        "hiring_manager_email",
        "recruiter_email",
        "team_member_emails",
      ] as const) {
        const entries =
          field === "team_member_emails"
            ? (values.team_member_emails ?? [])
            : [values[field]];
        if (
          entries.some(
            (value) =>
              value &&
              problem.emailAddresses.includes(normalizeEmailAddress(value)),
          )
        ) {
          form.setFields([
            {
              name: field,
              errors: [
                t("openings.errors.invalidTeam", {
                  addresses: problem.emailAddresses.join(", "),
                }),
              ],
            },
          ]);
        }
      }
      setError(
        t("openings.errors.invalidTeam", {
          addresses: problem.emailAddresses.join(", "),
        }),
      );
    } else {
      if (cause instanceof APIError && cause.problem?.fields?.length) {
        form.setFields(
          cause.problem.fields.map((field) => ({
            name: (field.startsWith("content.")
              ? field.split(".")
              : field) as NonNullable<
              Parameters<typeof form.setFields>[0][number]["name"]
            >,
            errors: [t("openings.errors.invalidField")],
          })),
        );
      }
      setError(problemMessage(t, cause));
    }
    if (isDefiniteRefusal(cause)) rotateKey();
  };

  const saveExisting = async (current: OrgOpening, values: EditorValues) => {
    const nextContent = cleanContent(values.content);
    const contentChanged =
      !contentLocked &&
      !sameValue(
        nextContent,
        cleanContent(current.working_content ?? current.live_content),
      );
    const nextTeam = teamRequest(values);
    const teamChanged = !sameValue(
      {
        ...nextTeam,
        team_member_emails: [...nextTeam.team_member_emails].sort(),
      },
      {
        hiring_manager_email: current.hiring_manager?.email,
        recruiter_email: current.recruiter?.email,
        team_member_emails: current.team_members
          .map((member) => member.email)
          .sort(),
        internal_notes: current.internal_notes,
      },
    );
    let version = current.version;
    if (contentChanged) {
      try {
        const saved = await save.mutateAsync({
          request: {
            opening_number: current.opening_number,
            version,
            content: nextContent,
          },
          key: contentKey.current(),
        });
        contentKey.rotate();
        version = saved.version;
      } catch (cause) {
        handleError(cause, contentKey.rotate);
        return;
      }
    }
    if (teamChanged) {
      try {
        await saveTeam.mutateAsync({
          request: {
            opening_number: current.opening_number,
            version,
            ...nextTeam,
          },
          key: teamKey.current(),
        });
        teamKey.rotate();
      } catch (cause) {
        handleError(cause, teamKey.rotate);
        return;
      }
    }
    void message.success(t("openings.saved"));
    navigate(paths.openingDetail(current.opening_number));
  };

  const submit = async (values: EditorValues) => {
    setError(undefined);
    if (opening) {
      await saveExisting(opening, values);
      return;
    }
    try {
      const created = await create.mutateAsync({
        request: {
          content: cleanContent(values.content),
          ...teamRequest(values),
        },
        key: contentKey.current(),
      });
      contentKey.rotate();
      void message.success(t("openings.created"));
      navigate(paths.openingDetail(created.opening_number));
    } catch (cause) {
      handleError(cause, contentKey.rotate);
    }
  };

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t(opening ? "openings.editTitle" : "openings.newTitle")}</title>
      <Typography.Title level={1}>
        {t(opening ? "openings.editTitle" : "openings.newTitle")}
      </Typography.Title>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError(undefined)}
        />
      )}
      <Flex gap="large" wrap align="start">
        <Card
          title={t("openings.editor.content")}
          style={{ flex: "1 1 440px" }}
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => void submit(values)}
            initialValues={{ content: {}, team_member_emails: [] }}
          >
            <ConfigProvider componentDisabled={contentLocked}>
              {contentLocked && (
                <Alert type="info" title={t("openings.errors.contentLocked")} />
              )}
              <Form.Item
                name={["content", "title"]}
                label={t("openings.fields.title")}
              >
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item
                name={["content", "description"]}
                label={t("openings.fields.description")}
              >
                <Input.TextArea rows={8} maxLength={20000} />
              </Form.Item>
              <Form.Item
                name={["content", "language"]}
                label={t("openings.fields.language")}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={languageOptions}
                  allowClear
                />
              </Form.Item>
              <Form.Item
                name={["content", "employing_country"]}
                label={t("openings.fields.country")}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={countryOptions}
                  allowClear
                />
              </Form.Item>
              <Form.Item
                name={["content", "work_arrangement"]}
                label={t("openings.fields.workArrangement")}
              >
                <Select
                  options={["on_site", "hybrid", "remote"].map((value) => ({
                    value,
                    label: t(`openings.workArrangements.${value}`),
                  }))}
                  allowClear
                />
              </Form.Item>
              <Form.Item
                name={["content", "location_details"]}
                label={t("openings.fields.locationDetails")}
              >
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
              {arrangement === "remote" && (
                <>
                  <Form.Item
                    name={["content", "remote_eligibility", "kind"]}
                    label={t("openings.fields.remoteEligibility")}
                  >
                    <Select
                      options={["worldwide", "countries"].map((value) => ({
                        value,
                        label: t(`openings.remote.${value}`),
                      }))}
                      allowClear
                    />
                  </Form.Item>
                  {eligibilityKind === "countries" && (
                    <Form.Item
                      name={["content", "remote_eligibility", "countries"]}
                      label={t("openings.remote.countries")}
                    >
                      <Select
                        mode="multiple"
                        showSearch
                        optionFilterProp="label"
                        options={countryOptions}
                      />
                    </Form.Item>
                  )}
                </>
              )}
              <Form.Item
                name={["content", "employment_type"]}
                label={t("openings.fields.employmentType")}
              >
                <Select
                  options={[
                    "full_time",
                    "part_time",
                    "contract",
                    "internship",
                  ].map((value) => ({
                    value,
                    label: t(`openings.employmentTypes.${value}`),
                  }))}
                  allowClear
                />
              </Form.Item>
              <Form.Item
                name={["content", "positions"]}
                label={t("openings.fields.positions")}
              >
                <InputNumber min={1} max={10} className="full-width" />
              </Form.Item>
              <Flex gap="middle">
                <Form.Item
                  name={["content", "experience_years", "min"]}
                  label={t("openings.editor.minimumYears")}
                >
                  <InputNumber min={0} max={50} />
                </Form.Item>
                <Form.Item
                  name={["content", "experience_years", "max"]}
                  label={t("openings.editor.maximumYears")}
                >
                  <InputNumber min={0} max={50} />
                </Form.Item>
              </Flex>
              <Form.Item
                name={["content", "minimum_education"]}
                label={t("openings.fields.minimumEducation")}
              >
                <Select
                  options={["secondary", "bachelor", "master", "doctorate"].map(
                    (value) => ({
                      value,
                      label: t(`openings.education.${value}`),
                    }),
                  )}
                  allowClear
                />
              </Form.Item>
              <Typography.Title level={4}>
                {t("openings.fields.salary")}
              </Typography.Title>
              <Flex gap="middle" wrap>
                <Form.Item
                  name={["content", "salary", "currency"]}
                  label={t("openings.editor.currency")}
                >
                  <Select
                    showSearch
                    options={currencyCatalog.map((value) => ({
                      value,
                      label: value,
                    }))}
                    style={{ width: 120 }}
                  />
                </Form.Item>
                <Form.Item
                  name={["content", "salary", "min"]}
                  label={t("openings.editor.salaryMin")}
                >
                  <InputNumber min={0} max={MaxOpeningSalary} />
                </Form.Item>
                <Form.Item
                  name={["content", "salary", "max"]}
                  label={t("openings.editor.salaryMax")}
                >
                  <InputNumber min={1} max={MaxOpeningSalary} />
                </Form.Item>
                <Form.Item
                  name={["content", "salary", "period"]}
                  label={t("openings.editor.salaryPeriod")}
                >
                  <Select
                    options={["hour", "day", "month", "year"].map((value) => ({
                      value,
                      label: t(`openings.salaryPeriods.${value}`),
                    }))}
                    style={{ width: 130 }}
                  />
                </Form.Item>
              </Flex>
            </ConfigProvider>
            <Typography.Title level={4}>
              {t("openings.editor.team")}
            </Typography.Title>
            <Form.Item
              name="hiring_manager_email"
              label={t("openings.fields.hiringManager")}
            >
              <AutoComplete
                options={memberOptions}
                onSearch={setMemberSearch}
              />
            </Form.Item>
            <Form.Item
              name="recruiter_email"
              label={t("openings.editor.recruiter")}
            >
              <AutoComplete
                options={memberOptions}
                onSearch={setMemberSearch}
              />
            </Form.Item>
            <Form.Item
              name="team_member_emails"
              label={t("openings.editor.teamMembers")}
            >
              <Select
                mode="tags"
                showSearch
                options={memberOptions}
                onSearch={setMemberSearch}
                filterOption={false}
              />
            </Form.Item>
            <Form.Item
              name="internal_notes"
              label={t("openings.editor.internalNotes")}
            >
              <Input.TextArea rows={3} maxLength={2000} />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={create.isPending || save.isPending || saveTeam.isPending}
            >
              {t(
                opening
                  ? "openings.editor.save"
                  : "openings.editor.createDraft",
              )}
            </Button>
          </Form>
        </Card>
        <Card
          title={t("openings.editor.preview")}
          style={{ flex: "1 1 360px" }}
        >
          <OpeningContentView
            content={cleanContent(content)}
            {...presentation}
          />
        </Card>
      </Flex>
    </Space>
  );
}
