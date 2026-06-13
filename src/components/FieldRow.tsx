import type { ReactNode } from "react";

interface FieldRowProps {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
  mono?: boolean;
}

export function FieldRow({ label, value, children, mono = false }: FieldRowProps) {
  return (
    <div className="field-row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{children ?? value ?? "—"}</dd>
    </div>
  );
}
