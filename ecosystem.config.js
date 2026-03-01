module.exports = {
  apps: [
    {
      name: "clawchat",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/var/www/clawchat",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
