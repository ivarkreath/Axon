import { createRoot } from "react-dom/client";
import App from "./App";
import { editor } from "./editor/store";
import { loadFonts } from "./rendering/text";
import "./styles.css";
async function boot() {
  await loadFonts();
  const session = await window.axon.init();
  editor.load(session);
  createRoot(document.getElementById("root")!).render(
    <App initial={session} />,
  );
}
void boot().catch((error) => {
  const root = document.getElementById("root")!;
  root.className = "startup-error";
  root.textContent = "Не удалось запустить Axon. " + String(error);
});
