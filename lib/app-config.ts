const FALLBACK_APP_BASE_URL = "https://nimiqpools.xyz";

export function getAppBaseUrl() {
  return (
    process.env.NIMIQ_APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() ||
    FALLBACK_APP_BASE_URL
  );
}

export function getReferralShareUrl(code: string) {
  return `${getAppBaseUrl()}?ref=${code}`;
}
