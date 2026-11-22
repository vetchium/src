import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Form, type FormInstance, Input, Row } from "antd";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isProfessionalDomain,
  normalizeProfessionalDomain,
} from "typespec/common/domain";
import {
  isProfileTitle,
  normalizeSaveWorkExperienceRequest,
  type ProfileMonth,
  type SaveWorkExperienceRequest,
  validateSaveWorkExperienceRequest,
  type WorkExperience,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { FieldLabel } from "../../components/common/FieldLabel";
import { MonthSelect } from "./MonthSelect";
import { OptionalLabel } from "./OptionalLabel";
import { myInfoQueryKey } from "./queries";

export interface WorkExperienceFormValues {
  employer_domain: string;
  job_title: string;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
  location: string;
  description: string;
}

function toRequest(
  id: string | undefined,
  values: WorkExperienceFormValues,
): SaveWorkExperienceRequest {
  return normalizeSaveWorkExperienceRequest({
    id,
    employer_domain: values.employer_domain,
    job_title: values.job_title,
    start_month: values.start_month ?? "",
    end_month: values.end_month ?? null,
    location: values.location || null,
    description: values.description || null,
  });
}

export function useSaveWorkExperience(address: string, onSaved: () => void) {
  const queryClient = useQueryClient();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  return useMutation({
    mutationFn: (request: SaveWorkExperienceRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveWorkExperience(request, key.current());
    },
    onSuccess: async () => {
      key.rotate();
      lastPayload.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      onSaved();
    },
  });
}

/** One work experience, as the profile editor and Home's setup both edit it. */
export function WorkExperienceForm({
  form,
  entry,
  collapseMore = false,
  onSave,
  onDirtyChange,
}: {
  form: FormInstance<WorkExperienceFormValues>;
  entry?: WorkExperience;
  /** Keeps the optional details behind a button until asked for. */
  collapseMore?: boolean;
  onSave: (request: SaveWorkExperienceRequest) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const domainID = useId();
  const [showMore, setShowMore] = useState(!collapseMore);
  return (
    <Form<WorkExperienceFormValues>
      form={form}
      // Home shows this and the education form at once; the name keeps ids apart.
      name="work-experience"
      layout="vertical"
      preserve={false}
      requiredMark={false}
      scrollToFirstError={{ focus: true }}
      initialValues={{
        employer_domain: entry?.employer_domain ?? "",
        job_title: entry?.job_title ?? "",
        start_month: entry?.start_month,
        end_month: entry?.end_month,
        location: entry?.location ?? "",
        description: entry?.description ?? "",
      }}
      onValuesChange={(_, values) =>
        onDirtyChange?.(Object.values(values).some(Boolean))
      }
      onFinish={(values) => {
        const request = toRequest(entry?.id, values);
        const invalid = validateSaveWorkExperienceRequest(request);
        if (invalid.length > 0) {
          form.setFields(
            invalid.map((name) => ({
              name: name as keyof WorkExperienceFormValues,
              errors: [t(`profileWork.validation.${name}`)],
            })),
          );
          return;
        }
        onSave(request);
      }}
    >
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="job_title"
            required
            label={t("profileWork.fields.jobTitle")}
            rules={[
              {
                validator: async (_, value: string) => {
                  if (!isProfileTitle(value ?? "")) {
                    throw new Error(t("profileWork.validation.job_title"));
                  }
                },
              },
            ]}
          >
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <FieldLabel
            htmlFor={domainID}
            label={t("profileWork.fields.employerDomain")}
            help={t("profileWork.employerDomainHelp")}
          />
          <Form.Item
            name="employer_domain"
            required
            rules={[
              {
                validator: async (_, value: string) => {
                  if (
                    !isProfessionalDomain(
                      normalizeProfessionalDomain(value ?? ""),
                    )
                  ) {
                    throw new Error(
                      t("profileWork.validation.employer_domain"),
                    );
                  }
                },
              },
            ]}
          >
            <Input
              id={domainID}
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("profileWork.employerDomainPlaceholder")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="start_month"
            required
            label={t("profileWork.fields.startMonth")}
            rules={[
              {
                validator: async (_, value: ProfileMonth | undefined) => {
                  if (value === undefined) {
                    throw new Error(t("profileWork.validation.start_month"));
                  }
                },
              },
            ]}
          >
            <MonthSelect
              placeholder={t("common.monthAndYear")}
              ariaLabel={t("profileWork.fields.startMonth")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="end_month"
            label={<OptionalLabel label={t("profileWork.fields.endMonth")} />}
            dependencies={["start_month"]}
            rules={[
              {
                validator: async (_, value: ProfileMonth | undefined) => {
                  const start = form.getFieldValue("start_month") as
                    | ProfileMonth
                    | undefined;
                  if (
                    value !== undefined &&
                    start !== undefined &&
                    value < start
                  ) {
                    throw new Error(t("profileWork.validation.end_month"));
                  }
                },
              },
            ]}
          >
            <MonthSelect
              placeholder={t("profileWork.endPlaceholder")}
              allowClear
              ariaLabel={t("profileWork.fields.endMonth")}
            />
          </Form.Item>
        </Col>
      </Row>
      {showMore ? null : (
        <Button
          type="link"
          icon={<PlusOutlined aria-hidden />}
          style={{ paddingInline: 0 }}
          onClick={() => setShowMore(true)}
        >
          {t("profileWork.more")}
        </Button>
      )}
      <div hidden={!showMore}>
        <Form.Item
          name="location"
          label={<OptionalLabel label={t("profileWork.fields.location")} />}
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 200) {
                  throw new Error(t("profileWork.validation.location"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="description"
          label={<OptionalLabel label={t("profileWork.fields.description")} />}
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 2000) {
                  throw new Error(t("profileWork.validation.description"));
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      </div>
    </Form>
  );
}
