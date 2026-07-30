# Dry Creek Work Log v2

Shared GitHub Pages + Supabase work log.

## Setup

1. Open `config.js`.
2. Paste the Supabase **publishable** key in place of:
   `PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE`
3. Do not use a key beginning with `sb_secret_`.
4. Upload all files to the root of the GitHub repository.
5. Wait for GitHub Pages to redeploy, then refresh the app.

## Included

- Worker list loaded from Supabase
- Worker choice remembered per device
- Start and finish visits
- Shared “currently on site” list
- Crew size, equipment, and notes
- Automatic duration
- Shared history and search
- CSV export
- Daily completion and labor-hour totals

Photo uploads are not enabled yet. They require a Supabase Storage bucket and separate storage policies.
