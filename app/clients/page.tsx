import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listClients } from "@/lib/clients/queries";
import { NewClientForm } from "./NewClientForm";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

async function ClientsTable() {
  const membership = await requireMembershipOrRedirect();
  const canManage = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  const { clients, failed } = await listClients({
    organizationId: membership.organization.id,
  });

  if (failed) return <ErrorState message="Couldn't load clients." />;

  return (
    <>
      {canManage && <NewClientForm />}

      <div className="card">
        {clients.length === 0 ? (
          <EmptyState
            message={
              canManage
                ? "No clients yet. Add the companies you recruit for, then attach jobs to them."
                : "No clients yet."
            }
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth is-hoverable">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Account manager</th>
                  <th>Feedback SLA</th>
                  <th>Contacts</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/clients/${client.id}`} style={{ fontWeight: 600 }}>
                        {client.name}
                      </Link>
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {client.account_manager_name ?? "Unassigned"}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {client.feedback_sla_days} day{client.feedback_sla_days === 1 ? "" : "s"}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {client.contacts.length === 0
                        ? "—"
                        : client.contacts.map((contact) => contact.name).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default async function ClientsPage() {
  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Clients</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          The companies you recruit for, and how responsive each one is.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <ClientsTable />
      </Suspense>
    </AppShell>
  );
}
