# Platform applications (Google / YouTube and TikTok)

Everything needed to apply, with text to paste into the forms. Open items (`- [ ]`) are checked by
`pnpm launch-check`. Platform rules change: re-read each linked page before you submit.

**Timing.** Google OAuth verification and TikTok app review both ask for a **demo video of the working
connect-and-post flow**. That exists once Phase 1's "Connect accounts" and publishing work. So:
- **Now (Phase 0):** business details, domain, email, legal pages live, both developer accounts and apps created, Google branding verification.
- **Early Phase 1:** record the demo video and submit Google verification, the YouTube quota/audit form, TikTok app review, and the TikTok Direct Post audit.

Expect 2 to 8 weeks for each review. Until they pass:
- YouTube uploads from Vidora are private only, and the quota allows about 6 uploads a day across all creators.
- TikTok posts are private only, for at most 5 creators in 24 hours. Vidora sends inbox drafts instead (see docs/PLAN.md).

## 1. Needs you first

- [ ] Choose the legal business name and register the business if needed
- [ ] Buy the domain and set up `support@` and `privacy@` email addresses on it
- [ ] Fill in every placeholder in `apps/web/lib/site.ts`
- [ ] Have a lawyer review `/legal/privacy` and `/legal/terms`, then remove the `// DRAFT.` marker in both files
- [ ] Deploy the web app on the domain over HTTPS (home, privacy, and terms pages public, no sign-in)
- [ ] Verify the domain in Google Search Console (an owner of the Google Cloud project must do this)
- [ ] Point `media.<domain>` at the Cloudflare R2 bucket (TikTok pulls videos from there)

## 2. Google Cloud and YouTube

### 2.1 Project setup (now)
- [ ] Create a Google Cloud project named "Vidora" and enable **YouTube Data API v3**
- [ ] Set up the OAuth consent screen (Google Auth Platform) with the values below
- [ ] Create an OAuth client (Web application) with redirect URI `https://<domain>/api/oauth/youtube/callback` and `http://localhost:3010/api/oauth/youtube/callback` for development
- [ ] Submit branding verification (logo, name, homepage, privacy link)

| Field | Value |
|---|---|
| App name | Vidora |
| User support email | `support@<domain>` |
| App logo | `apps/web/public/brand/app-icon-1024.png`, resized to 120×120 |
| Homepage | `https://<domain>/` |
| Privacy policy | `https://<domain>/legal/privacy` |
| Terms of service | `https://<domain>/legal/terms` |
| Authorized domain | `<domain>` |
| Audience | External |

### 2.2 Scopes and justifications (early Phase 1)

| Scope | Sensitivity | Paste this justification |
|---|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | Sensitive | Vidora makes videos for a creator's channel and uploads a video only after the creator approves it in Vidora's review screen. We use this scope to call videos.insert and thumbnails.set for those approved videos. We don't upload anything the creator hasn't approved. |
| `https://www.googleapis.com/auth/youtube.readonly` | Sensitive | We use this scope to show which channel is connected (channels.list with mine=true: channel name and picture) and to show view, like, and comment counts for videos Vidora posted (videos.list). We don't read other channel content. |

Don't ask for `youtube` (full manage) or `youtube.force-ssl`. Narrow scopes get through review faster.

### 2.3 Demo video (early Phase 1)
Record it in English at 1080p, unlisted on YouTube, 2 to 4 minutes long:
1. Show the browser address bar on `https://<domain>`. Open the home page and the privacy policy.
2. Sign in to Vidora. Open Accounts and choose **Connect YouTube**.
3. On Google's consent screen, show the app name "Vidora" and the requested scopes. Show the OAuth `client_id` in the address bar.
4. Back in Vidora, show the connected channel name and picture (`youtube.readonly`).
5. Open a video in the review queue and approve it. Show it uploading, then the video on YouTube with the "Altered or synthetic content" label (`youtube.upload`).
6. Show post history with view counts (`youtube.readonly`).
7. Show **Disconnect**, and the revoke link in the privacy policy.

