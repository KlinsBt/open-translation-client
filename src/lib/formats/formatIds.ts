export const FORMAT_IDS = ["text", "json", "docx", "xlsx", "html"] as const;

export type FormatId = (typeof FORMAT_IDS)[number];
