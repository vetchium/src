import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Button, Flex, Form, Modal, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Job, maxJobsPerOwner } from "typespec/orgs/marketplace/work/work";
import {
  EngagementWorkNotFoundError,
  JobOwnerInvalidError,
  JobOwnerLimitReachedError,
  JobOwnerVersionConflictError,
} from "typespec/problem/orgs/marketplace";
import { getProblemType, isDefiniteRefusal } from "../../api/client";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useSetJobOwnerMutation } from "./queries";
import { JobOwnerPicker } from "./SuggestionSelect";

/**
 * Changes the one agency user who looks after a Job. Only the agency sees
 * the owner; any agency user may set any colleague (MKT-OWN-002).
 */
export function JobOwnerModal({
  job,
  myEmail,
  open,
  onClose,
}: {
  job: Job;
  myEmail: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [chosen, setChosen] = useState<string | undefined>(job.owner);
  const mutation = useSetJobOwnerMutation();
  const key = useIdempotencyKey(
    `set-job-owner:${job.engagement_id}:${job.opening.number}`,
  );

  const errorText = (error: unknown) => {
    switch (getProblemType(error)) {
      case JobOwnerInvalidError.type:
        return t("marketplace.jobs.owner.invalid");
      case JobOwnerLimitReachedError.type:
        return t("marketplace.jobs.owner.limitReached", {
          limit: maxJobsPerOwner,
        });
      case JobOwnerVersionConflictError.type:
        return t("marketplace.jobs.owner.conflict");
      case EngagementWorkNotFoundError.type:
        return t("marketplace.jobs.owner.jobGone");
      default:
        return problemMessage(t, error);
    }
  };

  const save = (owner: string | undefined) => {
    mutation.mutate(
      {
        request: {
          engagement_id: job.engagement_id,
          opening_number: job.opening.number,
          owner_version: job.owner_version ?? 0,
          ...(owner !== undefined && { owner_email: owner }),
        },
        key: key.current(),
      },
      {
        onSuccess: (result) => {
          key.rotate();
          void message.success(
            result.owner === undefined
              ? t("marketplace.jobs.owner.cleared")
              : t("marketplace.jobs.owner.saved", { owner: result.owner }),
          );
          onClose();
        },
        onError: (error) => {
          if (isDefiniteRefusal(error)) key.rotate();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      title={t("marketplace.jobs.owner.title")}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Flex justify="space-between" wrap gap="small">
          <Button
            danger
            disabled={job.owner === undefined || mutation.isPending}
            onClick={() => save(undefined)}
          >
            {t("marketplace.jobs.owner.clear")}
          </Button>
          <Flex gap="small">
            <Button onClick={onClose}>{t("actions.cancel")}</Button>
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={chosen === undefined || chosen === job.owner}
              onClick={() => save(chosen)}
            >
              {t("actions.save")}
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">
          {t("marketplace.jobs.owner.explainer", {
            title: job.opening.title,
            client: job.client.display_name,
          })}
        </Typography.Text>
        <Form layout="vertical" component="div">
          <Form.Item
            label={t("marketplace.jobs.owner.field")}
            style={{ marginBottom: 8 }}
          >
            <JobOwnerPicker
              value={chosen}
              onChange={setChosen}
              placeholder={t("marketplace.jobs.owner.placeholder")}
              ariaLabel={t("marketplace.jobs.owner.field")}
              notFound={t("marketplace.jobs.owner.noneFound")}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Button
            type="link"
            disabled={chosen === myEmail}
            onClick={() => setChosen(myEmail)}
          >
            {t("marketplace.jobs.owner.me")}
          </Button>
        </Form>
        {mutation.isError ? (
          <Alert type="error" showIcon title={errorText(mutation.error)} />
        ) : null}
      </Flex>
    </Modal>
  );
}
