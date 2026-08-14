import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "../components/common/AppShell";

const HomePage = lazy(() =>
  import("../pages/HomePage").then(({ HomePage }) => ({
    default: HomePage,
  })),
);

const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then(({ NotFoundPage }) => ({
    default: NotFoundPage,
  })),
);

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Suspense fallback={<Spin fullscreen size="large" />}>
              <HomePage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<Spin fullscreen size="large" />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
