import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ErrorBox, Modal, useToast } from "./ui";

export function AccountButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post("/auth/change-password", f); setOpen(false); setF({ current_password: "", new_password: "" }); toast("Password updated"); }
    catch (e) { setErr(e); }
  };
  return <>
    <button className="signout" onClick={() => setOpen(true)}>Change password</button>
    {open && <Modal title="Change password" onClose={() => setOpen(false)}>
      <form className="stack" onSubmit={submit}>
        <div><label className="lb" htmlFor="cp1">Current or temporary password</label><input className="in" id="cp1" type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></div>
        <div><label className="lb" htmlFor="cp2">New password (8+ characters)</label><input className="in" id="cp2" type="password" minLength={8} required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></div>
        <ErrorBox error={err} />
        <button className="btn bp">Save password</button>
      </form></Modal>}
  </>;
}
