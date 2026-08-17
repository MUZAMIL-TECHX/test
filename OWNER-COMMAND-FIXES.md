# Protection-command build

This build keeps the bot's normal user and group features while exposing only
these owner-level protection commands:

- `.antidelete` — 7x anti-delete logic with message caching, media recovery,
  edit tracking, view-once forwarding, group delivery paths, ignore lists,
  cache controls, and a test report.
- `.antilink` — 7x anti-link logic with evasion-resistant detection, safe
  deletion fallbacks, warning/kick/ban modes, whitelists, type toggles, and
  admin/owner exemptions.

The legacy owner/settings command registrations are removed from the live
command registry and are not shown in the menu.