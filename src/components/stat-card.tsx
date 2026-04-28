interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  color?: "green" | "red" | "yellow" | "default";
}

const colorMap = {
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  default: "text-zinc-900 dark:text-zinc-100",
};

export function StatCard({ label, value, detail, color = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-semibold ${colorMap[color]}`}>
        {value}
      </p>
      {detail && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {detail}
        </p>
      )}
    </div>
  );
}
