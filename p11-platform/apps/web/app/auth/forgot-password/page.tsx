"use client";

import { useActionState } from "react";
import { forgotPassword, type AuthState } from "../actions";
import Link from "next/link";
import { P11Logo } from "@/components/ui/P11Logo";

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState<
    AuthState | null,
    FormData
  >(forgotPassword, null);

  if (state?.success) {
    return (
      <div className="min-h-screen auth-surface flex flex-col justify-center px-5 py-12 sm:px-6 lg:px-8">
        <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-12 px-4 shadow-sm rounded-2xl sm:px-10 border border-slate-200 text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/30">
              <svg
                className="h-8 w-8 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="mt-6 text-xl font-semibold text-slate-900">
              Check your email
            </h3>
            <p className="mt-3 text-slate-600">
              If an account exists with that email, we&apos;ve sent you a
              password reset link.
            </p>
            <div className="mt-8">
              <Link
                href="/auth/login"
                className="text-sm font-medium text-[#a53212] hover:text-[#78260e] transition-colors"
              >
                ← Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen auth-surface flex flex-col justify-center px-5 py-12 sm:px-6 lg:px-8">
      {/* Decorative elements */}

      <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo */}
        <div className="flex justify-center">
          <P11Logo className="p11-logo-auth" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-slate-900">
          Reset your password
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      <div className="relative mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm rounded-2xl sm:px-10 border border-slate-200">
          {state?.error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {state.error}
            </div>
          )}

          <form className="space-y-6" action={formAction}>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isPending}
                  className="block w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 py-3 placeholder-slate-400 text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-[#c33510]/40 transition-all disabled:opacity-50"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isPending}
                className="flex w-full justify-center rounded-lg bg-[#fa4616] py-3 px-4 text-sm font-semibold text-[#171717] shadow-none hover:bg-[#ed3e12] focus:outline-none focus:ring-2 focus:ring-[#c33510]/40 focus:ring-offset-2 focus:ring-offset-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <span className="flex items-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Sending...
                  </span>
                ) : (
                  "Send reset link"
                )}
              </button>
            </div>
          </form>

          <p className="mt-8 text-center text-sm text-slate-600">
            Remember your password?{" "}
            <Link
              href="/auth/login"
              className="font-medium text-[#a53212] hover:text-[#78260e] transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
