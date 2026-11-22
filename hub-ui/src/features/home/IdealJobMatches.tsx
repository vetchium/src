import {
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Spin,
  Typography,
  theme,
} from "antd";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { SortIdealJobMatch } from "typespec/hub/openings/search";
import { IdealJobMissingError } from "typespec/problem/hub/openings";
import { isProblem } from "../../api/client";
import { usePreferences } from "../../app/PreferencesContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { countryName } from "../../i18n/countries";
import { useOpeningSearchQuery } from "../openings/queries";

const previewCount = 3;

export function IdealJobMatches({ hasIdealJob }: { hasIdealJob: boolean }) {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const { token } = theme.useToken();
  const matches = useOpeningSearchQuery(
    { sort: SortIdealJobMatch },
    hasIdealJob,
  );
  // Another tab may have cleared the ideal job since my-info was read.
  const missing =
    !hasIdealJob || isProblem(matches.error, IdealJobMissingError.type);
  const found = matches.data?.openings.slice(0, previewCount) ?? [];

  return (
    <Card
      title={t("home.matchesTitle")}
      styles={{
        header: { paddingBlock: token.paddingXS },
        title: { whiteSpace: "normal" },
      }}
      extra={
        !missing && found.length > 0 ? (
          <Link to="/openings?sort=match">{t("home.seeAll")}</Link>
        ) : null
      }
    >
      {missing ? (
        <Flex vertical gap="small" align="flex-start">
          <Typography.Text type="secondary">
            {t("home.matchesNeedIdealJob")}
          </Typography.Text>
          <Link to="/settings/preferences">
            {t("openingSearch.addIdealJob")}
          </Link>
        </Flex>
      ) : matches.isPending ? (
        <Spin aria-label={t("home.matchesLoading")} />
      ) : matches.isError ? (
        <Flex vertical gap="small" align="flex-start">
          <APIErrorAlert error={matches.error} />
          <Button onClick={() => void matches.refetch()}>
            {t("common.retry")}
          </Button>
        </Flex>
      ) : found.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("home.matchesEmpty")}
        >
          <Link to="/openings">{t("home.browseOpenings")}</Link>
        </Empty>
      ) : (
        found.map(({ org, opening }, index) => {
          const path = `/org/${encodeURIComponent(org.domain)}/openings/${opening.opening_number}`;
          return (
            <Fragment key={path}>
              {index > 0 ? <Divider size="small" /> : null}
              <Flex vertical align="flex-start">
                <Link to={path}>
                  <Typography.Text
                    strong
                    style={{ color: "inherit", overflowWrap: "anywhere" }}
                  >
                    {opening.title}
                  </Typography.Text>
                </Link>
                <Typography.Text type="secondary">
                  {[
                    org.display_name,
                    countryName(opening.employing_country, language),
                    t(`orgPage.workArrangements.${opening.work_arrangement}`, {
                      defaultValue: opening.work_arrangement,
                    }),
                  ].join(" · ")}
                </Typography.Text>
              </Flex>
            </Fragment>
          );
        })
      )}
    </Card>
  );
}
