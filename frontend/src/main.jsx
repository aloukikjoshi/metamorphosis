import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Polyfills for DataHaven SDK compatibility
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window.globalThis;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
