import { createContext, useContext, useEffect, useRef, useState, } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { fetchUserRole as fetchUserRoleFromService } from "../services/authService";
import type { User } from "@supabase/supabase-js";
import type { AuthContextType } from "../consts/interfaces";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  const fetchUserRole = async (userId: string) => {
    try {
      const userRole = await fetchUserRoleFromService(userId);
      setRole(userRole);
      localStorage.setItem("user_role", userRole);
      return userRole;
    } catch (error) {
      console.error("Error fetching user role:", error);
      setRole("user");
      localStorage.setItem("user_role", "user");
      return "user";
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Check if there's a stored session
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          userIdRef.current = session.user.id;
          setUser(session.user);
          await fetchUserRole(session.user.id);
        }
        setLoading(false);
      } catch (error) {
        console.error("Error initializing auth:", error);
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes. Supabase re-fires this (e.g. with a fresh
    // session.user object) when the tab regains focus, so ignore events
    // that don't actually change which user is signed in.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          if (session.user.id === userIdRef.current) {
            return;
          }
          userIdRef.current = session.user.id;
          setUser(session.user);
          await fetchUserRole(session.user.id);
        } else {
          userIdRef.current = null;
          setUser(null);
          setRole(null);
          localStorage.removeItem("user_role");
        }
        setLoading(false);
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: string[];
}

export const ProtectedRoute = ({
  children,
  allowedRoles,
}: ProtectedRouteProps) => {
  const { user, role, loading } = useAuth();
  const [aalOk, setAalOk] = useState<boolean | null>(null);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(user?.id ?? null);

  if ((user?.id ?? null) !== checkedUserId) {
    setCheckedUserId(user?.id ?? null);
    setAalOk(null);
  }

  useEffect(() => {
    if (!user) {
      return;
    }

    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (error || !data) {
        setAalOk(true);
        return;
      }
      setAalOk(!(data.nextLevel === "aal2" && data.currentLevel !== "aal2"));
    });
  }, [user]);

  if (loading || (user && aalOk === null)) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!aalOk) {
    return <Navigate to="/mfa-verify" replace />;
  }

  if (!allowedRoles.includes(role as string)) {
    if (role === "admin") {
      return <Navigate to="/admin" replace />;
    }

    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};