export type EntryActionState = Readonly<{
  error?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
}>;

export const initialEntryActionState: EntryActionState = {};
