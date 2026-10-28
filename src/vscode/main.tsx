import "./shim";
import React from "react";
import ReactDOM from "react-dom/client";
import { VscodeApp } from "./VscodeApp";
import "../styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <VscodeApp />
  </React.StrictMode>,
);
