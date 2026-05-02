import { Suspense } from "react";
import CompareContent from "./compare-content";

function CompareFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
      Loading compare filters...
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<CompareFallback />}>
      <CompareContent />
    </Suspense>
  );
}
