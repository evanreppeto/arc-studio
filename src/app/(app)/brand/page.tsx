import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getBrandProfileView } from "@/lib/brand-kit/profile-view";

import { BrandView } from "./_components/brand-view";
import "./brand.css";

export const metadata = { title: "Brand — Arc Studio" };

export default async function BrandPage() {
  // Correctly silent (BSR-546): (app)/layout.tsx is the auth boundary; a null
  // context here renders a coherent empty state, not a false claim about data.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const brandName = ctx?.orgName?.trim() || "Your workspace";
  const view = await getBrandProfileView(ctx?.orgId ?? "", brandName, ctx?.workspaceId);
  return <BrandView view={view} />;
}
