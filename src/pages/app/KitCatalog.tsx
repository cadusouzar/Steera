import { useState } from 'react';
import { ArrowRight, Download, Plus, Trash2 } from 'lucide-react';
import {
  Button, ButtonLink, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, PageHeader, Panel, PanelLink,
  Select, StatCard, StatValue, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from '../../components/ui';

// Catálogo do kit de peças — SÓ em desenvolvimento (rota registrada atrás de import.meta.env.DEV em
// App.tsx, carregada sob demanda; nunca entra no build de produção). Serve pra conferir cada peça em
// todos os estados, nos dois temas, antes de levar às telas reais.
const KIT_PEOPLE = [
  'Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Araújo', 'Élida Rocha', 'Fábio Nunes',
  'Gabriela Costa', 'Heitor Alves', 'Íris Barbosa', 'João Pereira', 'Larissa Dias', 'Marcos Teixeira',
];

const KitCatalog = () => {
  const [kitShort, setKitShort] = useState('clt');
  const [kitLong, setKitLong] = useState('');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmTyped, setConfirmTyped] = useState(false);
  const [busy, setBusy] = useState(false);

  const fakeSave = () => {
    setBusy(true);
    window.setTimeout(() => { setBusy(false); setConfirm(false); setConfirmTyped(false); }, 1200);
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <PageHeader
          title="Kit de peças"
          description="Catálogo de desenvolvimento: cada peça em todos os estados."
          actions={<><Button variant="secondary" icon={Download}>Exportar</Button><Button icon={Plus}>Novo item</Button></>}
        />

        <Panel title="Botões">
          <div className="space-y-4">
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-3">
                <span className="w-20 text-[13px] text-muted">{v}</span>
                <Button variant={v}>Salvar</Button>
                <Button variant={v} icon={Plus}>Com ícone</Button>
                <Button variant={v} loading>Salvando</Button>
                <Button variant={v} disabled>Desabilitado</Button>
                <Button variant={v} size="sm">Pequeno</Button>
              </div>
            ))}
            <ButtonLink to="/app" variant="secondary" trailingIcon={ArrowRight}>Link com cara de botão</ButtonLink>
          </div>
        </Panel>

        <Panel title="Campos">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="k-nome" required><Input id="k-nome" placeholder="Ex.: Carla Mendes" /></Field>
            <Field label="E-mail" htmlFor="k-mail" error="E-mail inválido"><Input id="k-mail" defaultValue="carla@" invalid /></Field>
            <Field label="Departamento" htmlFor="k-dep" hint="Usado para agrupar funcionários.">
              <Select id="k-dep" defaultValue="loja"><option value="loja">Loja</option><option value="prod">Produção</option></Select>
            </Field>
            <Field label="Desabilitado" htmlFor="k-dis"><Input id="k-dis" disabled defaultValue="Não editável" /></Field>
            <Field label="Observação" htmlFor="k-obs" className="sm:col-span-2"><Textarea id="k-obs" placeholder="Texto livre" /></Field>
          </div>
        </Panel>

        <Panel title="Dropdown">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lista curta" htmlFor="k-sel-short">
              <Select id="k-sel-short" value={kitShort} onChange={(e) => setKitShort(e.target.value)}>
                <option value="clt">CLT</option>
                <option value="pj">PJ</option>
                <option value="estagio">Estágio</option>
              </Select>
            </Field>
            <Field label="Lista longa (com busca)" htmlFor="k-sel-long" hint="Mais de 8 opções liga a busca.">
              <Select id="k-sel-long" value={kitLong} onChange={(e) => setKitLong(e.target.value)}>
                <option value="">Nenhum (sem superior)</option>
                {KIT_PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Desativado" htmlFor="k-sel-dis">
              <Select id="k-sel-dis" value="loja" disabled><option value="loja">Loja</option></Select>
            </Field>
            <Field label="Com erro" htmlFor="k-sel-err" error="Escolha um cargo.">
              <Select id="k-sel-err" value="" invalid onChange={() => undefined}>
                <option value="">Selecione…</option>
                <option value="a">Atendente</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Notificação">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => toast.success('Funcionário cadastrado: Marina Alves')}>Cadastro</Button>
            <Button variant="secondary" onClick={() => toast.success('Ajuste aprovado: Ana Souza')}>Aprovação</Button>
            <Button variant="secondary" onClick={() => toast.success('Senha alterada')}>Curta</Button>
            <Button variant="secondary" onClick={() => toast.success('Cliente enviado para a lixeira: Padaria e Confeitaria Pão Quente da Esquina Ltda')}>Longa</Button>
          </div>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Carregando" status="loading" value={null} footer="" />
          <StatCard label="Funcionários ativos" status="ready" to="/app/funcionarios" value={<StatValue value={38} suffix="/ 42" />} footer="4 inativos" />
          <StatCard label="Com erro" status="error" value={null} footer="" error={<span className="text-[13px] text-muted">Não foi possível carregar.</span>} />
        </div>

        <Panel title="Tabela" action={<PanelLink to="/app/funcionarios">Ver todos</PanelLink>} padded={false}>
          <Table minWidth={560}>
            <THead>
              <tr><TH>Nome</TH><TH>Cargo</TH><TH>Status</TH><TH align="right">Salário</TH></tr>
            </THead>
            <TBody>
              <TR interactive><TD>Bruno Teixeira</TD><TD className="text-muted">Padeiro</TD><TD><StatusBadge tone="success">Ativo</StatusBadge></TD><TD align="right" className="tabular">R$ 2.800,00</TD></TR>
              <TR interactive><TD>Júlia Prado</TD><TD className="text-muted">Atendente</TD><TD><StatusBadge tone="warning">Férias</StatusBadge></TD><TD align="right" className="tabular">R$ 2.600,00</TD></TR>
              <TR interactive><TD>Diego Ramos</TD><TD className="text-muted">Padeiro</TD><TD><StatusBadge tone="danger">Atrasado</StatusBadge></TD><TD align="right" className="tabular">R$ 2.800,00</TD></TR>
              <TR interactive><TD>Marcos Lima</TD><TD className="text-muted">Padeiro</TD><TD><StatusBadge tone="neutral">Inativo</StatusBadge></TD><TD align="right" className="tabular">R$ 2.800,00</TD></TR>
            </TBody>
          </Table>
        </Panel>

        <Panel padded={false}>
          <EmptyState
            title="Nenhum funcionário ainda"
            description="Cadastre o primeiro funcionário para começar a controlar ponto, férias e pagamentos."
            action={<Button icon={Plus}>Novo funcionário</Button>}
          />
        </Panel>

        <Panel title="Janelas">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setModal(true)}>Abrir modal</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Abrir gaveta</Button>
            <Button variant="secondary" onClick={() => setConfirm(true)}>Confirmação</Button>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmTyped(true)}>Excluir com digitação</Button>
          </div>
        </Panel>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Novo cargo"
        description="Cargos agrupam funcionários e definem departamento e cor."
        footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={() => setModal(false)}>Salvar cargo</Button></>}
      >
        <div className="space-y-4">
          <Field label="Nome do cargo" htmlFor="m-nome" required><Input id="m-nome" /></Field>
          <Field label="Departamento" htmlFor="m-dep"><Input id="m-dep" /></Field>
        </div>
      </Modal>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Bruno Teixeira"
        description="Padeiro · Produção"
        footer={<><Button variant="secondary" onClick={() => setDrawer(false)}>Fechar</Button><Button>Salvar</Button></>}
      >
        <div className="space-y-4">
          <Field label="Salário base" htmlFor="d-sal"><Input id="d-sal" defaultValue="2800" /></Field>
          <p className="text-[14px] text-muted">Conteúdo longo rola aqui dentro, sem mover o fundo.</p>
          {Array.from({ length: 12 }, (_, i) => <p key={i} className="text-[14px] text-foreground">Linha de conteúdo {i + 1}</p>)}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={fakeSave}
        busy={busy}
        title="Desativar funcionário?"
        description="Ele deixa de aparecer nas listas, mas o histórico continua guardado."
        confirmLabel="Desativar"
      />

      <ConfirmDialog
        open={confirmTyped}
        onClose={() => setConfirmTyped(false)}
        onConfirm={fakeSave}
        busy={busy}
        tone="danger"
        title="Excluir o campo “Tamanho do uniforme”?"
        description="12 funcionários têm este campo preenchido. Os valores serão apagados."
        confirmLabel="Excluir campo"
        confirmText="Tamanho do uniforme"
      />
    </div>
  );
};

export default KitCatalog;
