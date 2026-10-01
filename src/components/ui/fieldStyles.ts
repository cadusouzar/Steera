// Classe base dos controles de formulário (Input/Select/Textarea) — exportada também para telas
// antigas que ainda montam o próprio <input> poderem adotar o mesmo visual sem trocar o componente.
export function controlClass(invalid = false, extra = '') {
  return [
    'w-full rounded-md bg-panel px-3 text-[14px] text-foreground placeholder:text-muted/80',
    'border transition-[border-color,box-shadow] duration-150 outline-none',
    'focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed',
    invalid ? 'border-danger/70 focus:border-danger focus:ring-danger/25' : 'border-border hover:border-foreground/25 focus:border-foreground/40 focus:ring-foreground/15',
    extra,
  ].join(' ');
}
