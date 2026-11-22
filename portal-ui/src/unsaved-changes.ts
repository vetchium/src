import { App } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";

/**
 * Asks before leaving the page while `active`: in-app navigation to another
 * path opens a confirmation, and closing or reloading the tab triggers the
 * browser's own prompt. Search-only changes, such as switching tabs, pass.
 * A function is asked as the user leaves, for a page that navigates right
 * after its write, before a render could lower a flag.
 */
export function useUnsavedChangesGuard(
  active: boolean | (() => boolean),
): void {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      (typeof active === "function" ? active() : active),
  );
  const latest = useRef(blocker);
  latest.current = blocker;

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const confirmation = modal.confirm({
      title: t("common.unsavedTitle"),
      content: t("common.unsavedContent"),
      okText: t("common.unsavedLeave"),
      cancelText: t("common.unsavedStay"),
      onOk: () => latest.current.proceed?.(),
      onCancel: () => latest.current.reset?.(),
    });
    // The page may leave by itself meanwhile, once a save in flight ends.
    return () => confirmation.destroy();
  }, [blocker.state, modal, t]);

  useEffect(() => {
    if (!active) return;
    const confirmLeaving = (event: BeforeUnloadEvent) => {
      if (typeof active !== "function" || active()) event.preventDefault();
    };
    window.addEventListener("beforeunload", confirmLeaving);
    return () => window.removeEventListener("beforeunload", confirmLeaving);
  }, [active]);
}
