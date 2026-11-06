/** Puts values into a copy template: fill("Hi, {name}.", { name: "Sam" }). A missing value becomes an empty string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** One of two templates by count: one for 1, other for everything else. */
export function plural(n: number, forms: { one: string; other: string }): string {
  return fill(n === 1 ? forms.one : forms.other, { n });
}
