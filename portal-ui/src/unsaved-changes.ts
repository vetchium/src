import { App } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

/**
 * Asks before leaving the page while `active`: in-app navigation to another
 * path opens a confirmation, and closing or reloading the tab triggers the
 * browser's own prompt. Search-only changes, such as switching tabs, pass.
 */
export function useUnsavedChangesGuard(active: boolean): void {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
  );
  const latest = useRef(blocker);
  latest.current = blocker;

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    modal.confirm({
      title: t("common.unsavedTitle"),
      content: t("common.unsavedContent"),
      okText: t("common.unsavedLeave"),
      cancelText: t("common.unsavedStay"),
      onOk: () => latest.current.proceed?.(),
      onCancel: () => latest.current.reset?.(),
    });
  }, [blocker.state, modal, t]);

  useEffect(() => {
    if (!active) return;
    const confirmLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", confirmLeaving);
    return () => window.removeEventListener("beforeunload", confirmLeaving);
  }, [active]);
}
