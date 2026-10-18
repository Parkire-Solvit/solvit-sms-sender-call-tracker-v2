// V18 solverSmsSwitch.ts
// Master switch for the solver SMS feature. It is controlled only on the server (environment variable
// SOLVER_SMS_ENABLED). When it is not exactly "true", saving an outcome never attempts an SMS, never records an SMS
// failure, and the screens show nothing about solver SMS or Host Pinnacle.

export function isSolverSmsEnabled(): boolean {
  return (process.env.SOLVER_SMS_ENABLED || "").trim().toLowerCase() === "true";
}
// V18 END solverSmsSwitch.ts

