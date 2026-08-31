import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { signIn, signInWithGoogle } from "../services/authService";
import { loginSchema, type LoginFormData } from "../schemas/authSchema";
import { getErrorMessage } from "../utils/errors";

const Login = () => {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      const result = await signIn(data.email, data.password);

      if (result.mfaRequired) {
        navigate("/mfa-verify", {
          state: { factorId: result.factorId, challengeId: result.challengeId },
        });
        return;
      }

      const { user, role } = result;

      localStorage.setItem("user_role", role);

      console.log("User signed in successfully:", { user, role });
      alert("User signed in successfully.");

      if (role === "admin") {
        navigate("/admin");
      } else {
        navigate("/");
      }
    } catch (error) {
      const message = getErrorMessage(error, "Failed to sign in. Please check your credentials.");
      console.error("Error signing in:", message);
      alert(message);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      const message = getErrorMessage(error, "Failed to sign in with Google.");
      console.error("Error signing in with Google:", message);
      alert(message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-8 text-center">
          <h1 className="text-4xl font-bold">MyBlog</h1>
          <p className="mt-2 text-blue-100">Welcome back! Login to continue.</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-5" noValidate>
          <div>
            <label htmlFor="login-email" className="font-semibold text-gray-700">Email</label>
            <input
              id="login-email"
              type="email"
              placeholder="Enter your email"
              {...register("email")}
              className={`mt-2 w-full rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.email ? "border-red-500" : "border-gray-300"
              }`}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-500 font-medium">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="font-semibold text-gray-700">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Enter password"
              {...register("password")}
              className={`mt-2 w-full rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.password ? "border-red-500" : "border-gray-300"
              }`}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-500 font-medium">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="flex justify-between items-center text-sm">
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => navigate("/forget-password")}
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition"
          >
            {isSubmitting ? "Logging in..." : "Login"}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-sm text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl py-3 transition"
          >
            <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
              <path
                fill="#FFC107"
                d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
              />
              <path
                fill="#FF3D00"
                d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
              />
              <path
                fill="#1976D2"
                d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
              />
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-gray-600">
            Don't have an account?
            <span
              onClick={() => navigate("/signup")}
              className="ml-2 text-blue-600 font-semibold cursor-pointer hover:underline"
            >
              Sign Up
            </span>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;