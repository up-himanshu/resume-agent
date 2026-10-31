import { memo } from "react";
import { FieldRenderer } from "./fields.js";
import { form } from "./schema.js";

export const ProfileForm = memo(function ProfileForm() {
  return (
    <>
      {form.sections.map((section) => (
        <fieldset key={section.id} className="section" id={`section-${section.id}`}>
          <legend>{section.title}</legend>
          <div className="grid">
            {section.fields.map((field) => (
              <FieldRenderer key={field.name} field={field} />
            ))}
          </div>
        </fieldset>
      ))}
    </>
  );
});
