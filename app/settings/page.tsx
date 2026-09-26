import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { visibleCategories } from "./catalog";
import { SettingsGrid } from "./SettingsGrid";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/**
 * /settings — the Setup directory.
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
        {categories.length === 0 ? (
          /*
            Reachable: /settings is not itself role-gated, and the top nav hides
            it for a Recruiter rather than blocking the URL. A plain statement
            beats a redirect loop or an empty grid.
          */
          <>
            <h1 className="settings-head__title mb-4">Setup</h1>
            <div className="card">
              <h2 className="title is-5">Nothing here for your role</h2>
              <p className="has-text-secondary" style={{ fontSize: 14 }}>
                There are no settings you can change. An Owner or Admin manages this product&apos;s
                configuration.
              </p>
            </div>
          </>
        ) : (
          // The heading lives in the grid: it shares a row with the search box.
          <SettingsGrid categories={categories} />
        )}
      </div>
    </AppShell>
  );
}
