/* eslint-env node */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.cwd(), "dist");
const host = "0.0.0.0";
const port = Number(process.env.PORT || 8090);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(
      new URL(req.url, `http://${req.headers.host}`).pathname,
    );
    const relative =
      urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const target = path.resolve(root, relative);

    if (!target.startsWith(root)) {
      send(res, 403, "Forbidden");
      return;
    }

    const file =
      fs.existsSync(target) && fs.statSync(target).isFile()
        ? target
        : path.join(root, "index.html");
    const ext = path.extname(file).toLowerCase();
    send(
      res,
      200,
      fs.readFileSync(file),
      types[ext] || "application/octet-stream",
    );
  })
  .listen(port, host, () => {
    console.log(`CipherNode web listening on http://${host}:${port}`);
  });
