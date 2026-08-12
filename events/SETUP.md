# Skelsee Event Planner — one-time setup

The app is a static page (`index.html`) that talks to a Google Sheet through a small Apps Script "web app". Do these steps once, in order.

## 1. Create the Sheet

1. Go to [sheets.new](https://sheets.new) and create a spreadsheet. Name it something like **"Skelsee Event Planner Data"**.
2. In the menu, choose **Extensions → Apps Script**.
3. Delete whatever boilerplate code is in the editor, then paste in the entire contents of [`Code.gs`](./Code.gs) from this folder.
4. Click **Save** (the floppy disk icon).

## 2. Run the one-time setup function

1. In the Apps Script editor toolbar, use the function dropdown (next to "Debug") to select **`setupSheet`**.
2. Click **Run**. The first time, Google will ask you to authorize the script — click through **Review permissions → (your account) → Advanced → Go to project (unsafe) → Allow**. This warning is normal for a script you wrote yourself; it's not actually unsafe.
3. Go back to the Sheet — you should now see 8 tabs: `Events`, `FloorPlan`, `SeatingPlan`, `Budget`, `GuestList`, `Vendors`, `RunSheet`, `Notes`, each with a header row.
4. Back in the Apps Script editor, go to **View → Logs** (or **Executions**) and copy the value it printed after `Generated API_TOKEN:` — you'll need this in step 4.

## 3. Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**, authorize again if asked, then copy the **Web app URL** it gives you (it ends in `/exec`).

## 4. Test it

Open this in a browser tab, filling in your own URL and token from steps 3–4:

```
<your web app URL>?action=ping&token=<your API_TOKEN>
```

You should see something like `{"ok":true,"message":"pong","time":"..."}`. If you see `{"ok":false,"error":"unauthorized"}`, double-check the token matches exactly what `setupSheet` logged.

## 5. Wire up the app

1. Open [`index.html`](./index.html) in a text editor.
2. Near the top of the `<script>` block, find:
   ```js
   const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   const API_TOKEN = 'PASTE_YOUR_API_TOKEN_HERE';
   ```
3. Replace both placeholders with the URL and token from steps 3–4, save.
4. Deploy the `/events` folder the same way the rest of the site is deployed — no build step needed, it's picked up automatically.
5. Open the app, use the **More** tab's **Test connection** button to confirm it can reach the Sheet.

## After that

- Default PIN to open the app is **123456** — change it any time from the **More** tab.
- The Google Sheet is yours to use directly whenever you like — sort it, filter it, add your own tabs or pivot tables. The app only ever adds a new row or updates a single existing row by its ID; it never clears or rewrites a whole tab, so anything you add yourself stays exactly where you left it.
- If you ever need a fresh access token (e.g. you think it's leaked), set a new value under **Project Settings → Script Properties → API_TOKEN** in the Apps Script editor, then update `API_TOKEN` in `index.html` to match.
