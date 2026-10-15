# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and sends:

- **Configuration** (stored by Gladys): the consumer key and the consumer secret
  of your Resideo developer app (the secret is a `secret` field, never sent back
  to the browser), an optional callback URL and the language.
- **`/data/resideo-tokens.json`** (mode 0600, in the container's only writable
  volume): the Resideo access and refresh tokens, and a short hash of the
  consumer key telling which app they belong to. Neither the key nor the secret
  is written there. Deleting the file only asks you to click "Connect" again.
- **Network**: HTTPS to `api.honeywellhome.com` only (sign-in, token refresh,
  thermostat reads and writes). Nothing listens on the network; the sign-in
  comes back through Gladys.
- **Logs**: no token, secret, authorization code or URL carrying the key is
  ever logged.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Resideo cloud and the thermostats, and the Gladys OAuth redirect page
(`my.gladysassistant.com`).
