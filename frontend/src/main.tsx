import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { Web3Provider } from "./wallet/Web3Provider";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Web3Provider>
      <App />
    </Web3Provider>
  </StrictMode>,
);
