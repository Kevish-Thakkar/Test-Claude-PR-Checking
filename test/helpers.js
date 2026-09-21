const http = require("node:http");
const crypto = require("node:crypto");

function signPayload(payload, secret) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

function startTestServer(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
          await new Promise((r) => server.close(r));
        },
      });
    });
  });
}

async function request(baseUrl, method, path, { headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) {
      init.body = body;
      if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
        init.headers["Content-Type"] = "application/json";
      }
    } else if (typeof body === "object") {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    } else {
      init.body = body;
    }
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function mockFetchSequence(responses) {
  const original = global.fetch;
  let call = 0;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("http://127.0.0.1")) {
      return original(input, init);
    }

    const next = responses[call++];
    if (!next) {
      throw new Error(`Unexpected fetch call #${call}: ${url}`);
    }
    if (typeof next === "function") {
      return next(input, init);
    }
    const { ok = true, status = 200, json, text } = next;
    return {
      ok,
      status,
      async json() {
        return json;
      },
      async text() {
        return text ?? (json !== undefined ? JSON.stringify(json) : "");
      },
    };
  };
  return () => {
    global.fetch = original;
  };
}

module.exports = {
  signPayload,
  startTestServer,
  request,
  mockFetchSequence,
};
