import { Screen } from "@/components/ui/screen";
import { PAGES } from "@/lib/pages";

/** A real page (h1, lead, Back and nav from the layout) until Task 14 or 15 builds the screen. The kit uses its empty text. */
export function StubScreen({ route }: { route: string }) {
  const page = PAGES[route];
  const text = route === "/kit" && page.empty ? page.empty : page;
  return <Screen title={text.h1} lead={text.lead} />;
}
