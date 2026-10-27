# NutriSlice → Calendar

Puts school lunch menus from [NutriSlice](https://www.nutrislice.com/) onto Google Calendar and Skylight. Inspired by [mealviewer-calendar](https://github.com/joehallissey/mealviewer-calendar), but for NutriSlice and hosted free on GitHub (no Cloudflare account needed).

Every morning a GitHub Action reads the public NutriSlice menu, builds one `.ics` calendar per school, and publishes it on GitHub Pages. Your calendar apps subscribe to those links.

Each school day becomes one all-day event:

> **🍽 Eastview Lunch: Walking Taco Doritos / Cheeseburger**
> Daily Special: Walking Taco Doritos, Cheeseburger
> Grab and Go: Sun Butter & Jelly, Ham & Cheese Sub
> Fruits & Vegetables: Fresh Fruit and Vegetable Salad Bar, Black Bean & Corn Salsa, Fresh Honeydew

- The title shows the first section of the menu (the daily special).
- Milk choices are left out.
- Notes like "Holiday Sidekick Day" go in the title; "No School" days show as such.
- It covers the past week and the next five weeks, as far as the school has posted.

## Set up (one time, about 5 minutes)

1. On GitHub, create a new **public** repository (e.g. `school-lunch-calendar`). GitHub Pages is free for public repos; the menus are public anyway.
2. Upload these files to it (`build.mjs`, `feeds.json`, `README.md`, `.gitignore`, and `.github/workflows/publish.yml`).
3. In the repo, go to **Settings → Pages**, and under "Build and deployment" set **Source** to **GitHub Actions**.
4. Go to the **Actions** tab, pick "Publish menu calendars", and click **Run workflow**. After a minute your calendars are at:

   ```
   https://<your-github-username>.github.io/<repo-name>/eastview-lunch.ics
   https://<your-github-username>.github.io/<repo-name>/algonquin-lunch.ics
   ```

   Opening `https://<your-github-username>.github.io/<repo-name>/` lists them.

From then on it refreshes itself every day at about 5 AM Central.

## Add to your calendars

- **Google Calendar:** on a computer, next to "Other calendars" click **+** → **From URL**, paste a link. Do it once per school. Google re-checks subscribed calendars on its own schedule (usually every several hours, sometimes up to a day).
- **Skylight:** in the Skylight app go to Calendar → Sync a new calendar → iCal / URL, and paste the link. If it won't take `https://`, change it to `webcal://`.

Tip: subscribe in Skylight directly rather than relying on Skylight → Google, so each school gets its own color and can be toggled on its own.

## Changing schools or adding breakfast

Everything is in `feeds.json`. The school and menu come straight from the NutriSlice page address:

```
https://d300.nutrislice.com/menu/eastview-elementary/lunch/2026-10-27
        ^^^^                     ^^^^^^^^^^^^^^^^^^^ ^^^^^
        district                 school              menuType
```

Add another entry under `feeds` (the key becomes the file name, e.g. `eastview-breakfast` → `/eastview-breakfast.ics`). Optional per feed: `calendarName`, `eventPrefix`, `district`, `timezone`.

To try it on your own computer (Node 22+): `node build.mjs` writes the calendars to `public/`.

## Notes

This is a personal project, not affiliated with NutriSlice or Skylight. It reads the same public menu data the NutriSlice website uses, which isn't officially documented, so a change on their side may break it until the code is updated.
