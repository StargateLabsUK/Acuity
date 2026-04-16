import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import Index from "./pages/Index.tsx";
import Incidents from "./pages/Incidents.tsx";
import Command from "./pages/Command.tsx";
import Login from "./pages/Login.tsx";
import Admin from "./pages/Admin.tsx";
import NotFound from "./pages/NotFound.tsx";

const App = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/fieldapp" element={<Index />} />
        <Route path="/crew" element={<Incidents />} />
        <Route path="/operations" element={<Command />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);

export default App;
