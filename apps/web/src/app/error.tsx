"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="page center" role="alert">
      <h1>Something went wrong</h1>
      <p className="intro">We couldn&apos;t load this page. Your information is safe. Please try again.</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link className="btn btn-secondary" href="/">
          Go to Home
        </Link>
      </div>
    </section>
  );
}
