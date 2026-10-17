import "antd/dist/reset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./app/App";
import { AppProviders } from "./app/AppProviders";
import "./i18n";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The application root element is missing");
}

// A data router lets a page with unsaved edits block navigation; App still
// declares its routes itself, below one catch-all route.
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AppProviders>
        <App />
      </AppProviders>
    ),
  },
]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
