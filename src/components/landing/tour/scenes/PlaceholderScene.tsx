// Cena provisória do tour (07/10/2026): só o título e a descrição da tela, enquanto a cena animada
// de verdade não é feita (Task 3 substitui cada uma em tourScenes.ts).

interface PlaceholderSceneProps {
  title: string;
  description: string;
}

const PlaceholderScene = ({ title, description }: PlaceholderSceneProps) => (
  <div className="absolute inset-0">
    <div className="absolute left-8 top-6">
      <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{title}</p>
      <p className="mt-1 text-[14px] text-muted">{description}</p>
    </div>
    <div className="absolute left-8 right-8 top-24 h-[420px] rounded-lg border border-border bg-panel shadow-sm" />
  </div>
);

export default PlaceholderScene;
