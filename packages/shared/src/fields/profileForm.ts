import type { FormDefinition } from "./types.js";

export const profileForm: FormDefinition = {
  id: "candidate-profile",
  version: 1,
  sections: [
    {
      id: "personal",
      title: "Personal details",
      fields: [
        { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120,
          hint: "Candidate's full name, in normal capitalization." },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "tel", hint: "Phone number as written." },
        { name: "location", label: "Location", type: "text", maxLength: 120,
          hint: "Candidate's own city and region/country from the contact details, not an employer's location." },
        { name: "linkedinUrl", label: "LinkedIn URL", type: "url",
          hint: "LinkedIn profile URL. Prefix https:// if the resume omits the scheme." },
      ],
    },
    {
      id: "professional",
      title: "Professional summary",
      fields: [
        { name: "headline", label: "Headline", type: "text", maxLength: 160,
          hint: "Short professional headline under the name, if present." },
        { name: "currentJobTitle", label: "Current job title", type: "text", maxLength: 120,
          hint: "Title of the current role, or of the most recent role if none is current." },
        { name: "yearsOfExperience", label: "Years of experience", type: "number", integer: true, min: 0, max: 60,
          hint: "Total years of professional experience. Use a number the resume states; otherwise compute from the earliest work start date to today, rounded down. Evidence: the stated number, or the earliest start date text." },
        { name: "summary", label: "Summary", type: "textarea", maxLength: 2000,
          hint: "The resume's summary/objective paragraph, copied without rewording." },
        { name: "workMode", label: "Preferred work mode", type: "select", extractable: false,
          options: [
            { value: "remote", label: "Remote" },
            { value: "hybrid", label: "Hybrid" },
            { value: "onsite", label: "On-site" },
          ] },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      fields: [
        { name: "skills", label: "Skills", type: "tags", maxItems: 50,
          hint: "Each distinct skill, tool or technology listed. One item per skill." },
      ],
    },
    {
      id: "experience",
      title: "Work experience",
      fields: [
        { name: "workExperience", label: "Work experience", type: "group", itemLabel: "Role", maxItems: 20,
          hint: "One item per role, most recent first. Evidence: the role's header line (company/title/dates).",
          fields: [
            { name: "company", label: "Company", type: "text", required: true },
            { name: "title", label: "Title", type: "text", required: true },
            { name: "location", label: "Location", type: "text" },
            { name: "startDate", label: "Start", type: "month", required: true, placeholder: "YYYY-MM" },
            { name: "endDate", label: "End", type: "month", placeholder: "YYYY-MM",
              disabledWhen: { field: "isCurrent", equals: true },
              hint: "null when the role is current." },
            { name: "isCurrent", label: "Current role", type: "checkbox",
              hint: "true only if the role is marked Present/Current." },
            { name: "highlights", label: "Highlights", type: "textarea",
              hint: "The role's bullet points, one per line, copied without rewording." },
          ] },
      ],
    },
    {
      id: "education",
      title: "Education",
      fields: [
        { name: "education", label: "Education", type: "group", itemLabel: "Degree", maxItems: 10,
          hint: "One item per degree or qualification. Evidence: the full education line.",
          fields: [
            { name: "institution", label: "Institution", type: "text", required: true },
            { name: "degree", label: "Degree", type: "text" },
            { name: "graduationYear", label: "Graduation year", type: "number", integer: true, min: 1950, max: 2100 },
          ] },
      ],
    },
  ],
};
