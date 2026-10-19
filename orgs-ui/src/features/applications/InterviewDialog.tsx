import { Form, Input, InputNumber, Radio, Select, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isEmailAddress, normalizeEmailAddress } from "typespec/common/common";
import { isWebsiteURL, normalizeWebsiteURL } from "typespec/hub/profile/public";
import type {
  ApplicationDetail,
  Interview,
  InterviewMode,
} from "typespec/orgs/applications/applications";
import {
  isInterviewDurationMinutes,
  isInterviewLocation,
  maxInterviewers,
} from "typespec/orgs/applications/applications";
import { ActionDialog } from "./ActionDialog";
import { fromLocalInput, localTimeZone, toLocalInput } from "./presentation";
import {
  useChangeInterviewMutation,
  useScheduleInterviewMutation,
} from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  /** Set to change an upcoming interview; absent to schedule a new one. */
  interview?: Interview;
  /** People worth offering: the Opening's team and the caller. */
  suggestions: readonly string[];
  onClose: () => void;
}

/**
 * Schedules or changes an interview. Interviewers are typed or picked as
 * email addresses; the API names any that are not active users of the Org.
 */
export function InterviewDialog({
  detail,
  openingNumber,
  interview,
  suggestions,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const schedule = useScheduleInterviewMutation();
  const change = useChangeInterviewMutation();
  const [start, setStart] = useState(
    interview ? toLocalInput(interview.starts_at) : "",
  );
  const [minutes, setMinutes] = useState<number | null>(
    interview?.duration_minutes ?? 60,
  );
  const [mode, setMode] = useState<InterviewMode>(interview?.mode ?? "video");
  const [video, setVideo] = useState(interview?.video_url ?? "");
  const [place, setPlace] = useState(interview?.location ?? "");
  const [people, setPeople] = useState<string[]>(
    interview?.interviewers.map((entry) => entry.email) ?? [],
  );

  const startsAt = fromLocalInput(start);
  const emails = people.map(normalizeEmailAddress);
  const videoURL = normalizeWebsiteURL(video);
  const trimmedPlace = place.trim();
  const futureStart =
    startsAt !== undefined && new Date(startsAt).getTime() > Date.now();
  const valid =
    futureStart &&
    minutes !== null &&
    isInterviewDurationMinutes(minutes) &&
    (mode === "video"
      ? isWebsiteURL(videoURL)
      : isInterviewLocation(trimmedPlace)) &&
    emails.length >= 1 &&
    emails.length <= maxInterviewers &&
    emails.every(isEmailAddress);

  const options = [...new Set([...suggestions, ...emails])].map((email) => ({
    value: email,
    label: email,
  }));
  const kind = interview ? "change" : "schedule";

  return (
    <ActionDialog
      keyName={`interview-${kind}:${openingNumber}:${detail.application_number}:${interview?.interview_number ?? "new"}`}
      title={t(`applications.interview.${kind}.title`)}
      okText={t(`applications.interview.${kind}.confirm`)}
      doneMessage={t(`applications.interview.${kind}.done`)}
      valid={valid}
      fingerprint={JSON.stringify([start, minutes, mode, video, place, emails])}
      submit={(key) => {
        const request = {
          opening_number: openingNumber,
          application_number: detail.application_number,
          version: detail.version,
          start_time: startsAt ?? "",
          duration_minutes: minutes ?? 0,
          mode,
          ...(mode === "video"
            ? { video_url: videoURL }
            : { location: trimmedPlace }),
          interviewer_emails: emails,
        };
        return interview
          ? change.mutateAsync({
              request: {
                ...request,
                interview_number: interview.interview_number,
              },
              key,
            })
          : schedule.mutateAsync({ request, key });
      }}
      onClose={onClose}
    >
      <Form layout="vertical" component="div">
        {detail.current_stage && (
          <Typography.Paragraph type="secondary">
            {t("applications.interview.atStage", {
              stage: detail.current_stage.name,
            })}
          </Typography.Paragraph>
        )}
        <Form.Item
          label={t("applications.interview.start")}
          required
          extra={t("applications.interview.startHelp", {
            zone: localTimeZone(),
          })}
          validateStatus={start !== "" && !futureStart ? "error" : undefined}
          help={
            start !== "" && !futureStart
              ? t("applications.interview.startPast")
              : undefined
          }
        >
          <Input
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            aria-label={t("applications.interview.start")}
          />
        </Form.Item>
        <Form.Item label={t("applications.interview.duration")} required>
          <InputNumber
            min={15}
            max={480}
            step={15}
            precision={0}
            value={minutes}
            onChange={setMinutes}
            addonAfter={t("applications.interview.minutes")}
            aria-label={t("applications.interview.duration")}
          />
        </Form.Item>
        <Form.Item label={t("applications.work.mode")} required>
          <Radio.Group
            value={mode}
            onChange={(event) => setMode(event.target.value as InterviewMode)}
            options={[
              { value: "video", label: t("applications.work.modes.video") },
              {
                value: "in_person",
                label: t("applications.work.modes.in_person"),
              },
            ]}
          />
        </Form.Item>
        {mode === "video" ? (
          <Form.Item
            label={t("applications.interview.videoUrl")}
            required
            extra={t("applications.interview.videoUrlHelp")}
            validateStatus={
              video !== "" && !isWebsiteURL(videoURL) ? "error" : undefined
            }
          >
            <Input
              value={video}
              inputMode="url"
              onChange={(event) => setVideo(event.target.value)}
              aria-label={t("applications.interview.videoUrl")}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label={t("applications.interview.location")}
            required
            extra={t("applications.interview.locationHelp")}
          >
            <Input
              value={place}
              maxLength={500}
              onChange={(event) => setPlace(event.target.value)}
              aria-label={t("applications.interview.location")}
            />
          </Form.Item>
        )}
        <Form.Item
          label={t("applications.work.interviewers")}
          required
          extra={t("applications.interview.interviewersHelp", {
            max: maxInterviewers,
          })}
        >
          <Select
            mode="tags"
            value={people}
            options={options}
            tokenSeparators={[",", " "]}
            onChange={setPeople}
            aria-label={t("applications.work.interviewers")}
            placeholder={t("applications.interview.interviewersPlaceholder")}
          />
        </Form.Item>
      </Form>
    </ActionDialog>
  );
}
