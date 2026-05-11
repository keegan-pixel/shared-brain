import { ensureUserOrg } from "@/lib/org";
import { OrgSettingsClient } from "./client";

export default async function OrgSettingsPage() {
  const org = await ensureUserOrg();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rename your brain or update your local Obsidian vault name.
        </p>
      </div>
      <OrgSettingsClient
        initial={{
          name: org.name,
          slug: org.slug,
          vaultName: org.vaultName,
        }}
      />
    </div>
  );
}
