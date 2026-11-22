import { CheckCircleFilled } from "@ant-design/icons";
import { App, Flex, Form, Typography, theme } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PublicProfile } from "typespec/hub/profile/public";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import {
  EducationForm,
  type EducationFormValues,
  useSaveEducation,
} from "../profile/EducationForm";
import { LanguageAbilityLists } from "../profile/LanguageAbilitiesCard";
import {
  useSaveWorkExperience,
  WorkExperienceForm,
  type WorkExperienceFormValues,
} from "../profile/WorkExperienceForm";
import { StepActions, type StepProps } from "./StepActions";

type ProfileStepProps = StepProps & {
  address: string;
  profile: PublicProfile;
};

/** A step the profile already answers: what it holds and where to change it. */
function Added({
  titles,
  onContinue,
}: {
  titles: string[];
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  return (
    <Flex vertical gap="middle">
      {titles.map((title, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: titles can repeat and the list holds no state
        <Flex key={index} gap="small" align="baseline">
          <CheckCircleFilled
            aria-hidden
            style={{ color: token.colorSuccess }}
          />
          <Typography.Text style={{ overflowWrap: "anywhere" }}>
            {title}
          </Typography.Text>
        </Flex>
      ))}
      <Link to="/settings/profile">{t("setup.editOnProfile")}</Link>
      <StepActions label={t("setup.continue")} onContinue={onContinue} />
    </Flex>
  );
}

function NewWork({
  address,
  onAdvance,
  onSkip,
  onDirtyChange,
}: Omit<ProfileStepProps, "profile">) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<WorkExperienceFormValues>();
  const [dirty, setDirty] = useState(false);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const save = useSaveWorkExperience(address, () => {
    void message.success({ key: "setup", content: t("profileWork.added") });
    onAdvance(true);
  });
  return (
    <Flex vertical gap="middle">
      <WorkExperienceForm
        form={form}
        collapseMore
        onSave={(request) => save.mutate(request)}
        onDirtyChange={(next) => {
          setDirty(next);
          onDirtyChange(next);
        }}
      />
      <APIErrorAlert error={save.error} />
      <StepActions
        label={t("setup.saveAndContinue")}
        onContinue={() => form.submit()}
        onSkip={onSkip}
        pending={save.isPending}
        dirty={dirty}
      />
    </Flex>
  );
}

function NewEducation({
  address,
  onAdvance,
  onSkip,
  onDirtyChange,
}: Omit<ProfileStepProps, "profile">) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<EducationFormValues>();
  const [dirty, setDirty] = useState(false);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const save = useSaveEducation(address, () => {
    void message.success({
      key: "setup",
      content: t("profileEducation.added"),
    });
    onAdvance(true);
  });
  return (
    <Flex vertical gap="middle">
      <EducationForm
        form={form}
        collapseMore
        onSave={(request) => save.mutate(request)}
        onDirtyChange={(next) => {
          setDirty(next);
          onDirtyChange(next);
        }}
      />
      <APIErrorAlert error={save.error} />
      <StepActions
        label={t("setup.saveAndContinue")}
        onContinue={() => form.submit()}
        onSkip={onSkip}
        pending={save.isPending}
        dirty={dirty}
      />
    </Flex>
  );
}

export function WorkStep({ profile, ...props }: ProfileStepProps) {
  return profile.work_experiences.length === 0 ? (
    <NewWork {...props} />
  ) : (
    <Added
      titles={profile.work_experiences.map(
        (entry) => `${entry.job_title} · ${entry.employer_domain}`,
      )}
      onContinue={() => props.onAdvance(true)}
    />
  );
}

export function EducationStep({ profile, ...props }: ProfileStepProps) {
  return profile.educational_qualifications.length === 0 ? (
    <NewEducation {...props} />
  ) : (
    <Added
      titles={profile.educational_qualifications.map(
        (entry) => `${entry.degree} · ${entry.institution_domain}`,
      )}
      onContinue={() => props.onAdvance(true)}
    />
  );
}

/** Each language saves as it is picked, so this step only continues. */
export function LanguagesStep({
  address,
  profile,
  onAdvance,
  onSkip,
}: ProfileStepProps) {
  const { t } = useTranslation();
  const added = profile.language_abilities.length > 0;
  return (
    <Flex vertical gap="middle">
      <LanguageAbilityLists address={address} profile={profile} />
      <StepActions
        label={t("setup.continue")}
        onContinue={added ? () => onAdvance(true) : undefined}
        onSkip={added ? undefined : onSkip}
      />
    </Flex>
  );
}
