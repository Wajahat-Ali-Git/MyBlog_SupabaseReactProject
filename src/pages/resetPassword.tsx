import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetPassword } from "../services/authService";
import { getErrorMessage } from "../utils/errors";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      alert("Please fill in both password fields.");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await resetPassword(password);
      alert("Your password has been updated. Please log in with your new password.");
      navigate("/login");
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Unable to reset password.");
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white text-center p-8">
          <h1 className="text-3xl font-bold">Reset Password</h1>
          <p className="mt-2 text-blue-100">
            Enter your new password to complete the reset process.
          </p>
        </div>

        <form onSubmit={handleResetPassword} className="p-8 space-y-6">
          <div>
            <label htmlFor="reset-password" className="font-semibold text-gray-700">New Password</label>
            <input
              id="reset-password"
              type="password"
              placeholder="Enter new password"
              className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="reset-confirmPassword" className="font-semibold text-gray-700">Confirm Password</label>
            <input
              id="reset-confirmPassword"
              type="password"
              placeholder="Confirm new password"
              className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition disabled:bg-blue-300"
          >
            {loading ? "Saving..." : "Reset Password"}
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

export default ResetPassword;
