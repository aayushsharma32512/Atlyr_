import { Navigate, Outlet } from "react-router-dom";
import Index from "./Index";
import { useAuth } from "@/contexts/AuthContext";

const AppShell = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  return <Index />;
};

export default AppShell;

