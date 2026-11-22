import type { PublicProfile } from "typespec/hub/profile/public";
import type { MyInfoResponse } from "typespec/hub/users/profile";

/** PROF-JOB-006: the steps of Home's setup, in the order it offers them. */
export const setupSteps = [
  "idealJob",
  "work",
  "education",
  "languages",
  "about",
] as const;

export type SetupStep = (typeof setupSteps)[number];

export function completedSteps(
  me: MyInfoResponse,
  profile: PublicProfile,
): Record<SetupStep, boolean> {
  return {
    idealJob: me.ideal_job !== undefined,
    work: profile.work_experiences.length > 0,
    education: profile.educational_qualifications.length > 0,
    languages: profile.language_abilities.length > 0,
    about: profile.biography !== undefined,
  };
}

/** The step after `step`, wrapping, that still needs something. */
export function nextStep(
  step: SetupStep,
  needsAttention: (candidate: SetupStep) => boolean,
): SetupStep | undefined {
  const at = setupSteps.indexOf(step);
  return [...setupSteps.slice(at + 1), ...setupSteps.slice(0, at)].find(
    needsAttention,
  );
}
