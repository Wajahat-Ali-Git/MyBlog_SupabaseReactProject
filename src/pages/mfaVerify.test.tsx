import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import MFAVerify from "./mfaVerify";

const mockVerifyMFA = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockFetchUserRole = vi.fn();
vi.mock("../services/authService", () => ({
  verifyMFA: (...args: unknown[]) => mockVerifyMFA(...args),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  fetchUserRole: (...args: unknown[]) => mockFetchUserRole(...args),
}));

const renderAtMfaVerify = (state?: { factorId: string; challengeId: string }) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/mfa-verify", state }]}>
      <Routes>
        <Route path="/mfa-verify" element={<MFAVerify />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/" element={<div>Home Page</div>} />
        <Route path="/admin" element={<div>Admin Page</div>} />
      </Routes>
    </MemoryRouter>
  );

describe("MFAVerify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when no challenge state is present", async () => {
    renderAtMfaVerify(undefined);

    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
  });

  it("keeps the Verify button disabled until a 6-digit code is entered", async () => {
    const user = userEvent.setup();
    renderAtMfaVerify({ factorId: "factor-1", challengeId: "challenge-1" });

    const button = screen.getByRole("button", { name: /verify/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/6-digit code/i), "123");
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/6-digit code/i), "456");
    expect(button).toBeEnabled();
  });

  it("strips non-numeric input and caps the code at 6 digits", async () => {
    const user = userEvent.setup();
    renderAtMfaVerify({ factorId: "factor-1", challengeId: "challenge-1" });

    await user.type(screen.getByLabelText(/6-digit code/i), "12ab34567");

    expect(screen.getByLabelText(/6-digit code/i)).toHaveValue("123456");
  });

  it("verifies the code and navigates to / for a regular user", async () => {
    mockVerifyMFA.mockResolvedValue({});
    mockGetCurrentUser.mockResolvedValue({ id: "user-1" });
    mockFetchUserRole.mockResolvedValue("user");

    const user = userEvent.setup();
    renderAtMfaVerify({ factorId: "factor-1", challengeId: "challenge-1" });

    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(mockVerifyMFA).toHaveBeenCalledWith("factor-1", "challenge-1", "123456");
    await waitFor(() => expect(screen.getByText("Home Page")).toBeInTheDocument());
  });

  it("navigates to /admin for an admin user", async () => {
    mockVerifyMFA.mockResolvedValue({});
    mockGetCurrentUser.mockResolvedValue({ id: "user-1" });
    mockFetchUserRole.mockResolvedValue("admin");

    const user = userEvent.setup();
    renderAtMfaVerify({ factorId: "factor-1", challengeId: "challenge-1" });

    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() => expect(screen.getByText("Admin Page")).toBeInTheDocument());
  });

  it("shows an error message when verification fails and does not navigate", async () => {
    mockVerifyMFA.mockRejectedValue(new Error("Invalid TOTP code"));

    const user = userEvent.setup();
    renderAtMfaVerify({ factorId: "factor-1", challengeId: "challenge-1" });

    await user.type(screen.getByLabelText(/6-digit code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() => expect(screen.getByText("Invalid TOTP code")).toBeInTheDocument());
    expect(screen.queryByText("Home Page")).not.toBeInTheDocument();
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });
});
