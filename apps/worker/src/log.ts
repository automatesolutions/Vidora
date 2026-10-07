// Structured one-line JSON logs (easy to ship to any log service later).
function write(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data })
  ;(level === "info" ? console.log : console.error)(line)
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
}
