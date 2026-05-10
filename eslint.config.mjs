import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    files: [
      "src/components/growth/referral-program-modal.tsx",
      "src/components/growth/referral-program-nudge.tsx",
      "src/components/layout/language-switcher.tsx",
      "src/components/onboarding/product-tour.tsx",
      "src/components/payments/payment-countdown.tsx",
      "src/components/ui/retry-image.tsx",
      "src/hooks/use-model-profile-engagement.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
];
