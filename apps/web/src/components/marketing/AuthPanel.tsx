import { BackButton } from "@/components/nav/BackButton";
import { PAGES } from "@/lib/pages";

/** The coloured half of the sign-in card: Back on top left, the landing headline over soft contour lines. The headline is decorative; the page has its own h1. */
export function AuthPanel() {
  const page = PAGES["/"];
  return (
    <div className="relative flex h-full min-h-[32rem] flex-col justify-between overflow-hidden bg-primary p-10 text-primary-ink xl:p-14">
      <svg aria-hidden="true" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".28">
        <path d="M-20 90c70-60 140-40 190 10s30 120-30 150-140 0-160-60" />
        <path d="M-10 110c60-45 120-30 160 15s20 100-30 125-120 0-135-50" />
        <path d="M0 130c50-30 100-20 130 20s10 80-30 100-100 0-110-40" />
        <path d="M420 330c-70 50-140 30-180-20s-20-110 40-130 130 10 140 70" />
        <path d="M420 350c-60 40-120 25-155-20s-15-95 35-110 115 10 125 60" />
        <path d="M420 370c-50 30-100 20-130-15s-10-80 30-90 100 10 110 50" />
        <circle cx="330" cy="70" r="9" />
        <path d="M350 40v22M339 51h22" />
      </svg>
      <div className="relative w-fit">
        <BackButton />
      </div>
      <div aria-hidden="true" className="relative">
        <p className="m-0 max-w-none text-[clamp(2rem,3.4vw,3.2rem)] leading-[1.05] font-[750]">{page.h1}</p>
        <p className="mt-4 mb-0 max-w-[34ch] text-lg opacity-90">{page.lead}</p>
      </div>
    </div>
  );
}