### 2.4 Submit (early Phase 1)
- [ ] Submit OAuth app verification with the justifications and demo video above
- [ ] Submit the YouTube API Services audit and quota extension form (https://support.google.com/youtube/contact/yt_api_form)

For the quota form, show the math, and use the current per-method costs from Google's quota calculator.
`videos.insert` has historically cost 1,600 units, so check it.

```
uploads per day       = creators × videos per creator per day     (launch target: 300 × 1 = 300)
upload units          = uploads per day × videos.insert cost      (300 × 1,600 = 480,000)
thumbnail units       = uploads per day × thumbnails.set cost     (300 × 50 = 15,000)
stats units           = posted videos tracked × refreshes per day × videos.list cost (batched 50 per call)
channel units         = connected channels × channels.list cost   (on connect and token refresh)
requested daily quota = sum + 30% headroom
```

What the audit checks, and where Vidora covers it:
- The privacy policy links the YouTube Terms of Service and the Google Privacy Policy, and gives the revoke link. Done in `/legal/privacy`.
- Stored YouTube API data is refreshed or deleted every 30 days. Planned as a Phase 1 worker job (`refresh-youtube-data`).
- Uploaded videos set `status.containsSyntheticMedia = true`. Planned in Phase 1 publishing.
- YouTube data is shown with YouTube attribution (the platform chip on `/design-system`).
- There is no misleading metadata or spam. Covered by human approval of every video, the acceptable-use rules in the terms, and the per-plan posting limits.

## 3. TikTok

### 3.1 Developer setup (now)
- [ ] Create a TikTok for Developers account and an organization (https://developers.tiktok.com)
- [ ] Create the app with the values below and add **Login Kit** and **Content Posting API** (turn on Direct Post)
- [ ] Verify the URL prefix `https://media.<domain>/` for PULL_FROM_URL
- [ ] Add redirect URI `https://<domain>/api/oauth/tiktok/callback`
- [ ] Add test accounts to the Sandbox

| Field | Value |
|---|---|
| App name | Vidora |
| Icon | `apps/web/public/brand/app-icon-1024.png` |
| Category | Content creation / Productivity (use the closest match) |
| Description | Vidora makes videos for your TikTok account and posts only the ones you approve. You set your topic, tone, and schedule. Vidora makes each video and shows it to you first. You choose the privacy and interaction settings for every post. |
| Terms URL | `https://<domain>/legal/terms` |
| Privacy URL | `https://<domain>/legal/privacy` |
| Platform | Web, `https://<domain>` |

### 3.2 Scopes and justifications

| Scope | Paste this justification |
|---|---|
| `user.info.basic` | Shows the creator which TikTok account is connected (display name and avatar) in Vidora. |
| `video.publish` | Posts a video directly to the creator's TikTok after they approve it in Vidora, with the privacy level and interaction settings they choose in our posting screen. |
| `video.upload` | Sends a video to the creator's TikTok inbox as a draft, so they can finish and post it in the TikTok app. We use this until Direct Post is approved, and for creators who prefer drafts. |
| `video.list` | Shows the status and public statistics of videos Vidora posted in the creator's post history. |

### 3.3 Direct Post UX requirements (built in Phase 1's approval sheet)
Check each against TikTok's current Content Sharing Guidelines before you record the demo:
- Show the creator's TikTok nickname and avatar from `creator_info/query` on the posting screen.
- The privacy level dropdown uses only the options `creator_info` returns, with **no default**. The creator must pick one.
- The comment, duet, and stitch toggles respect the creator's TikTok settings (shown off and disabled when TikTok disables them).
- The commercial content disclosure toggle, with "Your brand" and "Branded content" options and TikTok's required labels.
- A video preview, and a clear statement that the post goes to TikTok.
- TikTok's music usage and branded content consent text above the post button, exactly as the guidelines word it.
- No Vidora watermark or promotional text added to the video or caption.
- Respect `max_video_post_duration_sec` from `creator_info`, and the daily post cap.

### 3.4 Submit (early Phase 1)
- [ ] Record the TikTok demo video (Login Kit connect → creator info → approval sheet with privacy picked → post → post visible in TikTok)
- [ ] Submit the app for review
- [ ] After approval, submit the Content Posting API audit to lift the private-only and 5-creators limits

## 4. Before you submit anything
- [ ] Every placeholder on `/legal/privacy` and `/legal/terms` is filled in and the pages are live
- [ ] The support and privacy email addresses receive mail
- [ ] `pnpm launch-check` lists only the items in this file that wait for platform replies
