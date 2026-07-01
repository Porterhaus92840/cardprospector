import React from 'react';

/* ============================================================================
   LEGAL PAGES — Terms of Service, Privacy Policy, Refund Policy.
   Served at /terms, /privacy, /refunds (SPA fallback returns index.html and the
   app routes on pathname). These are DRAFTS — have counsel review before relying
   on them. Update the four constants below with your real details.
   ============================================================================ */

const OPERATOR = 'Dale Porter';
const JURISDICTION = 'the Commonwealth of Pennsylvania, United States';
const EFFECTIVE = 'June 30, 2026';
const CONTACT = 'daleporter2009@yahoo.com';

export const LEGAL_DOC_FOR_PATH = (pathname) =>
  ({ '/terms': 'terms', '/privacy': 'privacy', '/refunds': 'refunds' }[pathname] || null);

const H1 = ({ children }) => <h1 className="text-2xl font-bold mb-1">{children}</h1>;
const Eff = () => <div className="text-xs text-zinc-500 mb-6">Effective {EFFECTIVE}</div>;
const H2 = ({ children }) => <h2 className="text-base font-semibold mt-6 mb-2 text-zinc-100">{children}</h2>;
const P = ({ children }) => <p className="text-sm text-zinc-300 leading-relaxed mb-3">{children}</p>;
const LI = ({ children }) => <li className="text-sm text-zinc-300 leading-relaxed mb-1.5">{children}</li>;
const UL = ({ children }) => <ul className="list-disc pl-5 mb-3">{children}</ul>;

function Terms() {
  return (
    <>
      <H1>Terms of Service</H1>
      <Eff />
      <P>
        These Terms of Service ("Terms") govern your access to and use of CardProspector (the
        "Service"), operated by {OPERATOR} ("we," "us," "our"). By creating an account or using the
        Service, you agree to these Terms. If you don't agree, don't use the Service.
      </P>

      <H2>1. Entertainment only — not financial or investment advice</H2>
      <P>
        CardProspector is provided for informational and entertainment purposes only. Nothing on the
        Service is financial, investment, tax, or legal advice, a recommendation, or an offer to buy
        or sell anything. Our scores, archetype matches, price estimates, "buy/sell targets," hold
        horizons, and projected returns are pattern-based hypotheses, not predictions or guarantees.
        Trading-card values are volatile and you can lose money. You are solely responsible for your
        own decisions and should do your own research.
      </P>

      <H2>2. Eligibility</H2>
      <P>You must be at least 18 years old (or the age of majority where you live) to use the Service.</P>

      <H2>3. Your account</H2>
      <P>
        You're responsible for the information you provide, for keeping your password secure, and for
        all activity under your account. Tell us promptly at {CONTACT} if you suspect unauthorized use.
      </P>

      <H2>4. Subscriptions, trials & billing</H2>
      <UL>
        <LI>Paid plans (e.g., Pro, Elite) are billed on a recurring monthly or annual basis through our payment processor, Stripe.</LI>
        <LI>Paid plans may start with a free trial. We don't require a payment method to begin the trial. Before the trial ends we'll ask you to add one to continue; if you don't, the subscription simply doesn't start and you are not charged.</LI>
        <LI>During our beta period, we may grant complimentary access to invited beta testers. Beta access is free and may end when the beta concludes, after which continued use requires a paid subscription.</LI>
        <LI>Subscriptions renew automatically until cancelled. You can cancel anytime via the billing portal (Manage → Stripe); access continues through the end of the paid period.</LI>
        <LI>We may change prices or plan features prospectively; we'll give reasonable notice, and changes take effect on your next billing cycle.</LI>
        <LI>Refunds are governed by our <a className="text-orange-400 underline" href="/refunds">Refund Policy</a>.</LI>
      </UL>

      <H2>5. User-submitted cards & content</H2>
      <P>
        You may submit cards and related information. You represent that you have the right to submit
        it and that it's accurate and lawful. You grant us a worldwide, royalty-free license to use,
        store, reproduce, modify, publish, and incorporate your submissions into the Service and our
        database (including for all users). We may review, edit, reject, or remove any submission at
        our discretion, and we don't guarantee any submission will be published.
      </P>

      <H2>6. Acceptable use</H2>
      <P>You agree not to: misuse or disrupt the Service; attempt to access data you're not authorized to; scrape, resell, or redistribute our data or third-party data; reverse engineer the Service; or use it for unlawful purposes.</P>

      <H2>7. Intellectual property & third-party data</H2>
      <P>
        The Service, including our software, scoring engine, and original content, is owned by us and
        protected by law. The Service incorporates data and images from third parties (including
        SportsCardsPro and eBay) that remain the property of their respective owners and are subject
        to their terms. We make no claim to that third-party content and provide it "as is."
      </P>

      <H2>8. Third-party services & links</H2>
      <P>
        The Service links to and relies on third parties (e.g., eBay listings via affiliate links,
        SportsCardsPro pricing, Stripe payments). We don't control and aren't responsible for their
        content, availability, accuracy, or practices, and your use of them may be subject to their
        own terms.
      </P>

      <H2>9. Disclaimers</H2>
      <P>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We
        do not warrant that any data, price, score, or projection is accurate, complete, or current.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {OPERATOR.toUpperCase()} WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
        DATA, OR INVESTMENT LOSSES, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY
        CLAIM WILL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM.
      </P>

      <H2>11. Indemnification</H2>
      <P>You agree to indemnify and hold us harmless from claims arising out of your use of the Service, your submissions, or your violation of these Terms.</P>

      <H2>12. Termination</H2>
      <P>We may suspend or terminate your access at any time for violation of these Terms or for any reason with notice. You may stop using the Service and cancel your subscription at any time.</P>

      <H2>13. Changes to these Terms</H2>
      <P>We may update these Terms from time to time. Material changes will be posted here with a new effective date; continued use means you accept them.</P>

      <H2>14. Governing law</H2>
      <P>These Terms are governed by the laws of {JURISDICTION}, without regard to conflict-of-laws rules. Disputes will be resolved in the courts located there, unless applicable law requires otherwise.</P>

      <H2>15. Contact</H2>
      <P>Questions? Email {CONTACT}.</P>
    </>
  );
}

