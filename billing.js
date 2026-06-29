/**
 * Billing — Stripe subscriptions (hosted Checkout + Customer Portal).
 *
 * Dormant until STRIPE_SECRET_KEY is set in the server .env, so the app runs
 * fine before billing is configured. Webhooks are the source of truth for
 * entitlement: subscription events update users.tier / subscription_status.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL, and the four price
 * ids STRIPE_PRICE_{PRO,ELITE}_{MONTHLY,ANNUAL}.
 */
import Stripe from 'stripe';

export const TRIAL_DAYS = 7;

let _stripe; // lazy so .env is loaded before we read the key
export function getStripe() {
  if (_stripe === undefined) {
    const key = process.env.STRIPE_SECRET_KEY;
    _stripe = key ? new Stripe(key) : null;
  }
  return _stripe;
}
export const billingEnabled = () => Boolean(getStripe());

export const APP_URL = () => process.env.APP_URL || 'https://cardprospector.app';

function prices() {
  return {
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
    elite_monthly: process.env.STRIPE_PRICE_ELITE_MONTHLY,
    elite_annual: process.env.STRIPE_PRICE_ELITE_ANNUAL,
  };
}

/** plan key ('pro_monthly' etc.) → Stripe price id. */
export function planToPrice(plan) {
  return prices()[plan] || null;
}

/** Stripe price id → our tier ('pro' | 'elite' | 'free'). */
export function priceToTier(priceId) {
  const p = prices();
  if (priceId === p.pro_monthly || priceId === p.pro_annual) return 'pro';
  if (priceId === p.elite_monthly || priceId === p.elite_annual) return 'elite';
  return 'free';
}
