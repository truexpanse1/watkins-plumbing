/**
 * /netlify/functions/ghl-form-webhook
 *
 * Receives Netlify form submission webhook payloads (submission_created) for
 * watkinsplumbing.net and upserts each lead as a GHL contact in the Watkins
 * sub-account, tagged for the Google Ads campaign.
 *
 * Adapted from the MGP pattern (mgp-coatings-repo) with two differences:
 *   - phone-as-primary (Watkins has no email field on /water-heater-quote;
 *     Jerrod's "no spam" promise — phone is the contact channel)
 *   - Google Ads attribution fields piped through (gclid, utm_*, ad_group,
 *     keyword, landing_page_url) — populated by the LP from URL params
 *
 * Always returns 200 so Netlify does not retry — failures are logged.
 *
 * Env required (set in Netlify dashboard → site → Environment variables):
 *   GHL_LOCATION_ID    -> 1dTrjj0yl7CJc5WOZcUk
 *   GHL_LOCATION_PIT   -> pit-… (Watkins per-location PIT from MAT's
 *                          ghl_client_configs; must have contacts.write +
 *                          tags + customFields scopes — already verified)
 *
 * Webhook setup (one-time per site):
 *   netlify api createHookBySiteId --data '{
 *     "site_id":"82051dd1-c6ed-4d6e-84c4-e3ca3d48b3d9",
 *     "body":{
 *       "type":"url",
 *       "event":"submission_created",
 *       "data":{"url":"https://watkinsplumbing.net/.netlify/functions/ghl-form-webhook"}
 *     }
 *   }'
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

interface NetlifySubmission {
  id?: string;
  form_id?: string;
  form_name?: string;
  site_url?: string;
  data?: Record<string, string | undefined>;
  human_fields?: Record<string, string | undefined>;
}

const ok = (body: Record<string, unknown>) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function pick(
  data: Record<string, string | undefined> | undefined,
  ...keys: string[]
): string | undefined {
  if (!data) return undefined;
  for (const k of keys) {
    const v = data[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTags(formName: string, data: Record<string, string | undefined>): string[] {
  const tags = new Set<string>(["web-lead"]);

  // Always tag paid traffic if a gclid is present
  const gclid = pick(data, "gclid");
  if (gclid) {
    tags.add("google-ads");
    tags.add("paid-traffic");
  }

  // Form-specific tagging
  if (formName.includes("water-heater")) {
    tags.add("water-heater-lead");
  }

  // Geo tag (Chico is the primary service area)
  const city = pick(data, "city");
  if (city && /chico/i.test(city)) tags.add("chico-lead");

  // Lead temperature default — paid traffic is "warm-lead" until call qualifies
  tags.add(gclid ? "warm-lead" : "cold-lead");

  return Array.from(tags);
}

export const handler = async (event: { httpMethod: string; body: string | null }) => {
  if (event.httpMethod !== "POST") {
    return ok({ skipped: "non-POST" });
  }

  const locationId = process.env.GHL_LOCATION_ID;
  const pit = process.env.GHL_LOCATION_PIT;
  if (!locationId || !pit) {
    console.error("[ghl-form-webhook] missing env: GHL_LOCATION_ID or GHL_LOCATION_PIT");
    return ok({ ok: false, error: "server misconfigured" });
  }

  let submission: NetlifySubmission;
  try {
    submission = JSON.parse(event.body || "{}");
  } catch (e) {
    console.warn("[ghl-form-webhook] invalid JSON body", e);
    return ok({ ok: false, error: "invalid JSON" });
  }

  const formName = submission.form_name || "unknown-form";
  const data = submission.data || {};

  // Phone is required (Watkins has no email field — phone is the contact channel)
  const phone = pick(data, "phone", "phone_number");
  if (!phone) {
    console.warn(`[ghl-form-webhook] no phone in submission ${submission.id} from form ${formName}`);
    return ok({ ok: false, error: "no phone in submission", formName });
  }

  // Optional fields
  const email = pick(data, "email");
  const firstName =
    pick(data, "first_name", "firstName") ||
    pick(data, "name", "full_name", "fullName")?.split(/\s+/)[0] ||
    undefined;
  const lastName =
    pick(data, "last_name", "lastName") ||
    pick(data, "name", "full_name", "fullName")?.split(/\s+/).slice(1).join(" ") ||
    undefined;
  const city = pick(data, "city");
  const situation = pick(data, "situation");
  const notes = pick(data, "notes", "message");

  // Google Ads attribution fields
  const gclid = pick(data, "gclid");
  const utm_source = pick(data, "utm_source");
  const utm_medium = pick(data, "utm_medium");
  const utm_campaign = pick(data, "utm_campaign");
  const ad_group = pick(data, "ad_group", "utm_term");
  const keyword = pick(data, "keyword", "kw");
  const landing_page_url = pick(data, "landing_page_url") || `https://watkinsplumbing.net/water-heater-quote`;

  const tags = buildTags(formName, data);

  const customFields: { key: string; field_value: string }[] = [];
  if (situation) customFields.push({ key: "service_interest", field_value: situation });
  customFields.push({ key: "lead_source", field_value: gclid ? "Google" : "Website" });
  if (gclid) customFields.push({ key: "gclid", field_value: gclid });
  if (utm_source) customFields.push({ key: "utm_source", field_value: utm_source });
  if (utm_medium) customFields.push({ key: "utm_medium", field_value: utm_medium });
  if (utm_campaign) customFields.push({ key: "campaign_source", field_value: utm_campaign });
  if (ad_group) customFields.push({ key: "ad_group", field_value: ad_group });
  if (keyword) customFields.push({ key: "keyword", field_value: keyword });
  customFields.push({ key: "landing_page_url", field_value: landing_page_url });

  const ghlBody: Record<string, unknown> = {
    locationId,
    phone,
    tags,
    source: `Web — ${formName}`,
    customFields,
  };
  if (email) ghlBody.email = email;
  if (firstName) ghlBody.firstName = firstName;
  if (lastName) ghlBody.lastName = lastName;
  if (city) ghlBody.city = city;

  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pit}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(ghlBody),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[ghl-form-webhook] GHL upsert failed for ${phone} from ${formName}: ${res.status} ${text}`
      );
      return ok({ ok: false, status: res.status, formName, phone });
    }

    const json = (await res.json()) as { contact?: { id?: string }; new?: boolean };

    // Attach the notes/situation as a contact note so it's not buried in custom fields
    const noteBody = [
      situation ? `Situation: ${situation}` : "",
      notes ? `Notes: ${notes}` : "",
      city ? `City: ${city}` : "",
      gclid ? `Google Ads click (gclid: ${gclid.substring(0, 12)}…)` : "",
    ].filter(Boolean).join("\n");

    if (noteBody && json.contact?.id) {
      try {
        await fetch(`${GHL_BASE}/contacts/${json.contact.id}/notes`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${pit}`,
            Version: GHL_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body: noteBody, userId: "" }),
        });
      } catch (e) {
        console.warn(`[ghl-form-webhook] note attach failed for ${phone}:`, e);
      }
    }

    console.log(
      `[ghl-form-webhook] upserted phone=${phone} contactId=${json.contact?.id} form=${formName} new=${json.new ?? false} tags=${tags.join(",")}`
    );
    return ok({
      ok: true,
      contactId: json.contact?.id,
      isNew: json.new ?? null,
      formName,
      tags,
    });
  } catch (e) {
    console.error(`[ghl-form-webhook] exception for ${phone}:`, e);
    return ok({ ok: false, error: String(e) });
  }
};
