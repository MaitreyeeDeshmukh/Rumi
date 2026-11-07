"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { Button } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { APPT } from "@/content/appointments";
import { SCAN } from "@/content/appointmentScan";
import { CARE_KEYS, newId } from "@/features/appointments/appointments";
import { buildScannedAppointment, guessCare } from "@/features/appointmentScan/toAppointment";
import { SCAN_TEXT_MAX, type ScanFieldsT } from "@/features/shared/schemas";
import type { ApiResult, CareType, RumiState } from "@/features/shared/types";
import { SAMPLE_LETTER } from "@/fixtures/sampleLetter";
import { appointmentPhotoCall, appointmentScanCall } from "@/lib/api/calls";
import { fill } from "@/lib/fill";
import { useRumi } from "@/lib/rumiActive";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { MAX_APPOINTMENTS } from "@/lib/storage-schema";

const FILE_MAX_BYTES = 25_000_000;
const isImage = (f: File): boolean => /^image\/(?:jpeg|png|webp)$/.test(f.type);
const isText = (f: File): boolean => f.type.startsWith("text/") || /\.(?:txt|md)$/i.test(f.name);

interface Draft {
  fields: ScanFieldsT;
  text: string;
  kind: "text" | "image";
  name: string;
  degraded: boolean;
}

/** /appointments/new, third way in: paste a letter or add a photo, then check every field and save. */
export function ScanAppointment({ onType }: { onType: () => void }) {
  const [draft, setDraft] = useState(null as Draft | null);
  return draft ? <ScanConfirm draft={draft} onBack={() => setDraft(null)} /> : <ScanIntake onRead={setDraft} onType={onType} />;
}

