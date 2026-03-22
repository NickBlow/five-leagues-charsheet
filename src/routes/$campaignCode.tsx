import { createFileRoute } from "@tanstack/react-router";
import CampaignWorkspace from "../components/CampaignWorkspace";
import { loadCampaign } from "../server/campaign-api";

type CampaignRouteParams = {
  campaignCode: string;
};

export const Route = createFileRoute("/$campaignCode" as never)({
  loader: ({ params }) => loadCampaign({ data: { campaignCode: (params as CampaignRouteParams).campaignCode } }),
  component: CampaignPage,
  head: ({ params }) => ({
    meta: [
      { title: `Five Leagues CharSheet - ${(params as CampaignRouteParams).campaignCode}` },
      {
        name: "description",
        content: `Five Leagues campaign tracker for ${(params as CampaignRouteParams).campaignCode}.`,
      },
    ],
  }),
});

function CampaignPage() {
  const { campaignCode } = Route.useParams() as CampaignRouteParams;
  const loaderData = Route.useLoaderData() as Awaited<ReturnType<typeof loadCampaign>>;

  return (
    <CampaignWorkspace
      campaignCode={campaignCode}
      initialSnapshot={loaderData.snapshot}
      initialAssets={loaderData.assets}
    />
  );
}
