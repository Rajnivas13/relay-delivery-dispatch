import { withAuth } from "@/auth/withAuth";
import { json, parseBody } from "@/lib/http";
import { SettingsPatchSchema } from "@/lib/schemas";
import { getSettingsView, updateSettings } from "@/services/settingsService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "settings:read" }, async () => json(await getSettingsView()));

export const PATCH = withAuth({ permission: "settings:write" }, async (req) => {
  return json(await updateSettings(await parseBody(req, SettingsPatchSchema)));
});
