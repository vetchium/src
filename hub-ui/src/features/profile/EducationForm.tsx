import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fieldErrors, localized } from "@vetchium/portal-ui/localized";
import { Button, Col, Form, type FormInstance, Input, Row } from "antd";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isProfessionalDomain,
  normalizeProfessionalDomain,
} from "typespec/common/domain";
import {
  type EducationalQualification,
  isProfileTitle,
  normalizeSaveEducationalQualificationRequest,
  type ProfileMonth,
  type SaveEducationalQualificationRequest,
  validateSaveEducationalQualificationRequest,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { FieldLabel } from "../../components/common/FieldLabel";
import { MonthSelect } from "./MonthSelect";
import { OptionalLabel } from "./OptionalLabel";
import { myInfoQueryKey } from "./queries";

export interface EducationFormValues {
  institution_domain: string;
  degree: string;
  title: string;
  supporting_text: string;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
}

function toRequest(
  id: string | undefined,
  values: EducationFormValues,
): SaveEducationalQualificationRequest {
  return normalizeSaveEducationalQualificationRequest({
    id,
    institution_domain: values.institution_domain,
    degree: values.degree,
    title: values.title || null,
    supporting_text: values.supporting_text || null,
    start_month: values.start_month ?? null,
    end_month: values.end_month ?? null,
  });
}

export function useSaveEducation(address: string, onSaved: () => void) {
  const queryClient = useQueryClient();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  return useMutation({
    mutationFn: (request: SaveEducationalQualificationRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveEducation(request, key.current());
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

/** One educational qualification, as the profile editor and Home's setup both edit it. */
export function EducationForm({
  form,
  entry,
  collapseMore = false,
  onSave,
  onDirtyChange,
}: {
  form: FormInstance<EducationFormValues>;
  entry?: EducationalQualification;
  /** Keeps the optional details behind a button until asked for. */
  collapseMore?: boolean;
  onSave: (request: SaveEducationalQualificationRequest) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const domainID = useId();
  const [showMore, setShowMore] = useState(!collapseMore);
  return (
    <Form<EducationFormValues>
      form={form}
      name="education"
      layout="vertical"
      preserve={false}
      requiredMark={false}
      scrollToFirstError={{ focus: true }}
      initialValues={{
        institution_domain: entry?.institution_domain ?? "",
        degree: entry?.degree ?? "",
        title: entry?.title ?? "",
        supporting_text: entry?.supporting_text ?? "",
        start_month: entry?.start_month,
        end_month: entry?.end_month,
      }}
      onValuesChange={(_, values) =>
        onDirtyChange?.(Object.values(values).some(Boolean))
      }
      onFinish={(values) => {
        const request = toRequest(entry?.id, values);
        const invalid = validateSaveEducationalQualificationRequest(request);
        if (invalid.length > 0) {
          form.setFields(
            invalid.map((name) => ({
              name: name as keyof EducationFormValues,
              errors: fieldErrors(
                localized(`profileEducation.validation.${name}`),
              ),
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
            name="degree"
            required
            label={t("profileEducation.fields.degree")}
            rules={[
              {
                validator: async (_, value: string) => {
                  if (!isProfileTitle(value ?? "")) {
                    throw localized("profileEducation.validation.degree");
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
            label={t("profileEducation.fields.institutionDomain")}
            help={t("profileEducation.institutionDomainHelp")}
          />
          <Form.Item
            name="institution_domain"
            required
            rules={[
              {
                validator: async (_, value: string) => {
                  if (
                    !isProfessionalDomain(
                      normalizeProfessionalDomain(value ?? ""),
                    )
                  ) {
                    throw localized(
                      "profileEducation.validation.institution_domain",
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
              placeholder={t("profileEducation.institutionDomainPlaceholder")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="start_month"
            label={
              <OptionalLabel label={t("profileEducation.fields.startMonth")} />
            }
          >
            <MonthSelect
              placeholder={t("common.monthAndYear")}
              allowClear
              ariaLabel={t("profileEducation.fields.startMonth")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="end_month"
            label={
              <OptionalLabel label={t("profileEducation.fields.endMonth")} />
            }
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
                    throw localized("profileEducation.validation.end_month");
                  }
                },
              },
            ]}
          >
            <MonthSelect
              placeholder={t("profileEducation.endPlaceholder")}
              allowClear
              ariaLabel={t("profileEducation.fields.endMonth")}
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
          {t("profileEducation.more")}
        </Button>
      )}
      <div hidden={!showMore}>
        <Form.Item
          name="title"
          label={<OptionalLabel label={t("profileEducation.fields.title")} />}
          rules={[
            {
              validator: async (_, value: string) => {
                if (value && !isProfileTitle(value)) {
                  throw localized("profileEducation.validation.title");
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="supporting_text"
          label={
            <OptionalLabel
              label={t("profileEducation.fields.supportingText")}
            />
          }
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 249) {
                  throw localized(
                    "profileEducation.validation.supporting_text",
                  );
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={2} />
        </Form.Item>
      </div>
    </Form>
  );
}
