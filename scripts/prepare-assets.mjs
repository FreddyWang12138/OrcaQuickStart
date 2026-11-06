/**
 * Copies the MediaPipe vision WASM runtime and downloads the hand landmark
 * model into /public so the app works fully offline and does not depend on a
 * CDN (which may be unreachable in some networks).
 */
import { mkdir, copyFile, access, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/wasm");
const modelDst = join(root, "public/models/hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

async function copyWasm() {
  await mkdir(wasmDst, { recursive: true });
  const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];
  for (const file of files) {
    const target = join(wasmDst, file);
    const source = join(wasmSrc, file);
    const srcStat = await stat(source);
    const dstStat = await stat(target).catch(() => null);
    if (!dstStat || dstStat.size !== srcStat.size) {
      await copyFile(source, target);
      console.log(`[assets] wasm  ${file}`);
    }
  }
}

async function downloadModel() {
  if (await exists(modelDst)) {
    const size = (await stat(modelDst)).size;
    if (size > 5_000_000) return;
  }
  await mkdir(dirname(modelDst), { recursive: true });
  console.log("[assets] downloading hand_landmarker.task (~7.8 MB)…");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(MODEL_URL);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const total = Number(response.headers.get("content-length") || 0);
      let received = 0;
      let lastTick = 0;
      const stream = Readable.fromWeb(response.body);
      const out = createWriteStream(modelDst);
      stream.on("data", (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastTick > 500) {
          lastTick = now;
          const pct = total ? ` ${Math.round((received / total) * 100)}%` : "";
          process.stdout.write(`\r[assets] model${pct}   `);
        }
      });
      await new Promise((resolve, reject) => {
        stream.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        stream.on("error", reject);
      });
      process.stdout.write("\n");
      console.log("[assets] model ready");
      return;
    } catch (error) {
      console.warn(`[assets] download failed (attempt ${attempt}): ${error.message}`);
      if (attempt === 2) {
        console.warn(
          "[assets] Could not download the model. Download it manually:\n" +
            `  curl -L ${MODEL_URL} -o public/models/hand_landmarker.task`,
        );
      }
    }
  }
}

await copyWasm();
await downloadModel();
