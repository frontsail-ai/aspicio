import { mount } from "svelte";
import App from "./App.svelte";

declare global {
  interface Window {
    /** The live viewer instance, exposed for the browser console (and tests). */
    __viewer?: import("@aspicio/core").DxfViewer;
  }
}

const target = document.getElementById("app");
if (target) mount(App, { target });