function ScanIntake({ onRead, onType }: { onRead: (d: Draft) => void; onType: () => void }) {
  const { state } = useRumi();
  const { show } = useCrisis();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null as File | null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = useRef(null as HTMLInputElement | null);

  const choose = async (f: File | undefined) => {
    setProblem("");
    if (!f) return setFile(null);
    if (f.size > FILE_MAX_BYTES) return fail(SCAN.tooBigFile);
    if (isText(f)) {
      try {
        setText((await f.text()).replace(/\r\n/g, "\n").trim().slice(0, SCAN_TEXT_MAX));
        setFile(null);
      } catch {
        fail(SCAN.readFailed);
      }
    } else if (isImage(f)) setFile(f);
    else fail(SCAN.badFile);
  };
  const fail = (message: string) => {
    setProblem(message);
    setFile(null);
    if (picker.current) picker.current.value = "";
  };
  const removeFile = () => {
    setFile(null);
    if (picker.current) picker.current.value = "";
  };

  const done = (res: ApiResult<{ fields: ScanFieldsT; degraded?: boolean; text?: string }>, kind: Draft["kind"], name: string, pasted: string) => {
    if (res.ok) return onRead({ fields: res.data.fields, text: res.data.text ?? pasted, kind, name, degraded: res.data.degraded === true });
    if ("crisis" in res) return show();
    setProblem(SCAN.readFailed);
  };

  const read = async () => {
    if (!file && !text.trim()) return setProblem(SCAN.needSomething);
    setProblem("");
    setBusy(true);
    try {
      if (file) {
        const photo = await shrinkPhoto(file);
        if (!photo) return setProblem(SCAN.badFile);
        done(await appointmentPhotoCall(photo), "image", file.name || SCAN.photoName, "");
      } else {
        const pasted = text.trim().slice(0, SCAN_TEXT_MAX);
        done(await appointmentScanCall(state, { text: pasted, companionName: state.settings.companionName }), "text", SCAN.docName, pasted);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Notice tone="warn" title={SCAN.sampleTitle}>
        <p>{SCAN.sampleBody}</p>
        <p>{SCAN.sendBody}</p>
      </Notice>
      <Field id="scan-text" label={SCAN.pasteLabel} hint={SCAN.pasteHint}>
        <textarea
          rows={9}
          maxLength={SCAN_TEXT_MAX}
          className={fieldControlClass}
          value={text}
          onChange={(e) => (setText(e.target.value), setProblem(""))}
        />
      </Field>
      <div>
        <Button kind="tertiary" onClick={() => (setText(SAMPLE_LETTER), setFile(null), setProblem(""))}>
          {SCAN.useSample}
        </Button>
      </div>
      <Field id="scan-file" label={SCAN.fileLabel} hint={SCAN.fileHint}>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,text/plain,.txt,.md"
          className={fieldControlClass}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </Field>
      {file ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 font-bold">{fill(SCAN.fileChosen, { name: file.name })}</p>
          <Button kind="tertiary" onClick={removeFile}>
            {SCAN.fileRemove}
          </Button>
        </div>
      ) : null}
      <p role="alert" className="m-0 min-h-6 font-bold text-danger">
        {problem}
      </p>
      <p role="status" className="m-0 min-h-6 text-muted-ink">
        {busy ? SCAN.reading : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" arrow disabled={busy} onClick={() => void read()}>
          {SCAN.read}
        </Button>
        <Button kind="tertiary" onClick={onType}>
          {SCAN.typeInstead}
        </Button>
      </div>
    </div>
  );
}

function ScanConfirm({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const { update } = useRumi();
  const router = useRouter();
  const f = draft.fields;
  const [care, setCare] = useState(guessCare(f) as CareType);
  const [provider, setProvider] = useState(f.provider);
  const [clinic, setClinic] = useState(f.clinic);
  const [date, setDate] = useState(f.date);
  const [time, setTime] = useState(f.time);
  const [address, setAddress] = useState(f.address);
  const [department, setDepartment] = useState(f.department);
  const [reason, setReason] = useState(f.reason);
  const [instructions, setInstructions] = useState(f.instructions.join("\n"));
  const [bring, setBring] = useState(f.bring.join("\n"));
  const [problem, setProblem] = useState("");
  const none = (v: string): string | undefined => (v.trim() === "" ? SCAN.notFound : undefined);
  const nothingFound = Object.values(f).every((v) => (Array.isArray(v) ? v.length === 0 : v === ""));

  const save = () => {
    if (!provider.trim() && !clinic.trim()) return setProblem(SCAN.needWho);
    if (!date || !time) return setProblem(SCAN.needWhen);
    const a = buildScannedAppointment(
      { care, provider, clinic, date, time, address, department, reason, instructions, bring, text: draft.text, docKind: draft.kind, docName: draft.name },
      newId("a"),
      newId("d"),
      new Date(),
    );
    update((d: RumiState) => {
      d.appointments = [...(d.appointments ?? []), a].slice(-MAX_APPOINTMENTS);
    });
    router.push(`/appointment?id=${a.id}`);
  };
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => (set(e.target.value), setProblem(""));

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="mt-0 mb-1 text-xl">{SCAN.confirmTitle}</h2>
        <p className="m-0 text-muted-ink">{SCAN.confirmLead}</p>
      </div>
      {draft.degraded ? (
        <Notice tone="info">
          <p>{SCAN.degraded}</p>
        </Notice>
      ) : null}
      {nothingFound ? (
        <Notice tone="info">
          <p>{SCAN.nothingFound}</p>
        </Notice>
      ) : null}
      <Field id="scan-care" label={SCAN.careLabel}>
        <select className={fieldControlClass} value={care} onChange={(e) => setCare(e.target.value as CareType)}>
          {CARE_KEYS.map((k) => (
            <option key={k} value={k}>
              {APPT.care[k]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="scan-who" label={SCAN.whoLabel} hint={none(provider)}>
          <input maxLength={80} className={fieldControlClass} value={provider} onChange={edit(setProvider)} />
        </Field>
        <Field id="scan-clinic" label={SCAN.clinicLabel} hint={none(clinic)}>
          <input maxLength={80} className={fieldControlClass} value={clinic} onChange={edit(setClinic)} />
        </Field>
        <Field id="scan-date" label={SCAN.dateLabel} hint={none(date)}>
          <input type="date" className={fieldControlClass} value={date} onChange={edit(setDate)} />
        </Field>
        <Field id="scan-time" label={SCAN.timeLabel} hint={none(time)}>
          <input type="time" className={fieldControlClass} value={time} onChange={edit(setTime)} />
        </Field>
        <Field id="scan-address" label={SCAN.addressLabel} hint={none(address)}>
          <input maxLength={200} className={fieldControlClass} value={address} onChange={edit(setAddress)} />
        </Field>
        <Field id="scan-dept" label={SCAN.departmentLabel} hint={none(department)}>
          <input maxLength={80} className={fieldControlClass} value={department} onChange={edit(setDepartment)} />
        </Field>
      </div>
      <Field id="scan-reason" label={SCAN.reasonLabel} hint={none(reason)}>
        <input maxLength={200} className={fieldControlClass} value={reason} onChange={edit(setReason)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="scan-instructions" label={SCAN.instructionsLabel} hint={f.instructions.length === 0 ? SCAN.notFound : SCAN.instructionsHint}>
          <textarea rows={5} className={fieldControlClass} value={instructions} onChange={edit(setInstructions)} />
        </Field>
        <Field id="scan-bring" label={SCAN.bringLabel} hint={f.bring.length === 0 ? SCAN.notFound : SCAN.bringHint}>
          <textarea rows={5} className={fieldControlClass} value={bring} onChange={edit(setBring)} />
        </Field>
      </div>
      {draft.text.trim() ? (
        <details>
          <summary className="cursor-pointer font-bold">{SCAN.originalHeading}</summary>
          <pre aria-label={SCAN.originalLabel} className="mt-2 mb-0 whitespace-pre-wrap break-words text-sm">
            {draft.text}
          </pre>
        </details>
      ) : null}
      <p role="alert" className="m-0 min-h-6 font-bold text-danger">
        {problem}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" arrow onClick={save}>
          {SCAN.save}
        </Button>
        <Button kind="tertiary" onClick={onBack}>
          {SCAN.startAgain}
        </Button>
      </div>
    </div>
  );
}
