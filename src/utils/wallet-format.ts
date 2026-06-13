// Presentation helpers for wallet transactions / top-up events. Kept in one place
// so the read API (descriptions) and the SSE bridge (top-up messages) stay in sync.

/** MoMo method code → display label. */
export const methodLabel = (method?: string | null): string | null =>
  method === 'mtn' ? 'MTN' : method === 'airtel' ? 'Airtel' : null;

/**
 * Human description for a wallet movement, derived from its source. Top-ups show
 * the MoMo method when known (payment-svc must include payment_method on the
 * passenger.transaction event); otherwise a generic label.
 */
export const describeTransaction = (source: string | null, method?: string | null): string => {
  switch (source) {
    case 'topup': {
      const label = methodLabel(method);
      return label ? `Top up via ${label}` : 'Wallet top-up';
    }
    case 'ticket_payment':
      return 'Ticket payment';
    case 'refund':
      return 'Ticket refund';
    default:
      return 'Wallet transaction';
  }
};

/** Concise success message for a confirmed top-up (doubles as the toast text). */
export const topupConfirmedMessage = (method?: string | null): string => {
  const label = methodLabel(method);
  return label ? `Topped up via ${label} successfully.` : 'Your wallet has been topped up successfully.';
};

/**
 * Map a payment-svc failure reason to a user-facing message. We always treat
 * top-ups as retryable, so the message stays encouraging regardless of reason.
 */
export const topupFailedMessage = (reason?: string | null): string => {
  switch (reason) {
    case 'MOMO_DECLINED':
      return 'The mobile money payment was declined. Please try again.';
    case 'USER_CANCELLED':
      return 'The payment was cancelled. Please try again.';
    case 'TIMEOUT':
      return 'The payment timed out. Please try again.';
    case 'INSUFFICIENT_FUNDS':
      return 'Your mobile money account has insufficient funds. Please try again.';
    default:
      return 'Payment was not completed. Please try again.';
  }
};
