import { useState } from "react";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { del, get, patch, post, put } from "./api";
import { useAuth } from "./auth";
import { PharmacyChats } from "./PharmacyChat";
import { Link } from "./router";
import { Alert, Badge, Empty, Field, fmtDate, fmtDateTime, humanize, Loading, Modal, Panel, statusTone, SubmitButton, useAction, useLoad } from "./ui";

export function PharmacyOverview() {
  const { profile } = useAuth();
  const orders = useLoad(() => get<{ orders: any[] }>("/orders"), []);
  const open = (orders.data?.orders ?? []).filter((o) => !["delivered", "cancelled", "rejected"].includes(o.status));
  return (
    <div className="grid-2">
      <Panel title="Verification">
        <Badge tone={statusTone(profile?.verification ?? "pending")}>{humanize(profile?.verification ?? "pending")}</Badge>
        <p>{profile?.verification === "verified" ? "You can receive shared prescriptions, quote and fulfil orders." : "Your shop can receive patient messages, but only verified shops can receive orders or manage inventory."}</p>
        {profile?.verificationNote && <small>Note: {profile.verificationNote}</small>}
      </Panel>
      <Panel title="Open orders" action={<Link to="/app/orders" className="text-link">All</Link>}>
        {orders.loading ? <Loading /> : open.length === 0 ? <Empty title="No open orders" /> :
          <ul className="list">{open.map((o) => <li key={o.id}><div><strong>{o.patientName}</strong><small>{o.prescription?.id}</small></div><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge></li>)}</ul>}
      </Panel>
      <PharmacyChats />
    </div>
  );
}

export function PharmacyProfile() {
  const { refresh } = useAuth();
  const prof = useLoad(() => get<{ profile: any }>("/pharmacy/profile"), []);
  const [f, setF] = useState<any>(null);
  const action = useAction();
  if (prof.loading) return <Loading />;
  if (prof.error) return <Alert kind="error">{prof.error}</Alert>;
  const p = f ?? { ...prof.data!.profile, lat: prof.data!.profile.lat ?? "", lng: prof.data!.profile.lng ?? "", hours: prof.data!.profile.hours ?? "" };
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...p, [k]: e.target.value });
  const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => put("/pharmacy/profile", { name: p.name, address: p.address, hours: p.hours, delivery: Boolean(p.delivery), lat: num(String(p.lat)), lng: num(String(p.lng)) }), "Profile saved.")) { prof.reload(); setF(null); refresh(); }
  };
  return (
    <Panel title="Shop details">
      <form className="stack" onSubmit={submit}>
        <div className="grid-2"><Field label="Business name"><input value={p.name} onChange={set("name")} required /></Field><Field label="Address"><input value={p.address} onChange={set("address")} required /></Field>
          <Field label="Opening hours"><input value={p.hours} onChange={set("hours")} placeholder="e.g. Mon–Sat 9:00–21:00" /></Field><label className="check-row"><input type="checkbox" checked={Boolean(p.delivery)} onChange={(e) => setF({ ...p, delivery: e.target.checked })} /> Offer delivery</label>
          <Field label="Latitude"><input inputMode="decimal" value={p.lat} onChange={set("lat")} /></Field><Field label="Longitude"><input inputMode="decimal" value={p.lng} onChange={set("lng")} /></Field></div>
        <small className="muted">Licence {p.licenseNo} (reviewed by an administrator).</small>
        {action.error && <Alert kind="error">{action.error}</Alert>}{action.done && <Alert kind="success">{action.done}</Alert>}
        <SubmitButton busy={action.busy}>Save</SubmitButton>
      </form>
    </Panel>
  );
}

