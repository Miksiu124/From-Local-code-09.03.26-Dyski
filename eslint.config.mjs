import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    files: ["src/components/layout/language-switcher.tsx", "src/components/payments/payment-countdown.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
];
