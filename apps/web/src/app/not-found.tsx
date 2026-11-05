import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", description: "We could not find that page." };

export default function NotFound() {
  return (
    <section className="page center">
      <h1>We can&apos;t find that page</h1>
      <p className="intro">The link may be old, or the address may have a typo. Nothing is wrong on your side.</p>
      <Link className="btn btn-primary" href="/">
        Go to Home
      </Link>
    </section>
  );
}
