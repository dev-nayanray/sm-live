/**
 * SM Live — Super Admin User Detail page (Prompt 03).
 *
 * Route: /users/:id  (under the existing Layout + RequirePerm perm="users.read")
 *
 * Renders six sections, each permission-gated per the perms object returned
 * by the backend:
 *   A. Basic profile           — always
 *   B. Account activity          — restrictions + audit history (perms.canViewSecurity)
 *   C. Wallet summary           — perms.canViewWallet
 *   D. Game activity            — perms.canViewRounds
 *   E. Live platform activity   — perms.canViewRooms
 *   F. Administrative history   — perms.canViewNotes + perms.canViewSecurity
 *
 * All data comes from a single GET /v1/admin/users/:id call (one round-trip);
 * writes (edit profile, restrict, add note, lift restriction) invalidate
 * the cache and trigger a refetch.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, Skeleton } from "../components/ui";
import { Avatar, EditUserDialog, RestrictionDialog, UserStatusBadge, AdminNoteForm, type AdminNote } from "../components/users";
import { Icon } from "../components/Icon";

interface UserDetail {
  profile: {
    id: number;
    displayName: string;
    avatarUrl: string;
    phone: string | null;
    email: string | null;
    marketCode: string;
    country: string;
    vipLevel: number;
    nobleLevel: number;
    isBot: boolean;
    agency: { id: number; name: string; code: string } | null;
    createdAt: string;
    updatedAt: string;
    contactMasked: boolean;
  };
  restrictions: {
    id: number;
    type: string;
    reason: string;
    expiresAt: string | null;
    createdAt: string;
    createdBy: number;
    creator: { id: number; username: string; displayName: string } | null;
  }[];
  wallet: {
    balance: number;
    frozen: boolean;
    updatedAt: string | null;
    totalCredits: number;
    totalDebits: number;
    ledgerRecent: { id: string; kind: string; amount: number; balanceAfter: number; txKey: string; createdAt: string }[];
  } | null;
  bets: { id: number; amount: number; status: string; createdAt: string; game: { code: string; name: string }; round: { roundId: string; status: string; startedAt: string; endedAt: string | null } | null }[];
  sessions: { id: number; sessionKey: string; openedAt: string; closedAt: string | null; game: { code: string; name: string } }[];
  gifts: { id: number; quantity: number; totalPrice: number; createdAt: string; gift: { name: string }; sender: { id: number; displayName: string }; recipient: { id: number; displayName: string } }[];
  complaints: { id: number; subject: string; body: string; status: string; createdAt: string }[];
  roomParticipations: { id: number; role: string; joinedAt: string; leftAt: string | null; room: { id: number; title: string; type: string; closedAt: string | null } }[];
  roomsCreated: { id: number; title: string; type: string; createdAt: string; closedAt: string | null }[];
  adminNotes: AdminNote[];
  auditHistory: { id: number; action: string; entity: string; entityId: string | null; before: unknown; after: unknown; ip: string; createdAt: string; admin: { id: number; username: string; displayName: string } | null }[];
  perms: {
    canViewWallet: boolean;
    canViewRounds: boolean;
    canViewRooms: boolean;
    canViewContact: boolean;
    canViewSecurity: boolean;
    canViewNotes: boolean;
    canEdit: boolean;
    canRestrict: boolean;
    canWalletWrite: boolean;
  };
  ledgerSum: number;
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [confirmLift, setConfirmLift] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["user-detail", userId],
    queryFn: () => api<UserDetail>(`/v1/admin/users/${userId}`),
    enabled: !Number.isNaN(userId) && userId > 0,
  });

  if (Number.isNaN(userId) || userId <= 0) {
    return <ErrorBox error={new Error("Invalid user id")} />;
  }
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Empty text="User not found." />;

  const d = q.data;
  const derivedStatus = d.restrictions.some((r) => r.type === "ban" && (r.expiresAt === null || new Date(r.expiresAt) > new Date()))
    ? "banned"
    : d.restrictions.some((r) => r.type === "freeze_wallet" && (r.expiresAt === null || new Date(r.expiresAt) > new Date()))
    ? "frozen"
    : d.restrictions.some((r) => r.type === "mute" && (r.expiresAt === null || new Date(r.expiresAt) > new Date()))
    ? "muted"
    : d.restrictions.some((r) => r.expiresAt === null || new Date(r.expiresAt) > new Date())
    ? "restricted"
    : "active";

  const handleEdit = async (input: { displayName: string; country: string; agencyId: number | null; vipLevel: number; nobleLevel: number; avatarUrl: string }) => {
    await api(`/v1/admin/users/${userId}`, { method: "PUT", json: input });
    setToast("Profile updated");
    void qc.invalidateQueries({ queryKey: ["user-detail", userId] });
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const handleRestrict = async (input: { type: "ban" | "mute" | "freeze_wallet" | "kick"; reason: string; durationDays: string; note: string }) => {
    const days = input.durationDays ? Number(input.durationDays) : undefined;
    await api(`/v1/admin/users/${userId}/restrict`, {
      method: "POST",
      json: { type: input.type, reason: input.reason, ...(days ? { durationDays: days } : {}), note: input.note },
    });
    setToast(`Restriction applied: ${input.type}`);
    void qc.invalidateQueries({ queryKey: ["user-detail", userId] });
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["users-summary"] });
  };

  const handleLift = async (rid: number) => {
    await api(`/v1/admin/users/${userId}/restrictions/${rid}`, { method: "DELETE" });
    setToast("Restriction lifted");
    void qc.invalidateQueries({ queryKey: ["user-detail", userId] });
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["users-summary"] });
  };

  const handleAddNote = async (input: { category: string; body: string; internal: boolean }) => {
    await api(`/v1/admin/users/${userId}/notes`, {
      method: "POST",
      json: { userId, ...input },
    });
    setToast("Note added");
    void qc.invalidateQueries({ queryKey: ["user-detail", userId] });
  };
  const handleDeleteNote = async (nid: number) => {
    await api(`/v1/admin/users/${userId}/notes/${nid}`, { method: "DELETE" });
    setToast("Note deleted");
    void qc.invalidateQueries({ queryKey: ["user-detail", userId] });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/users" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <Icon name="chevronLeft" className="h-4 w-4" /> Users
          </Link>
          <Avatar name={d.profile.displayName} url={d.profile.avatarUrl || undefined} size={48} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{d.profile.displayName}</h1>
              <UserStatusBadge status={derivedStatus} />
              {d.profile.isBot && <Badge tone="slate">bot</Badge>}
            </div>
            <div className="text-xs text-slate-400">
              #{d.profile.id} · joined {d.profile.createdAt.slice(0, 10)} · {d.profile.country} · market {d.profile.marketCode}
              {d.profile.agency && <> · agency <Link to="/users" className="text-violet-600 dark:text-violet-300">{d.profile.agency.name}</Link></>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {d.perms.canEdit && <Button variant="ghost" onClick={() => setEditOpen(true)}>Edit profile</Button>}
          {d.perms.canRestrict && <Button onClick={() => setRestrictOpen(true)}>Apply restriction</Button>}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-slate-300 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* A. Basic profile */}
        <Card title="Basic profile">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-400">Display name</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.displayName}</dd>
            <dt className="text-slate-400">User ID</dt>
            <dd className="font-mono text-slate-700 dark:text-slate-200">#{d.profile.id}</dd>
            <dt className="text-slate-400">Phone</dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {d.profile.phone ?? "—"}
              {d.profile.contactMasked && <span className="ml-2 text-xs text-amber-500">masked (no players.read)</span>}
            </dd>
            <dt className="text-slate-400">Email</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.email ?? "—"}</dd>
            <dt className="text-slate-400">Country</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.country}</dd>
            <dt className="text-slate-400">Market</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.marketCode}</dd>
            <dt className="text-slate-400">VIP / Noble</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.vipLevel} / {d.profile.nobleLevel}</dd>
            <dt className="text-slate-400">Agency</dt>
            <dd className="text-slate-700 dark:text-slate-200">{d.profile.agency?.name ?? "—"}</dd>
            <dt className="text-slate-400">Registered</dt>
            <dd className="text-slate-700 dark:text-slate-200">{new Date(d.profile.createdAt).toLocaleString()}</dd>
            <dt className="text-slate-400">Profile updated</dt>
            <dd className="text-slate-700 dark:text-slate-200">{new Date(d.profile.updatedAt).toLocaleString()}</dd>
          </dl>
        </Card>

        {/* B. Account activity — restrictions + complaints + suspicious */}
        <Card title={`Account activity — restrictions (${d.restrictions.length})`}>
          {d.restrictions.length === 0 ? (
            <Empty text="No restrictions on record." />
          ) : (
            <ul className="space-y-2 text-sm">
              {d.restrictions.map((r) => {
                const active = r.expiresAt === null || new Date(r.expiresAt) > new Date();
                return (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge tone={r.type === "ban" ? "red" : r.type === "freeze_wallet" ? "violet" : "amber"}>{r.type}</Badge>
                        {active ? <Badge tone="green">active</Badge> : <Badge tone="slate">expired</Badge>}
                      </div>
                      {active && d.perms.canRestrict && (
                        <button type="button" onClick={() => setConfirmLift(r.id)} className="text-xs text-rose-600 hover:underline">
                          Lift
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-slate-600 dark:text-slate-300">{r.reason || "—"}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      created {r.createdAt.slice(0, 19).replace("T", " ")} · expires {r.expiresAt ? r.expiresAt.slice(0, 19).replace("T", " ") : "permanent"} · by admin #{r.createdBy}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* C. Wallet summary — only when perms.canViewWallet */}
        {d.perms.canViewWallet && d.wallet && (
          <Card title="Wallet summary" actions={<Badge tone="violet">coins</Badge>}>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Balance</div>
                <div className={`text-xl font-bold ${d.wallet.frozen ? "text-violet-600 dark:text-violet-400" : "text-slate-800 dark:text-slate-100"}`}>
                  {d.wallet.balance.toLocaleString()}
                </div>
                {d.wallet.frozen && <Badge tone="violet">frozen</Badge>}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Total credits</div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{d.wallet.totalCredits.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Total debits</div>
                <div className="text-xl font-bold text-rose-600 dark:text-rose-400">{d.wallet.totalDebits.toLocaleString()}</div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Current balance vs historical totals. Canonical ledger records only — pending and failed recharges are excluded.
            </p>
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-slate-400">Recent ledger entries</div>
              {d.wallet.ledgerRecent.length === 0 ? (
                <Empty text="No transactions." />
              ) : (
                <ul className="space-y-1 text-xs">
                  {d.wallet.ledgerRecent.map((e) => (
                    <li key={e.id} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
                      <span className="font-mono">{e.kind}</span>
                      <span className={e.amount >= 0 ? "text-emerald-600" : "text-rose-600"}>{e.amount >= 0 ? "+" : ""}{e.amount.toLocaleString()}</span>
                      <span className="text-slate-400">{e.balanceAfter.toLocaleString()}</span>
                      <span className="text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {d.perms.canWalletWrite && (
              <div className="mt-3 text-right">
                <Link to="/wallet" className="text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300">
                  Open wallet tools →
                </Link>
              </div>
            )}
          </Card>
        )}

        {/* D. Game activity */}
        {d.perms.canViewRounds && (
          <Card title={`Game activity — bets (${d.bets.length}) · sessions (${d.sessions.length})`}>
            {d.bets.length === 0 ? (
              <Empty text="No bets on record." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-1">Game</th><th>Amount</th><th>Status</th><th>Round</th><th>Time</th>
                  </tr></thead>
                  <tbody>
                    {d.bets.slice(0, 10).map((b) => (
                      <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-1">{b.game.code}</td>
                        <td>{b.amount.toLocaleString()}</td>
                        <td><Badge tone={b.status === "won" ? "green" : b.status === "lost" ? "red" : "slate"}>{b.status}</Badge></td>
                        <td className="font-mono text-slate-400">{b.round?.roundId ?? "—"}</td>
                        <td className="text-slate-400">{b.createdAt.slice(0, 19).replace("T", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* E. Live platform activity */}
        {d.perms.canViewRooms && (
          <Card title={`Live platform activity — rooms hosted (${d.roomsCreated.length}) · participations (${d.roomParticipations.length}) · gifts (${d.gifts.length})`}>
            {d.roomParticipations.length === 0 && d.roomsCreated.length === 0 && d.gifts.length === 0 ? (
              <Empty text="No live-platform activity on record." />
            ) : (
              <div className="space-y-3 text-xs">
                {d.roomsCreated.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-slate-400">Rooms hosted</div>
                    <ul className="space-y-1">
                      {d.roomsCreated.slice(0, 5).map((r) => (
                        <li key={r.id} className="flex justify-between">
                          <span>{r.title}</span>
                          <span className="text-slate-400">{r.type} · {r.createdAt.slice(0, 10)} {r.closedAt && "· closed"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.gifts.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-slate-400">Recent gifts</div>
                    <ul className="space-y-1">
                      {d.gifts.slice(0, 5).map((g) => (
                        <li key={g.id} className="flex justify-between">
                          <span>{g.gift.name} × {g.quantity}</span>
                          <span className="text-slate-400">{g.totalPrice.toLocaleString()} · {g.sender.displayName} → {g.recipient.displayName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Complaints (only when canViewContact) */}
        {d.perms.canViewContact && d.complaints.length > 0 && (
          <Card title={`Complaints (${d.complaints.length})`}>
            <ul className="space-y-1 text-xs">
              {d.complaints.slice(0, 10).map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>{c.subject}</span>
                  <span><Badge tone={c.status === "resolved" ? "green" : "amber"}>{c.status}</Badge> · {c.createdAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* F. Administrative history — notes + audit */}
        {d.perms.canViewNotes && (
          <Card title={`Administrative notes (${d.adminNotes.length})`}>
            <AdminNoteForm userId={userId} notes={d.adminNotes} onAdd={handleAddNote} onDelete={handleDeleteNote} />
          </Card>
        )}
        {d.perms.canViewSecurity && (
          <Card title={`Audit history (${d.auditHistory.length})`}>
            {d.auditHistory.length === 0 ? (
              <Empty text="No admin actions recorded for this user." />
            ) : (
              <ul className="space-y-1 text-xs">
                {d.auditHistory.slice(0, 15).map((a) => (
                  <li key={a.id} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
                    <span><Badge tone="violet">{a.action}</Badge> by {a.admin?.displayName ?? "system"}</span>
                    <span className="text-slate-400">{a.createdAt.slice(0, 19).replace("T", " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <EditUserDialog
        open={editOpen}
        user={q.data ? {
          id: d.profile.id,
          displayName: d.profile.displayName,
          country: d.profile.country,
          agencyId: d.profile.agency?.id ?? null,
          vipLevel: d.profile.vipLevel,
          nobleLevel: d.profile.nobleLevel,
          avatarUrl: d.profile.avatarUrl,
        } : null}
        agencies={[]}
        onClose={() => setEditOpen(false)}
        onSave={handleEdit}
      />
      <RestrictionDialog
        open={restrictOpen}
        user={{ id: userId, displayName: d.profile.displayName }}
        onClose={() => setRestrictOpen(false)}
        onApply={handleRestrict}
      />
      <Modal open={confirmLift !== null} title="Lift restriction?" onClose={() => setConfirmLift(null)}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The restriction will be marked as expired (preserves the audit trail). The user will regain the relevant capabilities immediately.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmLift(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => {
            if (confirmLift !== null) {
              await handleLift(confirmLift);
              setConfirmLift(null);
            }
          }}>Lift restriction</Button>
        </div>
      </Modal>
    </div>
  );
}

// Suppress unused-import warning for Skeleton (used by future skeleton states)
void Skeleton;
