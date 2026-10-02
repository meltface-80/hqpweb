import { mount } from "svelte";
import "./theme.css";
import App from "./App.svelte";
import { applyTheme } from "./lib/prefs.svelte.ts";

// Before mounting, so the first paint already has the right theme.
applyTheme();
mount(App, { target: document.getElementById("app")! });
