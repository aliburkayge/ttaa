export function isSameOriginPanelRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin === new URL(request.url).origin) return true;
  // Railway can forward the public browser origin to a server with an internal request URL.
  // Browsers set this header themselves, so cross-site forms and fetches cannot claim same-origin.
  return request.headers.get("sec-fetch-site") === "same-origin";
}
