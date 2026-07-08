import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Register from './pages/Register';
import AppLayout from './layouts/AppLayout';
import Overview from './pages/app/Overview';
import Roles from './pages/app/Roles';
import EmployeesList from './pages/app/EmployeesList';
import EmployeeForm from './pages/app/EmployeeForm';
import ClientsList from './pages/app/ClientsList';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Overview />} />
            <Route path="cargos" element={<Roles />} />
            <Route path="funcionarios" element={<EmployeesList />} />
            <Route path="funcionarios/novo" element={<EmployeeForm />} />
            <Route path="clientes" element={<ClientsList />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
