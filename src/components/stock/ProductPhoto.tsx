import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { fetchProtectedFileObjectUrl } from '../../lib/api';

// Foto do produto: o arquivo exige o token da sessão (um <img src> comum não manda), então é baixado
// por fetch autenticado e exibido por Object URL — mesmo padrão das fotos de ponto.
const ProductPhoto = ({ photoUrl, name, size = 'md' }: { photoUrl: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    if (!photoUrl) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchProtectedFileObjectUrl(photoUrl)
      .then((url) => {
        objectUrl = url;
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUrl]);

  const box = size === 'lg' ? 'h-28 w-28' : size === 'sm' ? 'h-9 w-9' : 'h-14 w-14';
  return (
    <div className={`${box} shrink-0 rounded-md border border-border bg-secondary overflow-hidden flex items-center justify-center`}>
      {src ? (
        <img src={src} alt={`Foto de ${name}`} className="h-full w-full object-cover" />
      ) : (
        <Package size={size === 'sm' ? 16 : 22} strokeWidth={1.5} className={`text-muted ${photoUrl && !failed ? 'animate-pulse' : ''}`} aria-hidden="true" />
      )}
    </div>
  );
};

export default ProductPhoto;
