"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/components/ui/cn";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { GET_READY } from "@/content/getReady";
import type { PlanItem } from "@/features/shared/types";

export type Removed = { item: PlanItem; index: number };

/** The plan lines: include, edit, remove (with Undo) and add. All changes go up through the callbacks. */
export function PlanList({
  items,
  removed,
  onToggle,
  onEdit,
  onRemove,
  onUndo,
  onAdd,
}: {
  items: PlanItem[];
  removed: Removed | null;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onUndo: () => void;
  onAdd: (text: string) => void;
}) {
  const uid = useId();
  const [editing, setEditing] = useState(null as string | null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState(false);
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState(false);

  const saveEdit = (id: string) => {
    if (!editText.trim()) return setEditError(true);
    onEdit(id, editText.trim());
    setEditing(null);
  };
  const add = () => {
    if (!addText.trim()) return setAddError(true);
    onAdd(addText.trim());
    setAddText("");
    setAddError(false);
  };

  return (
    <div className="grid gap-4">
      <ul role="list" className="m-0 grid list-none gap-3 p-0">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "grid gap-3 rounded-card border-2 bg-surface p-4",
              item.source === "suggested" ? "border-dashed border-line-strong" : "border-line",
            )}
          >
            <Chip className="justify-self-start">
              {item.source === "suggested" ? GET_READY.sourceSuggested : GET_READY.sourceUser}
            </Chip>
            {editing === item.id ? (
              <div className="grid gap-3">
                <Field id={`${uid}-e-${item.id}`} label={GET_READY.editLabel} error={editError ? GET_READY.blank : undefined}>
                  <textarea
                    rows={3}
                    className={fieldControlClass}
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value);
                      setEditError(false);
                    }}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button kind="secondary" onClick={() => saveEdit(item.id)}>
                    {GET_READY.saveEdit}
                  </Button>
                  <Button kind="tertiary" onClick={() => setEditing(null)}>
                    {GET_READY.cancelEdit}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="m-0 text-ink">{item.text}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="flex min-h-11 items-center gap-3">
                    <Switch
                      id={`${uid}-s-${item.id}`}
                      checked={item.enabled}
                      onCheckedChange={(v) => onToggle(item.id, v)}
                      aria-label={`${GET_READY.include}: ${item.text}`}
                    />
                    <label htmlFor={`${uid}-s-${item.id}`} className="cursor-pointer font-bold text-ink">
                      {GET_READY.include}
                    </label>
                  </div>
                  <Button
                    kind="tertiary"
                    aria-label={`${GET_READY.edit}: ${item.text}`}
                    onClick={() => {
                      setEditing(item.id);
                      setEditText(item.text);
                      setEditError(false);
                    }}
                  >
                    {GET_READY.edit}
                  </Button>
                  <Button kind="tertiary" aria-label={`${GET_READY.remove}: ${item.text}`} onClick={() => onRemove(item.id)}>
                    {GET_READY.remove}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite" className="min-h-6">
        {removed ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-ink">
            <span>{GET_READY.removed}</span>{" "}
            <Button kind="tertiary" onClick={onUndo}>
              {GET_READY.undo}
            </Button>
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Field id={`${uid}-add`} label={GET_READY.addLabel} hint={GET_READY.addHint} error={addError ? GET_READY.blank : undefined}>
          <input
            type="text"
            maxLength={200}
            className={fieldControlClass}
            value={addText}
            onChange={(e) => {
              setAddText(e.target.value);
              setAddError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Button kind="secondary" className="justify-self-start" onClick={add}>
          {GET_READY.addButton}
        </Button>
      </div>
    </div>
  );
}
