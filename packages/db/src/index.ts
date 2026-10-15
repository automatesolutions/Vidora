export * from "./client"
export * from "./scoped"
export * from "./accounts"
export * from "./workspaces"
export * from "./auth-adapter"
export * from "./credentials"
export * from "./higgsfield-connection"
export * from "./models"
export * from "./spend"
export * from "./generations"
export * from "./campaigns"
export * from "./runs"
export * from "./uploads"
export * as schema from "./schema"
export type {
  BrandKitRow,
  Campaign,
  CampaignBrief,
  ConnectedAccount,
  CostSample,
  GenerationJob,
  ModelPrefs,
  ModelRegistryRow,
  ProviderCredential,
  Run,
  RunPlan,
  Schedule,
  Upload,
  Video,
  Workspace,
  WorkspaceSettings,
} from "./schema"
// Re-exported so apps never install their own drizzle-orm (two copies break types and instanceof checks).
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm"
