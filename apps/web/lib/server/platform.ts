import "server-only"

// White label: customers never see or connect the video engine. In production PLATFORM_WORKSPACE_ID
// names the operator's own workspace, whose Higgsfield connection makes every customer's videos
// (the worker reads the same variable). Only that workspace sees the engine controls.
// Unset (local development), every workspace runs its own engine, as before.

export function platformWorkspaceId() {
  return process.env.PLATFORM_WORKSPACE_ID || null
}

/** True for the workspace that runs the video engine. */
export function isOperator(workspaceId: string) {
  const platform = platformWorkspaceId()
  return !platform || platform === workspaceId
}
