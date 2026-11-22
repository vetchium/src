import { App, Button, Flex, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { ApplicationsBanner } from "../features/home/ApplicationsBanner";
import { EverydayHome } from "../features/home/EverydayHome";
import { HomeSetup } from "../features/home/HomeSetup";
import { OpeningSearchBox } from "../features/home/OpeningSearchBox";
import { completedSteps } from "../features/home/setupSteps";
import {
  useMyInfoQuery,
  usePublicProfileQuery,
} from "../features/profile/queries";

function HomeContent({
  me,
  profile,
}: {
  me: MyInfoResponse;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  // Latched, so completing the last item, such as a first language, does not
  // take the step away before the person continues.
  const [unfinished, setUnfinished] = useState(() =>
    Object.values(completedSteps(me, profile)).includes(false),
  );
  const setup = unfinished && !me.job_search_prompt_dismissed;
  const title = useRef<HTMLHeadingElement>(null);
  const wasSetup = useRef(setup);
  useEffect(() => {
    if (wasSetup.current && !setup) title.current?.focus();
    wasSetup.current = setup;
  }, [setup]);

  return (
    <>
      <div>
        <Typography.Title
          ref={title}
          tabIndex={-1}
          level={1}
          style={{
            marginTop: 0,
            marginBottom: 4,
            outline: "none",
            overflowWrap: "anywhere",
          }}
        >
          {t(setup ? "setup.welcome" : "home.title", {
            name: me.display_name,
          })}
        </Typography.Title>
        {setup ? (
          <Typography.Text type="secondary">
            {t("setup.description")}
          </Typography.Text>
        ) : null}
      </div>
      <ApplicationsBanner />
      {setup ? (
        <>
          <HomeSetup
            me={me}
            profile={profile}
            onFinish={() => {
              void message.success({
                key: "setup",
                content: t("setup.finished"),
              });
              setUnfinished(false);
            }}
          />
          <Flex align="baseline" gap="middle" wrap>
            <Typography.Text type="secondary">
              {t("home.justLooking")}
            </Typography.Text>
            <div style={{ flex: "1 1 280px", maxWidth: 520 }}>
              <OpeningSearchBox />
            </div>
          </Flex>
        </>
      ) : (
        <EverydayHome me={me} profile={profile} />
      )}
    </>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const profile = usePublicProfileQuery(me?.handle ?? "", me !== undefined);
  if (me === undefined) return null;

  return (
    <Flex vertical gap="large" className="full-width">
      <title>{t("home.documentTitle")}</title>
      {profile.data !== undefined ? (
        // Keyed so another account starts from its own setup state.
        <HomeContent key={me.handle} me={me} profile={profile.data} />
      ) : profile.isError ? (
        <>
          {/* Only after a failure: which greeting fits needs the profile. */}
          <Typography.Title level={1} style={{ margin: 0 }}>
            {t("home.title", { name: me.display_name })}
          </Typography.Title>
          <ApplicationsBanner />
          <APIErrorAlert error={profile.error} />
          <Button
            style={{ alignSelf: "flex-start" }}
            onClick={() => void profile.refetch()}
          >
            {t("common.retry")}
          </Button>
          <OpeningSearchBox size="large" />
        </>
      ) : (
        <Spin aria-label={t("home.profileLoading")} />
      )}
    </Flex>
  );
}
