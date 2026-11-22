import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUnsavedChangesGuard } from "@vetchium/portal-ui/unsaved-changes";
import {
  App,
  Button,
  Card,
  Col,
  Flex,
  Grid,
  Progress,
  Row,
  Select,
  Steps,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { hubAPI } from "../../api/hub";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey } from "../profile/queries";
import { AboutStep } from "./AboutStep";
import { EducationStep, LanguagesStep, WorkStep } from "./EntrySteps";
import { IdealJobStep } from "./IdealJobStep";
import type { StepProps } from "./StepActions";
import {
  completedSteps,
  nextStep,
  type SetupStep,
  setupSteps,
} from "./setupSteps";

/** Home until the user is set up or hides it (PROF-JOB-006). */
export function HomeSetup({
  me,
  profile,
  onFinish,
}: {
  me: MyInfoResponse;
  profile: PublicProfile;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const wide = Grid.useBreakpoint().lg === true;
  const completed = completedSteps(me, profile);
  const doneCount = setupSteps.filter((step) => completed[step]).length;
  // Chosen once: a refetch must not move the person off the step on screen.
  const [current, setCurrent] = useState<SetupStep>(
    () => setupSteps.find((step) => !completed[step]) ?? "idealJob",
  );
  const [dirty, setDirty] = useState<Partial<Record<SetupStep, boolean>>>({});
  const dirtyChange = useMemo(
    () =>
      Object.fromEntries(
        setupSteps.map((step) => [
          step,
          (value: boolean) =>
            setDirty((previous) => ({ ...previous, [step]: value })),
        ]),
      ) as Record<SetupStep, (value: boolean) => void>,
    [],
  );
  const needsAttention = (step: SetupStep) =>
    !completed[step] || dirty[step] === true;
  const hasUnsaved = setupSteps.some((step) => dirty[step] === true);
  useUnsavedChangesGuard(hasUnsaved);

  const headings = useRef<Partial<Record<SetupStep, HTMLElement | null>>>({});
  const focusHeading = useRef(false);
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headings.current[current]?.focus();
  }, [current]);
  function show(step: SetupStep) {
    if (step === current) return;
    focusHeading.current = true;
    setCurrent(step);
  }

  const hide = useMutation({
    mutationFn: () => hubAPI.dismissJobSearchPrompt({}),
    onSuccess: async () => {
      void message.info(t("setup.hidden"));
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
    },
  });
  function confirmHide() {
    if (hide.isPending) return;
    if (!hasUnsaved) {
      hide.mutate();
      return;
    }
    modal.confirm({
      title: t("common.unsavedTitle"),
      content: t("common.unsavedContent"),
      okText: t("setup.hide"),
      cancelText: t("common.unsavedStay"),
      onOk: () => hide.mutate(),
    });
  }

  function stepProps(step: SetupStep): StepProps {
    const next = nextStep(step, needsAttention);
    return {
      onAdvance: (done) => {
        if (next === undefined) {
          if (done) onFinish();
          return;
        }
        focusHeading.current = true;
        // Someone who opened another step during the save stays on it.
        setCurrent((shown) => (shown === step ? next : shown));
      },
      onSkip: next === undefined ? undefined : () => show(next),
      onDirtyChange: dirtyChange[step],
    };
  }

  function content(step: SetupStep) {
    const props = stepProps(step);
    const own = { ...props, address: me.handle, profile };
    switch (step) {
      case "idealJob":
        return <IdealJobStep me={me} {...props} />;
      case "work":
        return <WorkStep {...own} />;
      case "education":
        return <EducationStep {...own} />;
      case "languages":
        return <LanguagesStep {...own} />;
      case "about":
        return <AboutStep {...own} />;
    }
  }

  const progress = t("setup.progress", {
    done: doneCount,
    total: setupSteps.length,
  });

  return (
    <Card>
      <Flex vertical gap="middle">
        <Flex justify="space-between" align="center" wrap gap="small">
          <Typography.Title level={2} style={{ margin: 0 }}>
            {t("setup.title")}
          </Typography.Title>
          <Flex align="center" gap="small" wrap>
            <Typography.Text type="secondary">{progress}</Typography.Text>
            <Button
              type="link"
              size="small"
              loading={hide.isPending}
              onClick={confirmHide}
            >
              {t("setup.hide")}
            </Button>
          </Flex>
        </Flex>
        <Progress
          percent={(doneCount / setupSteps.length) * 100}
          showInfo={false}
          aria-label={progress}
        />
        <APIErrorAlert error={hide.error} />
        <Row gutter={[40, 20]}>
          <Col xs={24} lg={8}>
            {wide ? (
              <Steps
                orientation="vertical"
                current={setupSteps.indexOf(current)}
                onChange={(index) => show(setupSteps[index] ?? current)}
                items={setupSteps.map((step) => ({
                  title: t(`setup.steps.${step}.title`),
                  content: t(
                    step === "idealJob"
                      ? "setup.notOnProfile"
                      : "setup.onProfile",
                  ),
                  status:
                    step === current
                      ? "process"
                      : completed[step]
                        ? "finish"
                        : "wait",
                }))}
              />
            ) : (
              <Select<SetupStep>
                aria-label={t("setup.stepLabel")}
                className="full-width"
                value={current}
                onChange={show}
                options={setupSteps.map((step, index) => ({
                  value: step,
                  label: t(
                    completed[step] ? "setup.stepDone" : "setup.stepOption",
                    {
                      number: index + 1,
                      title: t(`setup.steps.${step}.title`),
                    },
                  ),
                }))}
              />
            )}
          </Col>
          <Col xs={24} lg={16}>
            {setupSteps.map((step) => (
              <section
                key={step}
                hidden={step !== current}
                data-testid={`setup-step-${step}`}
              >
                <Flex vertical gap="middle">
                  <div>
                    <Typography.Title
                      ref={(node: HTMLElement | null) => {
                        headings.current[step] = node;
                      }}
                      tabIndex={-1}
                      level={3}
                      style={{
                        marginTop: 0,
                        marginBottom: 4,
                        outline: "none",
                      }}
                    >
                      {t(`setup.steps.${step}.heading`)}
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      {t(`setup.steps.${step}.intro`)}
                    </Typography.Text>
                  </div>
                  {content(step)}
                </Flex>
              </section>
            ))}
          </Col>
        </Row>
      </Flex>
    </Card>
  );
}
