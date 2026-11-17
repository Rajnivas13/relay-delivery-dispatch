"use client";

import { useEffect, useState } from "react";
import { Button, Field, Modal, Textarea } from "./ui";

export function ReasonDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  label = "Reason",
  confirmLabel = "Confirm",
  variant = "danger",
  loading,
  presets = [],
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  title: string;
  description?: string;
  label?: string;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
  presets?: string[];
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const valid = reason.trim().length >= 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} disabled={!valid} loading={loading} onClick={() => onSubmit(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {presets.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => setReason(p)} className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-indigo-400 hover:text-white">
              {p}
            </button>
          ))}
        </div>
      )}
      <Field label={label} hint="At least 3 characters. Recorded in the audit trail.">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Modal>
  );
}
