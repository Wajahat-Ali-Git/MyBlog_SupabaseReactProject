import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  enrollTOTP,
  verifyEnrollment,
  unenrollTOTP,
  getEnrolledTOTPFactor,
} from "../services/authService";
import { getErrorMessage } from "../utils/errors";

type Step = "loading" | "already-active" | "start" | "scan" | "success";

interface EnrollData {
  factorId: string;
  qrCode: string;
  secret: string;
}

const MFASetup = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("loading");
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [existingFactorId, setExistingFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const checkEnrollment = async () => {
      try {
        const factor = await getEnrolledTOTPFactor();
        if (factor && factor.status === "verified") {
          setExistingFactorId(factor.id);
          setStep("already-active");
        } else {
          setStep("start");
        }
      } catch {
        setStep("start");
      }
    };
    void checkEnrollment();
  }, []);

  const handleStartEnroll = async () => {
    setError("");
    setSubmitting(true);
    try {
      const data = await enrollTOTP();
      setEnrollData(data);
      setStep("scan");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to start setup."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!enrollData) return;
    setError("");
    setSubmitting(true);
    try {
      await verifyEnrollment(enrollData.factorId, code);
      setStep("success");
    } catch (err) {
      setError(getErrorMessage(err, "Invalid code. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisableMFA = async () => {
    if (!existingFactorId) return;
    if (!window.confirm("Are you sure you want to disable two-factor authentication?")) return;
    setError("");
    setSubmitting(true);
    try {
      await unenrollTOTP(existingFactorId);
      setStep("start");
      setExistingFactorId(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to disable MFA."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopySecret = () => {
    if (enrollData?.secret) {
      void navigator.clipboard.writeText(enrollData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">

        {step === "loading" && (
          <div className="text-center text-gray-500 py-20">
            <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p>Checking your security settings...</p>
          </div>
        )}

        {step === "already-active" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white p-8 text-center">
              <div className="text-5xl mb-3">&#128274;</div>
              <h1 className="text-2xl font-bold">2FA is Active</h1>
              <p className="mt-2 text-green-100 text-sm">Your account is protected with two-factor authentication.</p>
            </div>
            <div className="p-8 space-y-4">
              {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm font-medium">{error}</div>}
              <p className="text-gray-600 text-sm">When you sign in, you will be asked to enter a 6-digit code from your authenticator app.</p>
              <button onClick={() => navigate("/")} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition">Back to Home</button>
              <button onClick={handleDisableMFA} disabled={submitting} className="w-full border border-red-400 text-red-500 hover:bg-red-50 disabled:opacity-50 font-semibold rounded-xl py-3 transition text-sm">
                {submitting ? "Disabling..." : "Disable Two-Factor Authentication"}
              </button>
            </div>
          </div>
        )}

        {step === "start" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-8 text-center">
              <div className="text-5xl mb-3">&#128737;&#65039;</div>
              <h1 className="text-2xl font-bold">Set Up Two-Factor Auth</h1>
              <p className="mt-2 text-blue-100 text-sm">Add an extra layer of security to your account.</p>
            </div>
            <div className="p-8 space-y-5">
              {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm font-medium">{error}</div>}
              <p className="text-gray-600 text-sm leading-relaxed">
                You will use an authenticator app (like <span className="font-semibold">Google Authenticator</span> or <span className="font-semibold">Authy</span>) to generate a 6-digit code every time you log in.
              </p>
              <ul className="text-gray-500 text-sm space-y-2">
                <li className="flex items-start gap-2"><span className="text-blue-500 font-bold mt-0.5">1.</span> Click the button below to generate a QR code.</li>
                <li className="flex items-start gap-2"><span className="text-blue-500 font-bold mt-0.5">2.</span> Scan it with your authenticator app.</li>
                <li className="flex items-start gap-2"><span className="text-blue-500 font-bold mt-0.5">3.</span> Enter the 6-digit code to confirm.</li>
              </ul>
              <button onClick={handleStartEnroll} disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition flex items-center justify-center gap-2">
                {submitting ? "Generating QR code..." : "Get Started"}
              </button>
              <button onClick={() => navigate("/")} className="w-full border border-gray-300 text-gray-600 hover:bg-gray-50 font-semibold rounded-xl py-3 transition text-sm">Cancel</button>
            </div>
          </div>
        )}

        {step === "scan" && enrollData && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-6 text-center">
              <h1 className="text-2xl font-bold">Scan QR Code</h1>
              <p className="mt-1 text-blue-100 text-sm">Open your authenticator app and scan the code below.</p>
            </div>
            <div className="p-8 space-y-5">
              {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm font-medium">{error}</div>}
              <div className="flex justify-center">
                <div className="p-3 bg-white border-2 border-blue-200 rounded-2xl shadow-md">
                  <img src={enrollData.qrCode} alt="TOTP QR Code" className="w-48 h-48" />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1 text-center">Can not scan? Enter this key manually:</p>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2">
                  <code className="flex-1 text-xs text-gray-700 break-all font-mono">{enrollData.secret}</code>
                  <button onClick={handleCopySecret} className="text-blue-500 hover:text-blue-700 text-xs font-semibold whitespace-nowrap transition">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-2 text-sm">Enter the 6-digit code from your app</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6 && !submitting) void handleVerifyEnrollment(); }}
                  className="w-full text-center text-2xl tracking-widest font-mono border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1 text-center">{code.length}/6 digits entered</p>
              </div>
              <button onClick={handleVerifyEnrollment} disabled={submitting || code.length !== 6} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition">
                {submitting ? "Verifying..." : "Confirm & Enable 2FA"}
              </button>
              <button onClick={() => { setStep("start"); setEnrollData(null); setCode(""); setError(""); }} className="w-full text-sm text-gray-500 hover:text-gray-700 transition py-2">
                Back
              </button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white p-8 text-center">
              <div className="text-5xl mb-3">&#9989;</div>
              <h1 className="text-2xl font-bold">2FA Enabled!</h1>
              <p className="mt-2 text-green-100 text-sm">Your account is now protected with two-factor authentication.</p>
            </div>
            <div className="p-8 space-y-4">
              <p className="text-gray-600 text-sm leading-relaxed">From now on, every time you sign in you will be asked to enter a 6-digit code from your authenticator app.</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-amber-700 text-xs font-medium">Make sure you do not lose access to your authenticator app. If you do, you may be locked out of your account.</p>
              </div>
              <button onClick={() => navigate("/")} className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl py-3 transition">Back to Home</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default MFASetup;
