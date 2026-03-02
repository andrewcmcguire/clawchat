import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.steadybase.steadychat",
  appName: "SteadyChat",
  server: {
    // Remote server mode — app loads from your server URL
    // Change to your domain when DNS is ready (e.g., https://chat.steadybase.io)
    url: "http://44.254.64.158",
    cleartext: true,
  },
  ios: {
    scheme: "SteadyChat",
    contentInset: "always",
  },
};

export default config;
