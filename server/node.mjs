/* Entry Node cho bản build production.
 *
 * `vite build` sinh ra hai thứ:
 *   dist/client/**        tài nguyên tĩnh (js, css, ảnh)
 *   dist/server/server.js một object `{ fetch(Request): Promise<Response> }`
 *
 * Nó KHÔNG tự mở cổng — đó là chủ đích của TanStack Start, để cùng một bản
 * build chạy được trên Node, Workers, hay serverless. File này là phần Node:
 * cầu nối giữa `node:http` và fetch API, cộng phục vụ file tĩnh.
 *
 * Chạy:  npm run build && npm start        (cổng đổi bằng PORT)
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(process.cwd(), "dist");
const CLIENT = path.join(ROOT, "client");
const PORT = Number(process.env.PORT ?? 3000);

/* pathToFileURL, không phải chuỗi đường dẫn: trên Windows `C:\...` bị ESM
   loader hiểu là scheme "c:" và ném ERR_UNSUPPORTED_ESM_URL_SCHEME. */
const { default: handler } = await import(
  pathToFileURL(path.join(ROOT, "server", "server.js")).href
);

const MIME = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".html": "text/html; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".map": "application/json",
};

/** Trả file tĩnh nếu có; `false` nghĩa là để router xử lý. */
async function serveStatic(req, res, pathname) {
  // Chặn path traversal: chỉ phục vụ thứ nằm THỰC SỰ trong dist/client.
  const abs = path.join(CLIENT, decodeURIComponent(pathname));
  if (!abs.startsWith(CLIENT + path.sep)) return false;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      "content-type": MIME[path.extname(abs)] ?? "application/octet-stream",
      "content-length": st.size,
      // Asset của Vite có hash trong tên nên cache vĩnh viễn được; thứ khác thì không.
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    });
    createReadStream(abs).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function toWebRequest(req, origin) {
  const url = new URL(req.url, origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

const server = createServer(async (req, res) => {
  try {
    const origin = `http://${req.headers.host ?? `localhost:${PORT}`}`;
    const pathname = new URL(req.url, origin).pathname;

    if (req.method === "GET" && pathname !== "/" && await serveStatic(req, res, pathname)) return;

    const webRes = await handler.fetch(toWebRequest(req, origin));
    res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
    if (webRes.body) await Readable.fromWeb(webRes.body).pipe(res);
    else res.end();
  } catch (e) {
    // Không rò chi tiết lỗi ra ngoài; log đủ để truy ở phía server.
    console.error("[server]", e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
