/* eslint-env node */
const fs = require("fs");
const path = require("path");

const indexPath = path.resolve(process.cwd(), "dist", "index.html");

let html = fs.readFileSync(indexPath, "utf8");
html = html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');

fs.writeFileSync(indexPath, html);
