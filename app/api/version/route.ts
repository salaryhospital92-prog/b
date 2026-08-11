import { readRuntimeVariable } from "../../../lib/supabase-server";

/**
 * Which build is actually serving traffic. Deploy verification compares this to
 * the local commit, so "the update is live" is a fact rather than an assumption.
 */
export async function GET() {
  return Response.json({
    commit: readRuntimeVariable("COMMIT_REF") || readRuntimeVariable("BUILD_REF") || "unknown",
    deployId: readRuntimeVariable("DEPLOY_ID") || null,
    builtAt: readRuntimeVariable("BUILD_TIME") || null,
  }, { headers: { "Cache-Control": "no-store" } });
}
