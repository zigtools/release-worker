import { Env } from "./env";
import { handlePublish } from "./publish";
import { handleSelectZLSVersion } from "./select-zls-version";

export default {
  fetch(request, env, ctx) {
    ctx;
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/v1/select-zls-version":
        return handleSelectZLSVersion(request, env);
      case "/v1/publish":
        return handlePublish(request, env);
      default:
        return new Response(null, {
          status: 404, // Not Found
        });
    }
  },
} satisfies ExportedHandler<Env>;
