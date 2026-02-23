module.exports = {
  apps: [{
    name: 'xtbot',
    script: './node_modules/tsx/dist/cli.mjs',
    args: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--no-warnings',
    env: {
      NODE_ENV: 'development'
    },
    error_file: './logs/xtbot-error.log',
    out_file: './logs/xtbot-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    watch: false
  }]
}
