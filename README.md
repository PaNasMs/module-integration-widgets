# Integration Widgets Pack

Read-only desktop cards for Proxmox VE, Synology DSM, and Home Assistant. Administrators create named connections under Settings → Integration widgets. Each desktop tile chooses one connection and its own display options. Multiple tiles may use the same or different connections.

Credentials are stored in the module's AES-GCM encrypted state at `/var/lib/panasms-integration-widgets` and never returned to the browser. The module verifies TLS certificates by default. The explicit self-signed option disables certificate verification for that connection.

Proxmox uses a PVE API token with permission to read cluster resources. Home Assistant uses a long-lived access token. Synology uses a DSM account to establish a short-lived API session. Create dedicated accounts and grant only the permissions required for the selected metrics. Home Assistant long-lived tokens inherit the account's permissions and are not restricted to individual entities.

The cards poll while displayed, at one-minute intervals. Synology volume usage is read through `SYNO.Core.Storage.Volume`; CPU and memory through `SYNO.Core.System.Utilization` when available. DSM models and permissions may expose different fields. No service control actions are sent by the module.
