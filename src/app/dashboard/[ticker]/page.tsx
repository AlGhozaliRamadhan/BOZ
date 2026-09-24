import { permanentRedirect } from 'next/navigation';

export default async function LegacyDashboardTicker({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  permanentRedirect(`/ticker/${encodeURIComponent(ticker)}`);
}
