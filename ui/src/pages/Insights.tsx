import { useInsightsData } from "../insights/useInsightsData";
import { T1Insights } from "../templates/t1/Insights";

// Single-template UI now. The previous T1..T10 dispatcher is gone.
export function InsightsPage() {
  const handle = useInsightsData();
  return <T1Insights handle={handle} />;
}
