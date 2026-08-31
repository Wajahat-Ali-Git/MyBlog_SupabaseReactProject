import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forgetPassword } from "../services/authService";

const ForgetPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleForgotPassword = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!email) {
      alert("Please enter your email.");
      return;
    }

    try {
      setLoading(true);

      await forgetPassword(email);

      alert("Password reset link has been sent to your email.");
    } catch (err: unknown) {
      alert((err as Error).message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">

      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white text-center p-8">
          <h1 className="text-3xl font-bold">
            Forgot Password
          </h1>

          <p className="mt-2 text-blue-100">
            Enter your email to receive a password reset link.
          </p>
        </div>

        <form
          onSubmit={handleForgotPassword}
          className="p-8 space-y-6"
        >
          <div>
            <label htmlFor="forget-email" className="font-semibold text-gray-700">
              Email Address
            </label>

            <input
              id="forget-email"
              type="email"
              placeholder="Enter your email"
              className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition disabled:bg-blue-300"
          >
            {loading ? "Sending..." : "Send Reset Link"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold rounded-xl py-3 transition"
          >
            Back to Login
          </button>

        </form>

      </div>

    </div>
  );
};

export default ForgetPassword;