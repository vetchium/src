import "antd/dist/reset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import { AppProviders } from "./app/AppProviders";
import "./i18n";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The application root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);
