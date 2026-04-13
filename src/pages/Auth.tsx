import { Navigate, useSearchParams } from "react-router-dom";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useAuth } from "@/contexts/AuthContext";
import { useGuest } from "@/contexts/GuestContext";

const AuthPage = () => {
  const { user, loading } = useAuth();
  const { guestState } = useGuest();
  const [searchParams] = useSearchParams();

  if (loading) {
    return null;
  }

  const next = searchParams.get("next") || "/profile/user-details";

  if (user || guestState.isGuest) {
    return <Navigate to={next} replace />;
  }

  return <AuthScreen />;
};

export default AuthPage;

