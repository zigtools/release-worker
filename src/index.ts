import { Env } from "./env";
import { handlePublish } from "./publish";
import { handleSelectVersion, handleZLSIndex } from "./select-zls-version";

export default {
  async fetch(request, env, _ctx) {
    if (request.method === "OPTIONS") return handleOptions(request);

    let response: Response;
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/v1/zls/select-version":
        response = await handleSelectVersion(request, env);
        break;
      case "/v1/zls/index.json":
        response = await handleZLSIndex(request, env);
        break;
      case "/v1/zls/publish":
        response = await handlePublish(request, env);
        break;
      default:
        response = new Response(null, {
          status: 404, // Not Found
        });
        break;
    }

    response.headers.set(
      "Access-Control-Allow-Origin",
      corsHeaders["Access-Control-Allow-Origin"],
    );
    response.headers.set(
      "Access-Control-Allow-Methods",
      corsHeaders["Access-Control-Allow-Methods"],
    );

    return response;
  },
} satisfies ExportedHandler<Env>;

function handleOptions(request: Request): Response {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    // Preflighted request
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  // standard OPTIONS request.
  return new Response(null, {
    headers: {
      Allow: "GET, HEAD, POST, OPTIONS",
    },
  });
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
