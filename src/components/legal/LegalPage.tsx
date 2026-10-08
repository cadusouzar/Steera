import type { ReactNode } from 'react';
import Navbar from '../Navbar';
import LandingFooter from '../landing/LandingFooter';

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface LegalPageProps {
  title: string;
  version: number;
  effectiveDate: string; // DD/MM/AAAA
  intro: ReactNode;
  sections: LegalSection[];
}

// Página pública de documento legal: coluna de leitura (~70ch), índice com âncoras, claro/escuro por tokens.
const LegalPage = ({ title, version, effectiveDate, intro, sections }: LegalPageProps) => (
  <div className="relative min-h-screen bg-background text-foreground flex flex-col">
    <Navbar />
    <main className="flex-1 w-full max-w-[70ch] mx-auto px-4 sm:px-6 pt-32 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">
        Versão {version} — vigente desde {effectiveDate}
      </p>

      <div className="mt-8 space-y-4 leading-relaxed">{intro}</div>

      <nav aria-label="Índice" className="mt-8 rounded-xl border border-border bg-panel p-4">
        <p className="text-sm font-semibold">Índice</p>
        <ol className="mt-2 space-y-1 text-sm">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-muted hover:text-foreground underline underline-offset-2">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-10 scroll-mt-8">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <div className="mt-3 space-y-4 leading-relaxed">{section.content}</div>
        </section>
      ))}
    </main>
    <LandingFooter />
  </div>
);

export default LegalPage;
