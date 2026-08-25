import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { visibleCategories } from "./catalog";
import { SettingsGrid } from "./SettingsGrid";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * /settings — the landing grid.
 *
 * This used to redirect to whichever section your role could open first, because
 * there was nothing here to land on: navigation lived in a permanent sidebar. Now
 * the landing page IS the navigation, so the redirect is gone.
 *
 * ROLE FILTERING HAPPENS HERE, on the server, before the grid is serialised. A
 * Recruiter's page never contains the Organization link at all — not hidden with
 * CSS, not filtered in the browser. Each destination still re-checks
 * independently, so a typed URL is refused by the page itself; this only decides
 * what is worth offering.
 */
export default async function SettingsIndexPage() {
  const membership = await requireMembershipOrRedirect();
  const categories = visibleCategories(membership.role);

  return (
    <AppShell>
      <div className="settings-landing">
        <div className="mb-5">
          <h1 className="title is-4 mb-1">Settings</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            Configure the product without touching code.
          </p>
        </div>

        {categories.length === 0 ? (
          /*
            Reachable: /settings is not itself role-gated, and the top nav hides
            it for a Recruiter rather than blocking the URL. A plain statement
            beats a redirect loop or an empty grid.
          */
          <div className="card">
            <h2 className="title is-5">Nothing here for your role</h2>
            <p className="has-text-secondary" style={{ fontSize: 14 }}>
              There are no settings you can change. An Owner or Admin manages this product&apos;s
              configuration.
            </p>
          </div>
        ) : (
          <SettingsGrid categories={categories} />
        )}
      </div>
    </AppShell>
  );
}
