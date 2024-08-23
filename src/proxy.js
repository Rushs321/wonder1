import { request } from 'undici';
import { pick } from 'lodash-es';
import { copyHeaders } from './copyHeaders.js';
import { compressImg } from './compress.js';
import { redirect } from './redirect.js';
import { shouldCompress } from './shouldCompress.js';

async function proxy(request, reply) {
  // Avoid loopback that could cause server hang.
  if (
    request.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(request.headers["x-forwarded-for"] || request.ip)
  ) {
    return redirect(request, reply);
  }

  try {
    const origin = await request(request.params.url, {
      headers: {
        ...pick(request.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
        "x-forwarded-for": request.headers["x-forwarded-for"] || request.ip,
        via: "1.1 bandwidth-hero",
      },
      maxRedirections: 4,
    });

    _onRequestResponse(origin, request, reply);
  } catch (err) {
    _onRequestError(request, reply, err);
  }
}

function _onRequestError(request, reply, err) {
  // Ignore invalid URL.
  if (err.code === "ERR_INVALID_URL") {
    return reply.status(400).send("Invalid URL");
  }

  // Redirect and log the error.
  redirect(request, reply);
  console.error(err);
}

function _onRequestResponse(origin, request, reply) {
  if (origin.statusCode >= 400) {
    return redirect(request, reply);
  }

  // Handle redirects
  if (origin.statusCode >= 300 && origin.headers.location) {
    return redirect(request, reply);
  }

  copyHeaders(origin, reply);
  reply.header("content-encoding", "identity");
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
  reply.header("Cross-Origin-Embedder-Policy", "unsafe-none");
  request.params.originType = origin.headers["content-type"] || "";
  request.params.originSize = origin.headers["content-length"] || "0";

  origin.body.on('error', _ => request.socket.destroy());

  if (shouldCompress(request)) {
    // Compress the stream using sharp and pipe it to the response.
    return compressImg(request, reply, origin.body);
  } else {
    // Bypass compression and pipe the original response to the client.
    reply.header("x-proxy-bypass", 1);

    for (const headerName of ["accept-ranges", "content-type", "content-length", "content-range"]) {
      if (headerName in origin.headers) {
        reply.header(headerName, origin.headers[headerName]);
      }
    }

    return origin.body.pipe(reply.raw);
  }
}

export { proxy };
