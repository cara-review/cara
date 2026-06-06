// DOM entry point. Vite mounts this from index.html.
import { greeting } from "./app.ts";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) {
  root.textContent = greeting();
}
