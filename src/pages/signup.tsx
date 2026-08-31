import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { signUp, signInWithGoogle } from "../services/authService";
import { signupSchema, type SignUpFormData } from "../schemas/authSchema";
import { getErrorMessage } from "../utils/errors";

const SignUp = () => {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignUpFormData) => {
    try {
      const authData = await signUp(data.email, data.password, data.username);

      if (authData.session) {
        alert("Signup successful! You are now logged in.");
        navigate("/");
      } else {
        alert("Signup successful! Please verify your email.");
        navigate("/login");
      }
    } catch (err: unknown) {
      console.error(err);
      const message = getErrorMessage(err, "Something went wrong");
      alert(message);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      console.error(err);
      const message = getErrorMessage(err, "Failed to sign in with Google.");
      alert(message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden my-2">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white text-center py-5 px-4 sm:py-6 sm:px-6">
          <h1 className="text-2xl sm:text-3xl font-bold">MyBlog</h1>
          <p className="mt-2 text-sm sm:text-base text-blue-100">
            Create your account and start blogging.
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="p-4 space-y-3 sm:p-6 sm:space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="signup-username" className="font-semibold text-gray-700">Username</label>
            <input
              id="signup-username"
              type="text"
              placeholder="Enter username"
              {...register("username")}
              className={`mt-1 w-full rounded-xl border px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.username ? "border-red-500" : "border-gray-300"
              }`}
            />
            {errors.username && (
              <p className="mt-1 text-xs text-red-500 font-medium">
                {errors.username.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="signup-email" className="font-semibold text-gray-700">Email</label>
            <input
              id="signup-email"
              type="email"
              placeholder="Enter email"
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
            <label htmlFor="signup-password" className="font-semibold text-gray-700">Password</label>
            <input
              id="signup-password"
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

          <div>
            <label htmlFor="signup-confirmPassword" className="font-semibold text-gray-700">Confirm Password</label>
            <input
              id="signup-confirmPassword"
              type="password"
              placeholder="Confirm password"
              {...register("confirmPassword")}
              className={`mt-2 w-full rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.confirmPassword ? "border-red-500" : "border-gray-300"
              }`}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-500 font-medium">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition"
          >
            {isSubmitting ? "Creating Account..." : "Create Account"}
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

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold rounded-xl py-3 transition"
          >
            Back to Login
          </button>

          <p className="text-center text-gray-600">
            Already have an account?
            <span
              onClick={() => navigate("/login")}
              className="ml-2 text-blue-600 font-semibold cursor-pointer hover:underline"
            >
              Login
            </span>
          </p>
        </form>
      </div>
    </div>
  );
};

export default SignUp;