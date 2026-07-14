export function SectionLabel({ id, label, meta }: { id?: string; label: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <span id={id}>{label}</span>
      <span className="normal-case tracking-normal">{meta}</span>
    </div>
  );
}
