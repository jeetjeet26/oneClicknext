export function clientPageAllowed(path: string) {
  return (
    path === "/client" ||
    path.startsWith("/client/") ||
    path.startsWith("/auth/") ||
    path === "/account/security" ||
    path === "/join/client"
  );
}
export function clientApiAllowed(path: string, method: string) {
  if (
    [
      "/api/client-portal/overview",
      "/api/client-portal/conversations",
    ].includes(path)
  )
    return ["GET", "HEAD"].includes(method);
  if (
    path === "/api/client-portal/join" ||
    path === "/api/client-portal/join/session"
  )
    return ["GET", "POST"].includes(method);
  // Account security manages only the caller's own password and sessions.
  return [
    "/api/account/sessions",
    "/api/account/credentials",
    "/api/account/recovery",
  ].includes(path);
}
export function clientRedirect(target: string) {
  try {
    const url = new URL(target, "https://local.invalid");
    return url.origin === "https://local.invalid" &&
      (url.pathname === "/client" ||
        url.pathname.startsWith("/client/") ||
        url.pathname === "/account/security" ||
        url.pathname === "/join/client")
      ? url.pathname + url.search
      : "/client";
  } catch {
    return "/client";
  }
}
