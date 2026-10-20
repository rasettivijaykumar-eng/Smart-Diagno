import { ShieldCheck, ShieldX } from "lucide-react";
import { get } from "./api";
import { DoctorSearch } from "./DoctorSearch";
import { SiteFooter, SiteHeader } from "./Landing";
import { Alert, fmtDate, Loading, useLoad } from "./ui";

export function PublicDoctors() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="page-narrow">
        <h1 className="page-title">Find a verified doctor</h1>
        <p className="muted">Only registered doctors who passed verification are listed and bookable. Sign in to book.</p>
        <DoctorSearch />
      </main>
      <SiteFooter />
    </>
  );
}

export function VerifyPrescription({ id, token }: { id: string; token: string }) {
  const res = useLoad(() => get<any>(`/verify-prescription/${encodeURIComponent(id)}/${encodeURIComponent(token)}`), [id, token]);
  return (
    <>
      <SiteHeader />
      <main id="main" className="page-narrow">
        <h1 className="page-title">Prescription verification</h1>
        {res.loading ? <Loading /> : res.error ? <Alert kind="error">{res.error}</Alert> : (
          <div className={`verify-card verify-${res.data.result}`}>
            {res.data.result === "valid" ? <ShieldCheck size={34} /> : <ShieldX size={34} />}
            <h2>{res.data.result === "valid" ? "Valid, platform-issued prescription" : res.data.result === "revoked" ? "This prescription has been revoked" : "Not a valid Smart Diagno prescription"}</h2>
            {res.data.result !== "invalid" ? <dl className="kv"><div><dt>Prescription ID</dt><dd>{res.data.prescriptionId}</dd></div><div><dt>Issued</dt><dd>{fmtDate(res.data.issuedAt)}</dd></div><div><dt>Issuing doctor</dt><dd>{res.data.issuer?.name ?? "Unknown"} ({res.data.issuer?.verification ?? "unverified"})</dd></div></dl> : <p>{res.data.message}</p>}
            <small>This confirms status and integrity only. It shows no patient information and says nothing about the authenticity of any medicine.</small>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
