import "./styles.css";
import { App as AntApp, ConfigProvider, theme } from "antd";
import { createRoot } from "react-dom/client";
import { DarkContext } from "./shell";
import { screens } from "./registry";

const params = new URLSearchParams(location.search);
const dark = params.get("theme") === "dark";
const screen = screens.find((s) => s.id === params.get("s"));

function Index() {
  return (
    <div style={{ padding: 32, fontFamily: "system-ui" }}>
      <h1>Mockups</h1>
      <ol>
        {screens.map((s) => (
          <li key={s.id}>
            <a href={`?s=${s.id}`}>{s.id}</a> — {s.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: { colorPrimary: "#2563eb", motion: false },
    }}
  >
    <DarkContext.Provider value={dark}>
      <AntApp>{screen ? screen.render() : <Index />}</AntApp>
    </DarkContext.Provider>
  </ConfigProvider>,
);
