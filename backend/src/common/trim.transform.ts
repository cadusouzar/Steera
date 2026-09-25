import { Transform } from 'class-transformer';

// Trim na fronteira do DTO (o ValidationPipe global tem `transform: true`, então isto roda ANTES
// das validações): sem ele, "   " passava pelo @MinLength(1) e o trim do service transformava em
// '' — razão social/endereço/nome vazios no banco e PJ sem fantasia driblando a obrigatoriedade.
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
