// Field definitions are plain, serializable data (no functions), so the same config could be
// loaded from a database or CMS when the form grows to 150+ fields.

interface BaseField {
  name: string;
  label: string;
  required?: boolean;
  /** Whether the AI should try to fill this field. Defaults to true. */
  extractable?: boolean;
  /** Extraction guidance. Sent to the model as the JSON Schema `description`. */
  hint?: string;
  placeholder?: string;
  /** Declarative conditional rule: when `field` equals `equals`, this field is disabled and must be empty. */
  disabledWhen?: { field: string; equals: string | number | boolean };
}

export interface TextField extends BaseField {
  type: "text" | "textarea" | "email" | "tel" | "url";
  maxLength?: number;
}

export interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface SelectField extends BaseField {
  type: "select";
  options: { value: string; label: string }[];
}

export interface CheckboxField extends BaseField {
  type: "checkbox";
}

/** "YYYY-MM", or "YYYY" when the month is unknown. */
export interface MonthField extends BaseField {
  type: "month";
}

export interface TagsField extends BaseField {
  type: "tags";
  maxItems?: number;
}

export type LeafField = TextField | NumberField | SelectField | CheckboxField | MonthField | TagsField;

/** A repeatable group of leaf fields, e.g. work experience entries. One level deep by design. */
export interface GroupField extends BaseField {
  type: "group";
  itemLabel: string;
  fields: LeafField[];
  maxItems?: number;
}

export type FieldDefinition = LeafField | GroupField;
export type FieldType = FieldDefinition["type"];

export interface SectionDefinition {
  id: string;
  title: string;
  description?: string;
  fields: FieldDefinition[];
}

export interface FormDefinition {
  id: string;
  version: number;
  sections: SectionDefinition[];
}
