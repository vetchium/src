import { expect, type Locator, type Page } from "@playwright/test";

/** The visible inline-end borders lying on the container's inline-end edge,
 * as offsets within it. */
async function edgeLines(container: Locator) {
  return container.evaluate((root) => {
    const box = root.getBoundingClientRect();
    // Resolves the token as the theme in use paints it.
    const probe = root.appendChild(document.createElement("i"));
    probe.style.color = "var(--ant-color-split)";
    const split = getComputedStyle(probe).color;
    probe.remove();
    return [root, ...root.querySelectorAll("*")].flatMap((node) => {
      const style = getComputedStyle(node);
      const width = Number.parseFloat(style.borderInlineEndWidth);
      const rect = node.getBoundingClientRect();
      if (
        width === 0 ||
        style.borderInlineEndStyle === "none" ||
        style.borderInlineEndColor === "rgba(0, 0, 0, 0)" ||
        rect.height === 0 ||
        Math.abs(rect.right - box.right) > 1
      )
        return [];
      return [
        {
          top: Math.round(rect.top - box.top),
          height: Math.round(rect.height),
          width,
          color:
            style.borderInlineEndColor === split
              ? "colorSplit"
              : style.borderInlineEndColor,
        },
      ];
    });
  });
}

/**
 * Expects one line down the whole sidebar in light and dark, with the menu
 * shorter and taller than the window, and none in the phone's drawer.
 */
export async function expectContinuousNavigationEdge(page: Page) {
  const sidebar = page.getByRole("complementary");
  const content = page.getByRole("main");
  const expectOneLine = async () => {
    for (const height of [1000, 300]) {
      await page.setViewportSize({ width: 1280, height });
      await expect(sidebar.getByRole("menu").last()).toBeVisible();
      await expect
        .poll(async () => {
          const box = await sidebar.boundingBox();
          const beside = await content.boundingBox();
          if (box === null || beside === null) return undefined;
          return {
            width: box.width,
            reachesPageEnd: box.y + box.height >= beside.y + beside.height - 1,
            lines: (await edgeLines(sidebar)).map((line) => ({
              ...line,
              height:
                line.height === Math.round(box.height) ? "full" : line.height,
            })),
          };
        })
        .toEqual({
          width: 232,
          reachesPageEnd: true,
          lines: [{ top: 0, height: "full", width: 1, color: "colorSplit" }],
        });
    }
  };
  const expectNoLineInDrawer = async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("menu").last()).toBeVisible();
    await expect.poll(() => edgeLines(drawer)).toEqual([]);
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
  };

  await expectOneLine();
  await expectNoLineInDrawer();
  await page.setViewportSize({ width: 1280, height: 1000 });
  const toggle = page.getByRole("switch", {
    name: "Switch light or dark mode",
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expectOneLine();
  await expectNoLineInDrawer();
}