export function Inventory() {
  const list = useLoad(() => get<{ items: any[] }>("/pharmacy/inventory"), []);
  const [f, setF] = useState({ name: "", price: "", stock: "", prescriptionOnly: true });
  const action = useAction();
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => post("/pharmacy/inventory", { name: f.name, price: Number(f.price), stock: Number(f.stock), prescriptionOnly: f.prescriptionOnly }))) { setF({ name: "", price: "", stock: "", prescriptionOnly: true }); list.reload(); }
  };
  const setStock = async (id: string, stock: number) => { if (await action.run(() => patch(`/pharmacy/inventory/${id}`, { stock }))) list.reload(); };
  const remove = async (id: string) => { if (await action.run(() => del(`/pharmacy/inventory/${id}`))) list.reload(); };
  return (
    <div className="grid-2">
      <Panel title="Add product">
        <form className="stack" onSubmit={add}>
          <Field label="Product name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
          <div className="grid-2"><Field label="Unit price"><input type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field><Field label="Stock"><input type="number" min={0} step={1} value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} required /></Field></div>
          <label className="check-row"><input type="checkbox" checked={f.prescriptionOnly} onChange={(e) => setF({ ...f, prescriptionOnly: e.target.checked })} /> Prescription-only</label>
          {action.error && <Alert kind="error">{action.error}</Alert>}
          <SubmitButton busy={action.busy}><Plus size={15} /> Add</SubmitButton>
        </form>
      </Panel>
      <Panel title="Inventory">
        {list.loading ? <Loading /> : list.error ? <Alert kind="error">{list.error}</Alert> : list.data!.items.length === 0 ? <Empty icon={<Boxes size={22} />} title="No products" text="Stock and prices shown to patients come only from what you enter here." /> :
          <ul className="list">{list.data!.items.map((i) => <li key={i.id}><div><strong>{i.name}</strong><small>{i.price} each · {i.prescriptionOnly ? "Prescription-only" : "Over the counter"}</small></div>
            <div className="row-actions"><label className="inline-field">Stock <input type="number" min={0} defaultValue={i.stock} onBlur={(e) => Number(e.target.value) !== i.stock && setStock(i.id, Number(e.target.value))} /></label><button className="icon-btn" aria-label={`Remove ${i.name}`} onClick={() => remove(i.id)}><Trash2 size={15} /></button></div></li>)}</ul>}
      </Panel>
    </div>
  );
}

export function PharmacyOrders() {
  const list = useLoad(() => get<{ orders: any[] }>("/orders"), []);
  const inv = useLoad(() => get<{ items: any[] }>("/pharmacy/inventory"), []);
  const [quoting, setQuoting] = useState<any>(null);
  const action = useAction();
  const status = async (id: string, s: string) => { if (await action.run(() => patch(`/orders/${id}/status`, { status: s }))) list.reload(); };
  const reject = async (id: string) => { const reason = prompt("Reason for rejecting this order?"); if (reason && reason.trim().length >= 3 && await action.run(() => post(`/orders/${id}/reject`, { reason }))) list.reload(); };
  const next: Record<string, string[]> = { received: ["under_review"], confirmed: ["preparing"], preparing: ["dispatched"], dispatched: ["out_for_delivery", "delivered"], out_for_delivery: ["delivered"] };
  if (list.loading) return <Loading />;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  return (
    <Panel title="Incoming prescriptions & orders">
      <Alert>You can review the prescription as written but can't change it. Online payment and live delivery tracking aren't available.</Alert>
      {action.error && <Alert kind="error">{action.error}</Alert>}
      {list.data!.orders.length === 0 ? <Empty title="No orders yet" text="Patients share prescriptions with you after giving consent." /> :
        <ul className="rx-list">{list.data!.orders.map((o) => (
          <li key={o.id} className="rx-card"><header><div><strong>{o.patientName}</strong><small>{o.prescription ? `${o.prescription.id} · issued ${fmtDate(o.prescription.issuedAt)} by ${o.prescription.doctorName}` : "Medicine request"}</small></div><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge></header>
            {o.prescription && <ul className="bullets">{o.prescription.items.map((i: any, n: number) => <li key={n}><strong>{i.name}</strong> — {i.dose}, {i.route}, {i.frequency}, {i.durationDays} days{i.instructions ? `. ${i.instructions}` : ""}</li>)}</ul>}
            {o.medicineRequests?.length > 0 && <><strong>Requested medicines</strong><ul className="bullets">{o.medicineRequests.map((name: string, n: number) => <li key={n}>{name}</li>)}</ul></>}
            {o.attachments?.length > 0 && <div className="stack"><strong>Patient-shared reports and photos</strong>{o.attachments.map((file: any) => <a key={file.id} href={file.url}>{file.name}</a>)}</div>}
            {o.prescription?.status === "revoked" && <Alert kind="error">This prescription was revoked. Do not dispense.</Alert>}
            {o.deliveryAddress && <small>Delivery address: {o.deliveryAddress}</small>}
            {o.quote && <p>Quote total: <strong>{o.quote.total}</strong></p>}
            <ol className="status-trail">{o.history.map((h: any, n: number) => <li key={n}>{humanize(h.status)} <small>{fmtDateTime(h.at)}{h.note ? ` — ${h.note}` : ""}</small></li>)}</ol>
            <div className="row-actions">
              {["received", "under_review", "awaiting_confirmation"].includes(o.status) && <><button className="button button-small" onClick={() => setQuoting(o)}>{o.quote ? "Update quotation" : "Create quotation"}</button><button className="outline-button" onClick={() => reject(o.id)}>Reject</button></>}
              {(next[o.status] ?? []).map((s) => <button key={s} className="outline-button" onClick={() => status(o.id, s)}>Mark {humanize(s).toLowerCase()}</button>)}
            </div></li>))}</ul>}
      {quoting && <QuoteModal order={quoting} inventory={inv.data?.items ?? []} onClose={() => setQuoting(null)} onDone={() => { setQuoting(null); list.reload(); }} />}
    </Panel>
  );
}

