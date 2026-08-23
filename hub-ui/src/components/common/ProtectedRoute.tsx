import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../auth/AuthContext";

export function ProtectedRoute() {
  const { authenticated } = useAuth();
  const location = useLocation();

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