function Privacy() {
  return (
    <>
      <H1>Privacy Policy</H1>
      <Eff />
      <P>This Privacy Policy explains what information {OPERATOR} ("we") collects through CardProspector (the "Service") and how we use it.</P>

      <H2>1. Information we collect</H2>
      <UL>
        <LI><strong>Account:</strong> your email address and a securely hashed password.</LI>
        <LI><strong>Usage data you create:</strong> your watchlist and any cards you submit.</LI>
        <LI><strong>Payment data:</strong> handled by Stripe. We do not store your card number. We store a Stripe customer identifier and your subscription status/tier.</LI>
        <LI><strong>Technical:</strong> a session cookie to keep you signed in, plus standard server logs (e.g., IP address, request data) for security and reliability.</LI>
      </UL>

      <H2>2. How we use information</H2>
      <UL>
        <LI>To provide and operate the Service (accounts, watchlist, submissions).</LI>
        <LI>To process subscriptions and billing through Stripe.</LI>
        <LI>To secure the Service and prevent abuse.</LI>
        <LI>To respond to you and, where permitted, send service-related messages.</LI>
      </UL>

      <H2>3. Cookies</H2>
      <P>We use a single essential, httpOnly session cookie to keep you logged in. We don't use it for third-party advertising. Any analytics we add will be privacy-respecting and disclosed here.</P>

      <H2>4. How information is shared</H2>
      <P>
        We do not sell your personal information. We share it only as needed: with <strong>Stripe</strong> to process payments; and with service providers that host the Service. We query third-party data sources (SportsCardsPro, eBay) to fetch card prices and images, but we do not send them your personal information.
      </P>

      <H2>5. Data retention</H2>
      <P>We keep your information while your account is active and as needed to provide the Service and meet legal obligations. You can ask us to delete your account and associated data.</P>

      <H2>6. Your choices & rights</H2>
      <P>
        You may access, correct, or request deletion of your personal information by emailing {CONTACT}. Depending on where you live, you may have additional rights under laws such as the GDPR or CCPA. We comply with eBay's account-deletion notification process for any applicable data.
      </P>

      <H2>7. Security</H2>
      <P>We protect your information using measures including password hashing (bcrypt) and encrypted connections (HTTPS). No method is 100% secure, but we work to safeguard your data.</P>

      <H2>8. Children</H2>
      <P>The Service is not directed to anyone under 18, and we don't knowingly collect their information.</P>

      <H2>9. International users</H2>
      <P>The Service is operated from the United States. If you use it from elsewhere, your information may be processed in the U.S.</P>

      <H2>10. Changes</H2>
      <P>We may update this Policy; we'll post changes here with a new effective date.</P>

      <H2>11. Contact</H2>
      <P>Questions about privacy? Email {CONTACT}.</P>
    </>
  );
}

function Refunds() {
  return (
    <>
      <H1>Refund Policy</H1>
      <Eff />

      <H2>Free trial</H2>
      <P>Paid plans start with a 7-day free trial, and we don't require a credit card to begin it. You're only charged if you add a payment method and choose to continue past the trial. Beta testers receive free access for the duration of the beta period.</P>

      <H2>Subscriptions</H2>
      <P>
        After a trial converts (or for plans without a trial), subscription fees are charged at the
        start of each billing period and are <strong>non-refundable</strong> for the current period,
        except where required by law. When you cancel, your subscription stops renewing and you keep
        access until the end of the period you already paid for. We don't provide prorated refunds for
        partial periods.
      </P>

      <H2>Annual plans</H2>
      <P>Annual plans follow the same policy. If something went wrong (e.g., a billing error or duplicate charge), contact us and we'll make it right.</P>

      <H2>How to cancel</H2>
      <P>Sign in, open <strong>Manage</strong> in the account bar, and cancel through the Stripe billing portal. You can re-subscribe anytime.</P>

      <H2>Questions or billing issues</H2>
      <P>Email {CONTACT} and we'll help. We review good-faith refund requests on a case-by-case basis.</P>
    </>
  );
}

export function LegalPage({ doc }) {
  return (
    <div className="h-[100dvh] w-full overflow-y-auto bg-zinc-950 text-zinc-100" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <a href="/" className="text-sm text-orange-400 hover:text-orange-300">← Back to CardProspector</a>
        <div className="mt-6">
          {doc === 'terms' && <Terms />}
          {doc === 'privacy' && <Privacy />}
          {doc === 'refunds' && <Refunds />}
        </div>
        <div className="mt-10 pt-4 border-t border-zinc-800 text-xs text-zinc-500 flex gap-4">
          <a href="/terms" className="hover:text-zinc-300">Terms</a>
          <a href="/privacy" className="hover:text-zinc-300">Privacy</a>
          <a href="/refunds" className="hover:text-zinc-300">Refunds</a>
        </div>
      </div>
    </div>
  );
}
