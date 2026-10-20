import { useState } from "react";
import { get, patch, post } from "./api";
import { Alert, Badge, Empty, fmtDateTime, humanize, Loading, Panel, statusTone, useAction, useLoad } from "./ui";

export function AdminOverview() {
  const s = useLoad(() => get<Record<string, number>>("/admin/summary"), []);
  if (s.loading) return <Loading />;
  if (s.error) return <Alert kind="error">{s.error}</Alert>;
  const labels: Array<[string, string]> = [["users", "Users"], ["patients", "Patients"], ["pendingDoctors", "Doctors awaiting verification"], ["pendingPharmacies", "Pharmacies awaiting verification"], ["verifiedDoctors", "Verified doctors"], ["verifiedPharmacies", "Verified pharmacies"], ["openComplaints", "Open complaints"], ["appointments", "Appointments"], ["orders", "Orders"]];
  return <div className="stat-grid">{labels.map(([k, l]) => <div key={k} className="stat"><strong>{s.data![k]}</strong><span>{l}</span></div>)}</div>;
}

export function Verifications() {
  const list = useLoad(() => get<{ verifications: any[] }>("/admin/verifications"), []);
  const action = useAction();
  const decide = async (userId: string, decision: string) => {
    const note = decision === "rejected" ? prompt("Reason (shown to the applicant)?") ?? undefined : undefined;
    if (decision === "rejected" && !note) return;
    if (await action.run(() => post(`/admin/verifications/${userId}`, { decision, ...(note ? { note } : {}) }))) list.reload();
  };
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Doctor & pharmacy verification" kicker="Check licences against the issuing authority before approving">
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.data!.verifications.length === 0 ? <Empty title="Nothing to review" /> :
        <ul className="list">{list.data!.verifications.map((v) => (
          <li key={v.id}><div><strong>{v.name}</strong><small>{humanize(v.kind)} · {v.email} · licence {v.licenseNo}</small><small>{v.kind === "doctor" ? `${v.specialty} · ${v.qualifications}` : v.address}</small>{v.demo && <small>Fictitious demo account</small>}</div>
            <div className="row-actions"><Badge tone={statusTone(v.verification)}>{humanize(v.verification)}</Badge>
              {v.verification !== "verified" && <button className="button button-small" onClick={() => decide(v.userId, "verified")}>Verify</button>}
              {v.verification !== "rejected" && <button className="outline-button" onClick={() => decide(v.userId, "rejected")}>Reject</button>}
              {v.verification === "verified" && <button className="outline-button" onClick={() => decide(v.userId, "pending")}>Revoke</button>}</div></li>))}</ul>}
    </Panel>
  );
}

export function Users() {
  const list = useLoad(() => get<{ users: any[] }>("/admin/users"), []);
  const action = useAction();
  const set = async (id: string, status: string) => { if (await action.run(() => patch(`/admin/users/${id}/status`, { status }))) list.reload(); };
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Users">
      {action.error && <Alert kind="error">{action.error}</Alert>}
      <p className="muted">Administrators can manage accounts but have no screens for patient health records.</p>
      <ul className="list">{list.data!.users.map((u) => (
        <li key={u.id}><div><strong>{u.name}</strong><small>{u.email} · {humanize(u.role)}</small></div>
          <div className="row-actions"><Badge tone={statusTone(u.status)}>{humanize(u.status)}</Badge>
            {u.role !== "admin" && (u.status === "active" ? <button className="outline-button" onClick={() => confirm(`Suspend ${u.name}?`) && set(u.id, "suspended")}>Suspend</button> : <button className="outline-button" onClick={() => set(u.id, "active")}>Reactivate</button>)}</div></li>))}</ul>
    </Panel>
  );
}

export function Complaints() {
  const list = useLoad(() => get<{ complaints: any[] }>("/admin/complaints"), []);
  const [res, setRes] = useState<Record<string, string>>({});
  const action = useAction();
  const set = async (id: string, status: string) => { if (await action.run(() => patch(`/admin/complaints/${id}`, { status, ...(res[id] ? { resolution: res[id] } : {}) }))) list.reload(); };
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Complaints & reports">
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.data!.complaints.length === 0 ? <Empty title="No complaints" /> :
        <ul className="rx-list">{list.data!.complaints.map((c) => (
          <li key={c.id} className="rx-card"><header><div><strong>{c.subject}</strong><small>From {c.reporter ?? "unknown"} · {fmtDateTime(c.createdAt)}</small></div><Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge></header>
            <p>{c.details}</p>{c.resolution && <small>Resolution: {c.resolution}</small>}
            {c.status === "open" && <div className="row-actions"><input aria-label="Resolution note" placeholder="Resolution note" value={res[c.id] ?? ""} onChange={(e) => setRes({ ...res, [c.id]: e.target.value })} /><button className="button button-small" onClick={() => set(c.id, "resolved")}>Resolve</button><button className="outline-button" onClick={() => set(c.id, "dismissed")}>Dismiss</button></div>}</li>))}</ul>}
    </Panel>
  );
}

export function AuditLog() {
  const list = useLoad(() => get<{ logs: any[] }>("/admin/audit"), []);
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Audit trail" kicker="Latest 200 privileged and sensitive actions">
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>{list.data!.logs.map((l) => <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{l.actor ?? "—"}</td><td>{l.action}</td><td>{l.target ?? "—"}</td></tr>)}</tbody></table></div>
    </Panel>
  );
}
