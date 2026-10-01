import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import AcceptInvite from './pages/AcceptInvite';
import AppLayout from './layouts/AppLayout';
import RequireAuth from './components/RequireAuth';
import Account from './pages/Account';
import Overview from './pages/app/Overview';
import Roles from './pages/app/Roles';
import EmployeesList from './pages/app/EmployeesList';
import EmployeeForm from './pages/app/EmployeeForm';
import ClientsList from './pages/app/ClientsList';
import ClientForm from './pages/app/ClientForm';
import RoleForm from './pages/app/RoleForm';
import InventoryList from './pages/app/InventoryList';
import QuotesList from './pages/app/QuotesList';
import PurchasingList from './pages/app/PurchasingList';
import TimeTracking from './pages/app/TimeTracking';
import TimeTrackingAdmin from './pages/app/TimeTrackingAdmin';
import FinancesSaaS from './pages/app/FinancesSaaS';
import UsersManagement from './pages/app/UsersManagement';
import Profiles from './pages/app/Profiles';
import CustomFieldsSettings from './pages/app/CustomFieldsSettings';
import DashboardHub from './pages/analytics/DashboardHub';
import DashboardBuilder from './pages/analytics/DashboardBuilder';

// Catálogo do kit de peças: só em desenvolvimento. Em produção `import.meta.env.DEV` é `false` e o
// Vite descarta o import dinâmico inteiro (nem o arquivo entra no build).
const KitCatalog = import.meta.env.DEV ? lazy(() => import('./pages/app/KitCatalog')) : null;

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/confirmar-email" element={<VerifyEmail />} />
          <Route path="/aceitar-convite" element={<AcceptInvite />} />

          <Route element={<RequireAuth />}>
            {/* Área "Minha conta" do site (fora do ERP/AppLayout) — só leitura. */}
            <Route path="/conta" element={<Account />} />
            <Route path="/conta/assinatura" element={<Account />} />
            <Route path="/conta/seguranca" element={<Account />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Overview />} />
              {KitCatalog && (
                <Route path="_kit" element={<Suspense fallback={null}><KitCatalog /></Suspense>} />
              )}
              <Route path="cargos" element={<Roles />} />
              <Route path="cargos/novo" element={<RoleForm />} />
              <Route path="funcionarios" element={<EmployeesList />} />
              <Route path="funcionarios/novo" element={<EmployeeForm />} />
              <Route path="ponto" element={<TimeTracking />} />
              <Route path="ponto-administracao" element={<TimeTrackingAdmin />} />
              <Route path="clientes" element={<ClientsList />} />
              <Route path="clientes/novo" element={<ClientForm />} />
              <Route path="estoque" element={<InventoryList />} />
              <Route path="compras" element={<PurchasingList />} />
              <Route path="orcamentos" element={<QuotesList />} />
              <Route path="financas" element={<FinancesSaaS />} />
              <Route path="usuarios" element={<UsersManagement />} />
              <Route path="perfis" element={<Profiles />} />
              <Route path="campos-personalizados" element={<CustomFieldsSettings />} />
              <Route path="analytics" element={<DashboardHub />} />
              <Route path="analytics/:id" element={<DashboardBuilder />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
