import type { ReactNode } from "react";

/** The gallery groups screens by the part of `title` before " · ". */
export interface Screen {
  id: string;
  title: string;
  render: () => ReactNode;
  width?: number;
  dark?: boolean;
}

/** One entry per spec; capture.mjs writes each to mockups/<spec>/. */
export const specs: Record<string, Screen[]> = {};

export const screens: Screen[] = Object.values(specs).flat();
