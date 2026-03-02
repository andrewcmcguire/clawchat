import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.steadybase.app",
  appName: "Steadybase",
  server: {
    url: "https://app.steadybase.io",
    cleartext: false,
  },
  ios: {
    scheme: "Steadybase",
    contentInset: "always",
  },
};

export default config;
