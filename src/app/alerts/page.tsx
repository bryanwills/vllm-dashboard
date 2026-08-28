import { Suspense } from "react";
import AlertsContent from "./alerts-content";

function AlertsFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
      Loading alerts...
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<AlertsFallback />}>
      <AlertsContent />
    </Suspense>
  );
}
