import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Modal,
  Row,
  Space,
  Spin,
  Steps,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { isApplicationNumber } from "typespec/orgs/applications/applications";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import {
  ApplicationNotFoundError,
  ApplicationStateConflictError,
} from "typespec/problem/hub/applications";
import { OrgUnavailableError } from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { hubAPI } from "../api/hub";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { ActionError } from "../features/applications/ActionError";
import { AnswersCard } from "../features/applications/AnswersCard";
import { useApplicationAction } from "../features/applications/actions";
import { ConsentCard } from "../features/applications/ConsentCard";
import { InterviewsCard } from "../features/applications/InterviewsCard";
import { OfferCard } from "../features/applications/OfferCard";
import { progressStatuses } from "../features/applications/presentation";
import { useMyApplicationQuery } from "../features/applications/queries";
import { StatusTag } from "../features/applications/StatusTag";

const withdrawable: readonly string[] = [
  "applied",
  "in_review",
  "interviewing",
  "offer",
];

export function ApplicationDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const domain = normalizeOrgDomain(params.domain ?? "");
  const openingNumber = Number(params.openingNumber);
  const applicationNumber = Number(params.applicationNumber);
  const valid =
    isOrgDomain(domain) &&
    Number.isInteger(openingNumber) &&
    openingNumber > 0 &&
    isApplicationNumber(applicationNumber);
  const reference = {
    domain,
    opening_number: openingNumber,
    application_number: applicationNumber,
  };
  const result = useMyApplicationQuery(reference, valid);
  const [withdrawing, setWithdrawing] = useState(false);
  const withdraw = useApplicationAction((_: null, key) =>
    hubAPI.withdrawApplication(reference, key),
  );

  const backLink = (
    <Link to="/applications">
      <Button>{t("applications.back")}</Button>
    </Link>
  );
  if (
    !valid ||
    (result.isError && isProblem(result.error, ApplicationNotFoundError.type))
  ) {
    return (
      <Space orientation="vertical">
        <title>{t("applications.detail.documentTitle")}</title>
        <Typography.Text>{t("applications.detail.notFound")}</Typography.Text>
        {backLink}
      </Space>
    );
  }
  if (result.isPending) {
    return <Spin aria-label={t("applications.loading")} />;
  }
  if (result.isError) {
    return (
      <Space orientation="vertical">
        <title>{t("applications.detail.documentTitle")}</title>
        {isProblem(result.error, OrgUnavailableError.type) ? (
          <Alert
            type="warning"
            showIcon
            title={t("applications.detail.orgUnavailable")}
          />
        ) : (
          <APIErrorAlert error={result.error} />
        )}
        <Button onClick={() => void result.refetch()}>
          {t("common.retry")}
        </Button>
        {backLink}
      </Space>
    );
  }

  const application = result.data;
  const statusIndex = (progressStatuses as readonly string[]).indexOf(
    application.status,
  );
  const offerAnswerable =
    application.offer !== undefined && application.status === "offer";
  const readLetterURL = async () => {
    const fresh = await result.refetch();
    return fresh.data?.offer?.letter_url;
  };
  const conflict =
    withdraw.isError &&
    isProblem(withdraw.error, ApplicationStateConflictError.type);

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("applications.detail.documentTitle")}</title>
      <Breadcrumb
        items={[
          {
            title: <Link to="/applications">{t("applications.title")}</Link>,
          },
          { title: application.opening_title },
        ]}
      />
      <Space align="center" wrap className="full-width">
        <Typography.Title level={1} style={{ margin: 0 }}>
          {application.opening_title}
        </Typography.Title>
        <StatusTag status={application.status} />
        {withdrawable.includes(application.status) ? (
          <Button danger onClick={() => setWithdrawing(true)}>
            {t("applications.withdraw.action")}
          </Button>
        ) : null}
      </Space>
      <Typography.Text type="secondary">
        <Link to={`/org/${encodeURIComponent(application.org_domain)}`}>
          {application.org_display_name}
        </Link>
        {` · ${application.org_domain}`}
      </Typography.Text>
      {statusIndex >= 0 ? (
        <Card>
          <Steps
            current={statusIndex}
            items={progressStatuses.map((status) => ({
              title: t(`applications.status.${status}`),
            }))}
          />
        </Card>
      ) : null}
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Space orientation="vertical" size="large" className="full-width">
            {application.pending_actions.length === 0 &&
            application.interviews.length === 0 &&
            application.offer === undefined &&
            application.background_check_consent === undefined ? (
              <Card>
                <Typography.Text type="secondary">
                  {t("applications.detail.nothingToDo")}
                </Typography.Text>
              </Card>
            ) : null}
            <InterviewsCard
              reference={reference}
              orgName={application.org_display_name}
              interviews={application.interviews}
            />
            {application.background_check_consent !== undefined ? (
              <ConsentCard
                reference={reference}
                orgName={application.org_display_name}
                consent={application.background_check_consent}
              />
            ) : null}
            {application.offer !== undefined ? (
              <OfferCard
                reference={reference}
                orgName={application.org_display_name}
                offer={application.offer}
                answerable={offerAnswerable}
                readLetterURL={readLetterURL}
              />
            ) : null}
            <AnswersCard answers={application.answers} />
          </Space>
        </Col>
        <Col xs={24} lg={8}>
          <Space orientation="vertical" size="large" className="full-width">
            <Card title={t("applications.detail.yourApplication")}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t("applications.detail.number")}>
                  {`#${application.application_number}`}
                </Descriptions.Item>
                <Descriptions.Item label={t("applications.detail.opening")}>
                  <Link
                    to={`/org/${encodeURIComponent(application.org_domain)}/openings/${application.opening_number}`}
                  >
                    {t("applications.detail.viewOpening")}
                  </Link>
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Card>
              <Typography.Text type="secondary">
                {t("applications.detail.orgDecides", {
                  org: application.org_display_name,
                })}
              </Typography.Text>
            </Card>
          </Space>
        </Col>
      </Row>
      <Modal
        open={withdrawing}
        title={t("applications.withdraw.title")}
        okText={t("applications.withdraw.action")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={withdraw.isPending}
        onOk={() =>
          withdraw.mutate(null, {
            onSuccess: () => {
              setWithdrawing(false);
              void navigate("/applications?tab=closed");
            },
          })
        }
        onCancel={() => {
          setWithdrawing(false);
          withdraw.reset();
        }}
      >
        <Typography.Paragraph>
          {t("applications.withdraw.body", {
            org: application.org_display_name,
          })}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {t("applications.withdraw.cannotReapply")}
        </Typography.Paragraph>
        {conflict ? null : <ActionError error={withdraw.error} />}
        {conflict ? (
          <Alert
            type="warning"
            showIcon
            title={t("applications.withdraw.conflict")}
          />
        ) : null}
      </Modal>
    </Space>
  );
}