function QuoteModal({ order, inventory, onClose, onDone }: { order: any; inventory: any[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Array<{ name: string; qty: string; unitPrice: string }>>(
    (order.prescription?.items?.map((i: any) => i.name) ?? order.medicineRequests ?? [""])
      .map((name: string) => { const stock = inventory.find((s) => s.name.toLowerCase() === name.toLowerCase() && s.stock > 0); return { name, qty: "1", unitPrice: stock ? String(stock.price) : "" }; }));
  const [fee, setFee] = useState("0");
  const [note, setNote] = useState("");
  const action = useAction();
  const total = rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.unitPrice || 0), 0) + Number(fee || 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => post(`/orders/${order.id}/quote`, { items: rows.map((r) => ({ name: r.name, qty: Number(r.qty), unitPrice: Number(r.unitPrice) })), deliveryFee: Number(fee), ...(note ? { note } : {}) }))) onDone();
  };
  const upd = (n: number, k: string, v: string) => setRows(rows.map((r, i) => (i === n ? { ...r, [k]: v } : r)));
  return (
    <Modal title="Quotation" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Alert>Review the request and only quote items you can supply. Prices pre-fill from your inventory when the name matches; check them before sending.</Alert>
        {rows.map((r, n) => <div key={n} className="quote-row"><Field label="Item"><input value={r.name} onChange={(e) => upd(n, "name", e.target.value)} required /></Field><Field label="Qty"><input type="number" min={1} value={r.qty} onChange={(e) => upd(n, "qty", e.target.value)} required /></Field><Field label="Unit price"><input type="number" min={0} step="0.01" value={r.unitPrice} onChange={(e) => upd(n, "unitPrice", e.target.value)} required /></Field>{rows.length > 1 && <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setRows(rows.filter((_, i) => i !== n))}><Trash2 size={15} /></button>}</div>)}
        <Field label="Delivery fee"><input type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        <Field label="Note to patient"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <p><strong>Total: {total.toFixed(2)}</strong></p>
        {action.error && <Alert kind="error">{action.error}</Alert>}
        <SubmitButton busy={action.busy}>Send quotation</SubmitButton>
      </form>
    </Modal>
  );
}
