import { notFound } from "next/navigation";

// Served only in end-to-end builds (NEXT_PUBLIC_E2E=1). Everywhere else this route is a normal 404.
export const dynamic = "force-dynamic";

export default function ErrorTestPage(): never {
  if (process.env.NEXT_PUBLIC_E2E !== "1") notFound();
  throw new Error("e2e error page test");
}
