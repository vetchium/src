import { Breadcrumb } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { paths } from "../../app/paths";

export function openingTitle(opening: OrgOpening): string | undefined {
  return opening.working_content?.title ?? opening.live_content?.title;
}

/**
 * Trail from the Openings list to the current page. The last entry is the
 * current page and is never a link.
 */
export function OpeningsBreadcrumb({
  opening,
  current,
  trail = [],
}: {
  opening?: OrgOpening;
  current?: string;
  /** Pages between the Opening and the current one. */
  trail?: ReadonlyArray<{ label: string; to: string }>;
}) {
  const { t } = useTranslation();
  const openingLabel =
    opening &&
    t("openings.breadcrumbOpening", {
      title: openingTitle(opening) ?? t("openings.untitled"),
      number: opening.opening_number,
    });
  return (
    <Breadcrumb
      items={[
        { title: <Link to={paths.openings}>{t("openings.title")}</Link> },
        ...(opening && openingLabel
          ? [
              {
                title: current ? (
                  <Link to={paths.openingDetail(opening.opening_number)}>
                    {openingLabel}
                  </Link>
                ) : (
                  openingLabel
                ),
              },
            ]
          : []),
        ...trail.map(({ label, to }) => ({
          title: <Link to={to}>{label}</Link>,
        })),
        ...(current ? [{ title: current }] : []),
      ]}
    />
  );
}
