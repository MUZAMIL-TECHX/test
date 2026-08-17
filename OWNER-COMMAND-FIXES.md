# MUZAMIL-XD owner-command fixes

This build adapts the working permission and runtime-setting patterns from
`backend-v9-fixed` to MUZAMIL-XD's existing `cmd(...)` plugin architecture.

## Included

- Normalized owner-number matching, including linked-device suffixes.
- WhatsApp `@lid` owner resolution with a bounded cache.
- Persistent sudo users in `data/sudo.json`.
- Central `ownerOnly`, `strictOwner`, and `sudoOnly` command gates.
- Runtime `config` context for every normal, button, and body command.
- Persistent and immediately effective `.autotyping`, `.autorecording`,
  `.anticall`, `.mode`, `.setprefix`, and other settings.
- Live auto-typing/recording presence handling.
- Database-backed anti-delete enable/disable state and status command.
- A single anti-call listener; the duplicate command/listener path was removed.
- Portable safe owner utilities: `.ownerinfo`, `.sudo`, `.monitor`,
  `.gcleave`, `.pinchat`, and `.statuspost`.
- Existing destructive group operations that were owner-protected are now
  covered by the central gate, while duplicate command aliases were removed.

## Verification

From this folder:

```bash
node tests/owner-command-smoke.js
find . -type f -name '*.js' -print0 | xargs -0 -n1 node --check
```

The smoke test does not require a live WhatsApp connection or database.
High-coupling reference features such as raw code execution, clone renting,
and blind session deletion were intentionally not copied.