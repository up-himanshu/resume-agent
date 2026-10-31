import { memo, useEffect, useState, type KeyboardEvent } from "react";
import { Controller, useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { emptyValue, type FieldDefinition, type GroupField, type LeafField } from "@resume-agent/shared";
import type { ProfileValues } from "./schema.js";

// Performance model for big forms:
// - register() inputs are uncontrolled: typing updates the DOM and RHF's store, not React state,
//   so one keystroke doesn't re-render the form.
// - Each field subscribes only to its own error (useFormState({ name })) and memo() stops
//   parent re-renders from cascading down. useWatch is used only where a field depends on another.

function FieldError({ path }: { path: string }) {
  const { getFieldState } = useFormContext<ProfileValues>();
  const formState = useFormState<ProfileValues>({ name: path });
  const { error } = getFieldState(path, formState);
  const message = error?.message ?? (error as { root?: { message?: string } } | undefined)?.root?.message;
  return message ? <p className="field-error" role="alert">{message}</p> : null;
}

function Label({ field, htmlFor }: { field: FieldDefinition; htmlFor?: string }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {field.label}
      {field.required && <span className="required" aria-label="required"> *</span>}
      {field.extractable === false && <span className="badge muted">manual</span>}
    </label>
  );
}

function TagsInput({ field, path }: { field: LeafField; path: string }) {
  const { control } = useFormContext<ProfileValues>();
  const [draft, setDraft] = useState("");
  return (
    <Controller
      control={control}
      name={path}
      render={({ field: { value, onChange, onBlur } }) => {
        const tags = (value as string[]) ?? [];
        const add = () => {
          const tag = draft.trim();
          if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
          setDraft("");
        };
        const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        };
        return (
          <div className="tags">
            {tags.map((t) => (
              <span key={t} className="tag">
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
              </span>
            ))}
            <input
              id={path}
              value={draft}
              placeholder={tags.length ? "" : `Add ${field.label.toLowerCase()}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                add();
                onBlur();
              }}
            />
          </div>
        );
      }}
    />
  );
}

function LeafInput({ field, path, disabled = false }: { field: LeafField; path: string; disabled?: boolean }) {
  const { register } = useFormContext<ProfileValues>();
  const common = { id: path, placeholder: field.placeholder, readOnly: disabled, "aria-disabled": disabled || undefined };

  switch (field.type) {
    case "textarea":
      return <textarea rows={field.name === "highlights" ? 4 : 3} {...common} {...register(path)} />;
    case "number":
      return (
        <input
          type="number"
          {...common}
          {...register(path, { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })}
        />
      );
    case "select":
      return (
        <select id={path} disabled={disabled} {...register(path)}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "checkbox":
      return <input type="checkbox" id={path} {...register(path)} />;
    case "tags":
      return <TagsInput field={field} path={path} />;
    case "month":
      return <input type="text" inputMode="numeric" {...common} {...register(path)} />;
    default:
      return <input type={field.type} {...common} {...register(path)} />;
  }
}

// Only fields with a `disabledWhen` rule watch another value, so only they re-render on it.
function ConditionalLeaf({ field, path }: { field: LeafField; path: string }) {
  const { setValue, getValues } = useFormContext<ProfileValues>();
  const rule = field.disabledWhen!;
  const siblingPath = path.replace(/[^.]+$/, rule.field);
  const disabled = useWatch<ProfileValues>({ name: siblingPath }) === rule.equals;

  useEffect(() => {
    // Disabled fields must be empty (the schema enforces it); clear stale values on toggle.
    // We avoid RHF's `disabled` option because it turns the submitted value into undefined.
    if (disabled && getValues(path) !== emptyValue(field)) {
      setValue(path, emptyValue(field), { shouldValidate: true, shouldDirty: true });
    }
  }, [disabled, field, path, getValues, setValue]);

  return <LeafInput field={field} path={path} disabled={disabled} />;
}

function LeafField({ field, path }: { field: LeafField; path: string }) {
  const input = field.disabledWhen ? <ConditionalLeaf field={field} path={path} /> : <LeafInput field={field} path={path} />;
  return (
    <div className={`field field-${field.type}`}>
      {field.type === "checkbox" ? (
        <label className="checkbox-label">
          {input} {field.label}
        </label>
      ) : (
        <>
          <Label field={field} htmlFor={path} />
          {input}
        </>
      )}
      <FieldError path={path} />
    </div>
  );
}

function GroupFieldRenderer({ field }: { field: GroupField }) {
  const { control } = useFormContext<ProfileValues>();
  // useFieldArray gives each item a stable `id` for React keys; never key repeatable rows by index.
  const { fields: items, append, remove } = useFieldArray({ control, name: field.name });
  const newItem = () => Object.fromEntries(field.fields.map((f) => [f.name, emptyValue(f)]));

  return (
    <div className="group">
      {items.map((item, index) => (
        <div key={item.id} className="group-item">
          <div className="group-item-header">
            <strong>{field.itemLabel} {index + 1}</strong>
            <button type="button" className="link" onClick={() => remove(index)}>Remove</button>
          </div>
          <div className="grid">
            {field.fields.map((sub) => (
              <LeafField key={sub.name} field={sub} path={`${field.name}.${index}.${sub.name}`} />
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => append(newItem())}>
        + Add {field.itemLabel.toLowerCase()}
      </button>
      <FieldError path={field.name} />
    </div>
  );
}

/** Renders any field definition. The config decides the UI; adding a field needs no new component. */
export const FieldRenderer = memo(function FieldRenderer({ field }: { field: FieldDefinition }) {
  return field.type === "group" ? <GroupFieldRenderer field={field} /> : <LeafField field={field} path={field.name} />;
});
