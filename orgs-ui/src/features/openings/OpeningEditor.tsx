import {
  CheckCircleFilled,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  MinusCircleOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { OpeningContentView } from "@vetchium/portal-ui/openings";
import {
  Affix,
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Collapse,
  ConfigProvider,
  Divider,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Tabs,
  Typography,
} from "antd";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { isEmailAddress, normalizeEmailAddress } from "typespec/common/common";
import { countryCodeValues } from "typespec/common/countries";
import { currencyCatalog } from "typespec/common/currency_catalog";
import {
  isLanguageTag,
  languageCatalog,
} from "typespec/common/language_catalog";
import {
  MaxOpeningSalary,
  missingForPublication,
  type OpeningContent,
} from "typespec/common/openings";
import type { DraftOpeningResponse } from "typespec/orgs/ai/ai";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { APIError, isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { paths } from "../../app/paths";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useMyInfoQuery } from "../account/queries";
import { DraftWithAIButton } from "../ai/DraftWithAIButton";
import { usePipelineTemplatesQuery } from "../pipelines/queries";
import { StageSummary } from "../pipelines/StageSummary";
import { OpeningsBreadcrumb } from "./OpeningsBreadcrumb";
import { openingContentPresentation } from "./presentation";
import { openingProblem } from "./problems";
import { publicationFieldLabels } from "./publication";
import {
  useCreateOpeningMutation,
  useOpeningSummaryQuery,
  useSaveOpeningWorkingCopyMutation,
  useSetOpeningTeamMutation,
} from "./queries";

interface EditorValues {
  content?: OpeningContent;
  hiring_manager_email?: string;
  recruiter_email?: string;
  team_member_emails?: string[];
  internal_notes?: string;
  /** Empty starts the Opening with one review stage. */
  pipeline_template_id?: string;
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

const editorSections = ["basics", "location", "role", "salary", "team"];

interface ChecklistItem {
  label: string;
  done: boolean;
}

/**
 * What a publish or revise request would need from the form as it stands: the
 * required fields, complete or not, then any optional field that is invalid.
 * A hint only: orgs-api decides.
 */
function publicationChecklist(
  t: TFunction,
  content: OpeningContent,
  values: Pick<EditorValues, "hiring_manager_email" | "recruiter_email">,
): ChecklistItem[] {
  // Empty content lists every always-required field; the arrangement alone
  // adds the fields it requires (remote eligibility for remote work).
  const required = new Set([
    ...missingForPublication({}),
    ...missingForPublication(
      content.work_arrangement
        ? { work_arrangement: content.work_arrangement }
        : {},
    ),
  ]);
  const missing = new Set(
    missingForPublication(content).map((field) => field.split(".")[0] ?? field),
  );
  const contentFields = [
    ...required,
    ...[...missing].filter((field) => !required.has(field)),
  ];
  return [
    ...contentFields.map((field) => ({
      path: `content.${field}`,
      done: !missing.has(field),
    })),
    {
      path: "hiring_manager_email",
      done: Boolean(values.hiring_manager_email?.trim()),
    },
    { path: "recruiter_email", done: Boolean(values.recruiter_email?.trim()) },
  ].map(({ path, done }) => ({
    label: publicationFieldLabels(t, [path])[0] ?? path,
    done,
  }));
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
  const hiringManagerEmail = Form.useWatch("hiring_manager_email", form);
  const recruiterEmail = Form.useWatch("recruiter_email", form);
  const [memberSearch, setMemberSearch] = useState("");
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState("edit");
  // Salary is optional, so its panel starts closed unless it already has one.
  const [openSections, setOpenSections] = useState<string[]>(() => [
    "basics",
    "location",
    "role",
    ...((opening?.working_content ?? opening?.live_content)?.salary
      ? ["salary"]
      : []),
    "team",
    ...(opening ? [] : ["pipeline"]),
  ]);
  const templates = usePipelineTemplatesQuery(!opening);
  const templateID = Form.useWatch("pipeline_template_id", form);
  const chosenTemplate = templates.data?.find(
    (template) => template.id === templateID,
  );
  const screens = Grid.useBreakpoint();
  const summary = useOpeningSummaryQuery();
  const { data: me } = useMyInfoQuery();
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

  // A new Opening starts from the Org's country and default language. my-info
  // may arrive after the form, so fill only what the user has not touched.
  const orgCountry = me?.org.country;
  const orgLanguage = me && new Intl.Locale(me.org.default_language).language;
  useEffect(() => {
    if (opening) return;
    const defaults = [
      [["content", "employing_country"], orgCountry],
      [
        ["content", "language"],
        orgLanguage && isLanguageTag(orgLanguage) ? orgLanguage : undefined,
      ],
    ] as const;
    for (const [field, value] of defaults) {
      if (
        value === undefined ||
        form.isFieldTouched([...field]) ||
        form.getFieldValue([...field]) !== undefined
      )
        continue;
      form.setFieldValue([...field], value);
    }
  }, [form, opening, orgCountry, orgLanguage]);

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
          setActiveTab("edit");
          setOpenSections(editorSections);
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
        setActiveTab("edit");
        setOpenSections(editorSections);
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
          ...(values.pipeline_template_id && {
            pipeline_template_id: values.pipeline_template_id,
          }),
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

  // A draft replaces each field it returns and keeps the rest of the form, so
  // nothing is saved until the user saves.
  const applyDraft = (draft: DraftOpeningResponse) => {
    for (const field of Object.keys(draft.content) as Array<
      keyof OpeningContent
    >) {
      form.setFieldValue(["content", field], draft.content[field]);
    }
    setActiveTab("edit");
    if (draft.content.salary) setOpenSections(editorSections);
    const number = new Intl.NumberFormat(i18n.language);
    void message.success(
      t("ai.draft.applied", {
        credits: number.format(draft.usage.credits_charged),
        input: number.format(draft.usage.input_tokens),
        output: number.format(draft.usage.output_tokens),
        left: number.format(draft.balance_available),
      }),
      8,
    );
    if (draft.dropped_fields.length > 0) {
      void message.warning(
        t("ai.draft.dropped", {
          fields: publicationFieldLabels(
            t,
            draft.dropped_fields.map((field) => `content.${field}`),
          ).join(", "),
        }),
      );
    }
  };

  const pending = create.isPending || save.isPending || saveTeam.isPending;
  const previewContent = cleanContent(content);
  const checklist = publicationChecklist(t, previewContent, {
    hiring_manager_email: hiringManagerEmail,
    recruiter_email: recruiterEmail,
  });
  const checklistDone = checklist.filter((item) => item.done).length;
  const ready = checklistDone === checklist.length;
  const actionsHelp = !opening
    ? "openings.editor.actions.newHelp"
    : opening.state === "draft"
      ? "openings.editor.actions.draftHelp"
      : "openings.editor.actions.revisionHelp";

  const lockable = (children: ReactNode) => (
    <ConfigProvider componentDisabled={contentLocked}>
      {children}
    </ConfigProvider>
  );
  const optional = (
    <Typography.Text type="secondary">
      {t("openings.editor.optional")}
    </Typography.Text>
  );
  const fields = (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      onFinish={(values) => void submit(values)}
      initialValues={{
        content: {},
        team_member_emails: [],
        pipeline_template_id: "",
      }}
    >
      <Flex vertical gap="middle">
        {contentLocked && (
          <Alert
            type="info"
            showIcon
            title={t("openings.errors.contentLocked")}
          />
        )}
        <Collapse
          activeKey={openSections}
          onChange={setOpenSections}
          items={[
            {
              key: "basics",
              label: t("openings.editor.sections.basics"),
              forceRender: true,
              children: lockable(
                <>
                  <Form.Item
                    name={["content", "title"]}
                    label={t("openings.fields.title")}
                    extra={t("openings.editor.help.title")}
                  >
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item
                    name={["content", "description"]}
                    label={t("openings.fields.description")}
                    extra={t("openings.editor.help.description")}
                  >
                    <Input.TextArea rows={10} maxLength={20000} />
                  </Form.Item>
                  <Form.Item
                    name={["content", "language"]}
                    label={t("openings.fields.language")}
                    extra={t("openings.editor.help.language")}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={languageOptions}
                      allowClear
                    />
                  </Form.Item>
                </>,
              ),
            },
            {
              key: "location",
              label: t("openings.editor.sections.location"),
              forceRender: true,
              children: lockable(
                <>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["content", "employing_country"]}
                        label={t("openings.fields.country")}
                        extra={t("openings.editor.help.country")}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          options={countryOptions}
                          allowClear
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["content", "work_arrangement"]}
                        label={t("openings.fields.workArrangement")}
                      >
                        <Select
                          options={["on_site", "hybrid", "remote"].map(
                            (value) => ({
                              value,
                              label: t(`openings.workArrangements.${value}`),
                            }),
                          )}
                          allowClear
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  {arrangement === "remote" && (
                    <>
                      <Form.Item
                        name={["content", "remote_eligibility", "kind"]}
                        label={t("openings.fields.remoteEligibility")}
                        extra={t("openings.editor.help.remoteEligibility")}
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
                    name={["content", "location_details"]}
                    label={t("openings.fields.locationDetails")}
                    extra={t("openings.editor.help.locationDetails")}
                  >
                    <Input.TextArea rows={2} maxLength={2000} />
                  </Form.Item>
                </>,
              ),
            },
            {
              key: "role",
              label: t("openings.editor.sections.role"),
              forceRender: true,
              children: lockable(
                <>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
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
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["content", "positions"]}
                        label={t("openings.fields.positions")}
                        extra={t("openings.editor.help.positions")}
                      >
                        <InputNumber min={1} max={10} className="full-width" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["content", "experience_years", "min"]}
                        label={t("openings.editor.minimumYears")}
                      >
                        <InputNumber min={0} max={50} className="full-width" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["content", "experience_years", "max"]}
                        label={t("openings.editor.maximumYears")}
                      >
                        <InputNumber min={0} max={50} className="full-width" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    name={["content", "minimum_education"]}
                    label={t("openings.fields.minimumEducation")}
                  >
                    <Select
                      options={[
                        "secondary",
                        "bachelor",
                        "master",
                        "doctorate",
                      ].map((value) => ({
                        value,
                        label: t(`openings.education.${value}`),
                      }))}
                      allowClear
                    />
                  </Form.Item>
                </>,
              ),
            },
            {
              key: "salary",
              label: t("openings.fields.salary"),
              extra: optional,
              forceRender: true,
              children: lockable(
                <>
                  <Typography.Paragraph type="secondary">
                    {t("openings.editor.help.salary")}
                  </Typography.Paragraph>
                  <Row gutter={16}>
                    <Col xs={24} sm={12} xl={6}>
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
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} xl={6}>
                      <Form.Item
                        name={["content", "salary", "min"]}
                        label={t("openings.editor.salaryMin")}
                      >
                        <InputNumber
                          min={0}
                          max={MaxOpeningSalary}
                          className="full-width"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} xl={6}>
                      <Form.Item
                        name={["content", "salary", "max"]}
                        label={t("openings.editor.salaryMax")}
                      >
                        <InputNumber
                          min={1}
                          max={MaxOpeningSalary}
                          className="full-width"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} xl={6}>
                      <Form.Item
                        name={["content", "salary", "period"]}
                        label={t("openings.editor.salaryPeriod")}
                      >
                        <Select
                          options={["hour", "day", "month", "year"].map(
                            (value) => ({
                              value,
                              label: t(`openings.salaryPeriods.${value}`),
                            }),
                          )}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>,
              ),
            },
            {
              key: "team",
              label: t("openings.editor.team"),
              forceRender: true,
              children: (
                <>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="hiring_manager_email"
                        label={t("openings.fields.hiringManager")}
                        extra={t("openings.editor.help.hiringManager")}
                      >
                        <AutoComplete
                          options={memberOptions}
                          onSearch={setMemberSearch}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="recruiter_email"
                        label={t("openings.editor.recruiter")}
                        extra={t("openings.editor.help.recruiter")}
                      >
                        <AutoComplete
                          options={memberOptions}
                          onSearch={setMemberSearch}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    name="team_member_emails"
                    label={t("openings.editor.teamMembers")}
                    extra={t("openings.editor.help.teamMembers")}
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
                    extra={t("openings.editor.help.internalNotes")}
                  >
                    <Input.TextArea rows={3} maxLength={2000} />
                  </Form.Item>
                </>
              ),
            },
            ...(opening
              ? []
              : [
                  {
                    key: "pipeline",
                    label: t("pipeline.title"),
                    extra: (
                      <Typography.Text type="secondary">
                        {t("pipeline.internal")}
                      </Typography.Text>
                    ),
                    forceRender: true,
                    children: (
                      <>
                        <Form.Item
                          name="pipeline_template_id"
                          label={t("pipeline.startFrom")}
                          extra={t("pipeline.startFromHelp")}
                        >
                          <Select
                            loading={templates.isLoading}
                            options={[
                              {
                                value: "",
                                label: t("pipeline.defaultStart"),
                              },
                              ...(templates.data ?? []).map((template) => ({
                                value: template.id,
                                label: t("pipeline.templateOption", {
                                  name: template.name,
                                  count: template.stages.length,
                                }),
                              })),
                            ]}
                          />
                        </Form.Item>
                        {templates.isError && (
                          <Alert
                            type="warning"
                            showIcon
                            title={t("pipeline.templatesLoadError")}
                          />
                        )}
                        {chosenTemplate && (
                          <StageSummary stages={chosenTemplate.stages} />
                        )}
                      </>
                    ),
                  },
                ]),
          ]}
        />
      </Flex>
    </Form>
  );

  const preview = (
    <Flex vertical gap="middle">
      <Alert type="info" showIcon title={t("openings.editor.previewHelp")} />
      {Object.keys(previewContent).length === 0 ? (
        <Empty description={t("openings.editor.previewEmpty")} />
      ) : (
        <OpeningContentView content={previewContent} {...presentation} />
      )}
    </Flex>
  );

  const actions = (
    <Card title={t("openings.editor.actions.title")}>
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">{t(actionsHelp)}</Typography.Text>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            closable={{ onClose: () => setError(undefined) }}
          />
        )}
        <Button
          type="primary"
          size="large"
          block
          icon={
            opening ? (
              <SaveOutlined aria-hidden />
            ) : (
              <FileAddOutlined aria-hidden />
            )
          }
          loading={pending}
          onClick={() => form.submit()}
        >
          {t(opening ? "openings.editor.save" : "openings.editor.createDraft")}
        </Button>
        <Button
          block
          disabled={pending}
          onClick={() =>
            navigate(
              opening
                ? paths.openingDetail(opening.opening_number)
                : paths.openings,
            )
          }
        >
          {t("common.cancel")}
        </Button>
        {!opening && summary.data && (
          <Typography.Text type="secondary">
            {t("openings.quota", {
              used: summary.data.quota.used,
              limit: summary.data.quota.limit,
            })}
          </Typography.Text>
        )}
      </Flex>
      <Divider />
      <Flex vertical gap="small">
        <Typography.Title level={5}>
          {t("openings.editor.checklist.title")}
        </Typography.Title>
        <Progress
          percent={Math.round((checklistDone / checklist.length) * 100)}
          status={ready ? "success" : "normal"}
          format={() =>
            t("openings.editor.checklist.progress", {
              done: checklistDone,
              total: checklist.length,
            })
          }
        />
        <Typography.Text type="secondary">
          {t(
            ready
              ? "openings.editor.checklist.ready"
              : "openings.editor.checklist.help",
          )}
        </Typography.Text>
        {checklist.map((item) => (
          <Typography.Text
            key={item.label}
            type={item.done ? "success" : "secondary"}
          >
            <Space size="small">
              {item.done ? (
                <CheckCircleFilled
                  aria-label={t("openings.editor.checklist.done")}
                />
              ) : (
                <MinusCircleOutlined
                  aria-label={t("openings.editor.checklist.missing")}
                />
              )}
              {item.label}
            </Space>
          </Typography.Text>
        ))}
      </Flex>
      <Divider />
      <Typography.Text type="secondary">
        {t("openings.editor.actions.nextStep")}
      </Typography.Text>
    </Card>
  );

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t(opening ? "openings.editTitle" : "openings.newTitle")}</title>
      <OpeningsBreadcrumb
        {...(opening && { opening })}
        current={t(opening ? "openings.edit" : "openings.newTitle")}
      />
      <div>
        <Typography.Title level={1}>
          {t(opening ? "openings.editTitle" : "openings.newTitle")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t(
            opening ? "openings.editor.editIntro" : "openings.editor.newIntro",
          )}
        </Typography.Text>
      </div>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              tabBarExtraContent={
                <DraftWithAIButton
                  currentContent={() =>
                    cleanContent(form.getFieldValue("content"))
                  }
                  onDrafted={applyDraft}
                  disabled={contentLocked || pending}
                />
              }
              items={[
                {
                  key: "edit",
                  label: t("openings.editor.tabs.edit"),
                  icon: <EditOutlined aria-hidden />,
                  children: fields,
                },
                {
                  key: "preview",
                  label: t("openings.editor.preview"),
                  icon: <EyeOutlined aria-hidden />,
                  children: preview,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          {screens.lg ? <Affix offsetTop={24}>{actions}</Affix> : actions}
        </Col>
      </Row>
    </Space>
  );
}
