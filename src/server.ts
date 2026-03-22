import handler from "@tanstack/react-start/server-entry";
export { CampaignStore } from "./server/campaign-store";

const CAMPAIGN_COOKIE_NAME = "five_leagues_campaign";

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/" && url.searchParams.get("picker") !== "1") {
      const campaignCode = readCampaignCookie(request.headers.get("cookie"));
      if (campaignCode) {
        return Response.redirect(new URL(`/${campaignCode}`, url), 302);
      }
    }

    const response = await handler.fetch(request);

    const campaignCode = getCampaignCodeFromPath(url.pathname);
    if (!campaignCode || !isHtmlResponse(response)) {
      return response;
    }

    const nextResponse = new Response(response.body, response);
    nextResponse.headers.append(
      "Set-Cookie",
      `${CAMPAIGN_COOKIE_NAME}=${encodeURIComponent(campaignCode)}; Path=/; SameSite=Lax; Max-Age=31536000`,
    );
    return nextResponse;
  },
} satisfies ExportedHandler<Env>;

function readCampaignCookie(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CAMPAIGN_COOKIE_NAME}=`));

  if (!cookie) {
    return null;
  }

  return normalizeCampaignCode(decodeURIComponent(cookie.slice(CAMPAIGN_COOKIE_NAME.length + 1)));
}

function getCampaignCodeFromPath(pathname: string) {
  const match = pathname.match(/^\/([a-z0-9-]{1,48})\/?$/);
  return match ? normalizeCampaignCode(match[1]) : null;
}

function normalizeCampaignCode(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function isHtmlResponse(response: Response) {
  return response.headers.get("content-type")?.includes("text/html");
}
