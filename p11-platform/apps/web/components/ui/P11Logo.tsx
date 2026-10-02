/** Static P11 artwork from https://www.p11.com/. See public/branding/README.md. */
export function P11Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`p11-logo ${className}`}
      viewBox="0 0 68 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="P11"
      focusable="false"
    >
      <path
        d="M57.3381 57.2559C53.4077 61.1863 48.4709 64.1375 42.9629 65.6879"
        stroke="currentColor"
        strokeWidth="1.76583"
        strokeMiterlimit="10"
      />
      <path
        d="M7.76716 53.8959C3.55116 48.3471 1.03516 41.4383 1.03516 33.9311C1.03516 15.7071 15.8048 0.9375 34.0288 0.9375C52.2528 0.9375 67.0224 15.7071 67.0224 33.9311C67.0224 41.4519 64.5064 48.3743 60.2768 53.9231"
        stroke="currentColor"
        strokeWidth="1.76583"
        strokeMiterlimit="10"
      />
      <path
        d="M15.3555 23.5566H23.6651C28.7107 23.5566 32.1787 26.1406 32.1787 30.5606V30.6286C32.1787 35.443 28.0171 37.9318 23.2435 37.9318H17.0555V46.4726H15.3555V23.5566ZM23.3387 36.3678C27.5955 36.3678 30.4787 34.1374 30.4787 30.7374V30.6694C30.4787 27.0382 27.6635 25.1342 23.5427 25.1342H17.0555V36.3678H23.3387Z"
        fill="currentColor"
      />
      <path
        d="M39.1558 25.1606L34.7358 26.6702L34.2734 25.3238L39.5094 23.3926H40.8286V46.4718H39.1558V25.1606Z"
        fill="currentColor"
      />
      <path
        d="M50.9586 25.1606L46.5386 26.6702L46.0898 25.3238L51.3258 23.3926H52.6314V46.4718H50.9586V25.1606Z"
        fill="currentColor"
      />
    </svg>
  );
}
