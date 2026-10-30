import { OpeningView, QuestionFields } from "@vetchium/portal-ui/openings";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Segmented,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpeningContent } from "typespec/common/openings";
import { useMyInfoQuery } from "../account/queries";
import { openingPresentation, questionFieldLabels } from "./presentation";

/**
 * The Opening and its application form as Hub users see them, laid out like
 * the Hub Opening and apply pages (OPN-ORG-004).
 */
export function CandidatePreview({
  content,
  help,
}: {
  content: OpeningContent;
  help: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const [view, setView] = useState<"opening" | "form">("opening");
  const [form] = Form.useForm();
  const questions = content.questions ?? [];
  const countries = new Intl.DisplayNames([i18n.language], { type: "region" });
  const org = me && {
    name: me.org.display_name,
    detail: [
      me.org.domain.domain,
      t("openings.preview.basedIn", {
        country: countries.of(me.org.country) ?? me.org.country,
      }),
    ].join(" · "),
    ...(me.logo_url && { logoURL: me.logo_url }),
  };

  if (Object.keys(content).length === 0)
    return <Empty description={t("openings.editor.previewEmpty")} />;
  return (
    <Flex vertical gap="middle">
      <Alert type="info" showIcon title={help} />
      <Segmented<"opening" | "form">
        value={view}
        onChange={(value) => setView(value)}
        options={[
          { value: "opening", label: t("openings.preview.openingPage") },
          { value: "form", label: t("openings.preview.applicationForm") },
        ]}
      />
      {view === "opening" ? (
        <OpeningView
          content={content}
          presentation={openingPresentation(t, i18n.language)}
          {...(org && { org })}
          aside={
            <Card>
              <Flex vertical gap="middle">
                <Button type="primary" size="large" block disabled>
                  {t("openings.preview.apply")}
                </Button>
                <Typography.Text type="secondary">
                  {questions.length > 0
                    ? t("openings.preview.applyHelpQuestions", {
                        count: questions.length,
                      })
                    : t("openings.preview.applyHelp")}
                </Typography.Text>
              </Flex>
            </Card>
          }
        />
      ) : questions.length === 0 ? (
        <Empty description={t("openings.preview.noQuestions")} />
      ) : (
        <Card
          size="small"
          title={t("openings.preview.questionsFrom", {
            org: me?.org.display_name ?? "",
          })}
        >
          <Form form={form} layout="vertical">
            <QuestionFields
              questions={questions}
              labels={questionFieldLabels(t, i18n.language)}
            />
          </Form>
        </Card>
      )}
    </Flex>
  );
}
