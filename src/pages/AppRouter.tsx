import { Navigate, useLocation } from "react-router-dom";
import Index from "./Index";
import { useAuth } from "@/contexts/AuthContext";
import { useHasAppAccessQuery } from "@/features/auth/hooks/useInviteAccess";

const AppRouter = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const accessQuery = useHasAppAccessQuery(true);

  if (loading) {
    return null;
  }

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth/login?next=${next}`} replace />;
  }

  if (accessQuery.isLoading) {
    return null;
  }

  // Signed in without access: stay signed in and offer the invite-code door.
  if (accessQuery.isError || !accessQuery.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth/invite?next=${next}`} replace />;
  }

  return <Index />;
};

export default AppRouter;
