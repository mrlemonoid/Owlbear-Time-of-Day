import OBR from "@owlbear-rodeo/sdk";
import { renderLocalOverlaysFromMetadata, clearLocalOverlays } from "./filterEngine.js";

async function refresh() {
  const ready = await OBR.scene.isReady();
  if (!ready) {
    await clearLocalOverlays();
    return;
  }
  const metadata = await OBR.scene.getMetadata();
  await renderLocalOverlaysFromMetadata(metadata);
}

OBR.onReady(async () => {
  await refresh();

  OBR.scene.onReadyChange(async (ready) => {
    if (ready) await refresh();
    else await clearLocalOverlays();
  });

  OBR.scene.onMetadataChange(renderLocalOverlaysFromMetadata);

  OBR.scene.items.onChange(async () => {
    await refresh();
  });
});
