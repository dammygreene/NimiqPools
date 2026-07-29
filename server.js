const http = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const nodeEnv = (process.env.NODE_ENV || "production").trim().toLowerCase();
process.env.NODE_ENV = nodeEnv;
const dev = nodeEnv === "development";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || process.env.npm_config_port || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => {
        const parsedUrl = parse(req.url || "", true);
        handle(req, res, parsedUrl).catch((error) => {
          console.error("Request failed:", error);
          res.statusCode = 500;
          res.end("internal server error");
        });
      })
      .listen(port, hostname, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
      });
  })
  .catch((error) => {
    console.error("Failed to prepare Next app:", error);
    process.exit(1);
  });
