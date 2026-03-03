// Polyfills for DataHaven SDK compatibility
import { Buffer } from 'buffer';
import process from 'process';

// Make polyfills available globally
window.global = window.globalThis = window;
if (!window.Buffer) window.Buffer = Buffer;
if (!window.process) window.process = process;

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
