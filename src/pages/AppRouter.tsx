import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Index from "./Index";
import { useAuth } from "@/contexts/AuthContext";
import { clearPendingInviteCode, clearReturningMarker } from "@/features/auth/inviteStorage";
import { useHasAppAccessQuery } from "@/features/auth/hooks/useInviteAccess";

function BlockedAccessRedirect() {
  const { signOut } = useAuth();

  useEffect(() => {
    clearPendingInviteCode();
    clearReturningMarker();
    signOut().finally(() => {
      window.location.replace("/?waitlist=1");
    });
  }, [signOut]);

  return null;
}

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

  if (accessQuery.isError || !accessQuery.data) {
    return <BlockedAccessRedirect />;
  }

  return <Index />;
};

export default AppRouter;
