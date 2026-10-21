import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth";
import "./styles.css";
import "./theme.css";
import "./motion/motion.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>,
);
