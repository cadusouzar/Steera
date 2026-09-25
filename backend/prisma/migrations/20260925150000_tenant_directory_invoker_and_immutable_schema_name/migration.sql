-- Revisão final do cadastro ampliado + schema legível (25/09/2026). Migration feita à mão: o
-- replay do shadow database de `prisma migrate dev` está quebrado por um P3006 pré-existente, e
-- nada aqui é representável no schema.prisma (opção de view, função e trigger).

-- 1) tenant_directory passa a avaliar RLS como QUEM CONSULTA, não como o dono da view. Sem isto, a
-- view (dona: quickflow_app, sem security_invoker) aplicava a política FORCE de "User" com os
-- privilégios do dono mesmo pra um superusuário, devolvendo email_admin = NULL sem o bypass. Agora:
-- superusuário lê direto; quickflow_app continua precisando de set_config('app.rls_bypass','on',true).
ALTER VIEW "tenant_directory" SET (security_invoker = true);

-- 2) Company.schemaName é gravado uma única vez no cadastro e nunca muda: o resolver de schema
-- guarda o valor em cache sem invalidação, então uma troca em runtime mandaria as queries da
-- empresa pro schema antigo. O banco passa a recusar a alteração, não só a aplicação.
CREATE FUNCTION company_schema_name_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."schemaName" IS DISTINCT FROM OLD."schemaName" THEN
    RAISE EXCEPTION 'Company.schemaName não pode ser alterado depois do cadastro (empresa %)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_schema_name_immutable
BEFORE UPDATE OF "schemaName" ON "Company"
FOR EACH ROW EXECUTE FUNCTION company_schema_name_immutable();
