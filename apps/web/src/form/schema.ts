import {
  allFields,
  buildDefaultValues,
  buildFormSchema,
  profileForm,
  type FieldDefinition,
} from "@resume-agent/shared";

// Built once at module load, not per render. For a static config this beats useMemo:
// no dependency array to get wrong, and every component shares the same instances.
export const form = profileForm;
export const formSchema = buildFormSchema(form);
export const defaultValues = buildDefaultValues(form);
export const fieldsByName = new Map<string, FieldDefinition>(allFields(form).map((f) => [f.name, f]));

// RHF types values from a generic; our values are generated from config, so they're dynamic.
export type ProfileValues = Record<string, any>;
