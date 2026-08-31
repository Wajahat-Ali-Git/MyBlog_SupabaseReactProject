
import './App.css'
import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './contexts/authContext'
import { ErrorBoundary } from './components/ErrorBoundary'

const Home = lazy(() => import('./pages/home'))
const Login = lazy(() => import('./pages/login'))
const SignUp = lazy(() => import('./pages/signup'))
const AdminHome = lazy(() => import('./pages/adminHome'))
const ManagePosts = lazy(() => import('./pages/managePosts'))
const ManageWallet = lazy(() => import('./pages/manageWallet'))
const ManageJobs = lazy(() => import('./pages/manageJobs'))
const CronJobs = lazy(() => import('./pages/cronJobs'))
const AuthCallback = lazy(() => import('./pages/authCallback'))
const ForgetPassword = lazy(() => import('./pages/forgetPassword'))
const ResetPassword = lazy(() => import('./pages/resetPassword'))
const MFAVerify = lazy(() => import('./pages/mfaVerify'))
const MFASetup = lazy(() => import('./pages/mfaSetup'))
const Post = lazy(() => import('./pages/post'))
const MyPosts = lazy(() => import('./pages/myPosts'))
const PremiumSubscriptions = lazy(() => import('./subscriptions/premium-subscriptions'))
import Wallet from './wallet/pages/wallet'

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-4 text-center">Loading...</div>}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={["user", "admin"]}>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/post/:id"
            element={
              <ProtectedRoute allowedRoles={["user", "admin"]}>
                <Post />
              </ProtectedRoute>
            }
          />
          <Route path="/Signup" element={<SignUp />} />
          <Route path="/Login" element={<Login />} />

          <Route path="/forget-password" element={<ForgetPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/mfa-verify" element={<MFAVerify />} />
          <Route path="/mfa-setup" element={<MFASetup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manage-posts"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <ManagePosts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manage-wallets"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <ManageWallet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manage-jobs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <ManageJobs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cron-jobs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <CronJobs />
              </ProtectedRoute>
            }
          />
          <Route
           path="/premium-subscriptions"
           element={
             <ProtectedRoute allowedRoles={["user", "admin"]}>
               <PremiumSubscriptions />
             </ProtectedRoute>
           }
          />
          <Route
           path="/my-posts"
           element={
             <ProtectedRoute allowedRoles={["user", "admin"]}>
               <MyPosts />
             </ProtectedRoute>
           }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default App
