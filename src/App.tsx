import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Register from './pages/Register';
import AppLayout from './layouts/AppLayout';
import RequireAuth from './components/RequireAuth';
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

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Overview />} />
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
