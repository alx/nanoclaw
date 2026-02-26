# Tailscale

This container is connected to a Tailscale network (tailnet) in userspace-networking mode.
The Tailscale socket is at the default path (`/var/run/tailscale/tailscaled.sock`).

## Available Commands

```bash
# Check connectivity and peer list
tailscale status

# Get this container's tailnet IP address
tailscale ip

# Test reachability of another tailnet host
tailscale ping <hostname-or-ip>

# List available serve routes
tailscale serve status

# Expose a local port over HTTPS on the tailnet (background)
tailscale serve --bg <port>
```

## Notes

- Tailscale is only active when `TAILSCALE_AUTH_KEY` is set in the environment.
- The container uses userspace networking — no `/dev/net/tun` or root required.
- Port 8088 is already served on the tailnet at container startup.
- `tailscale ssh` is not available in this mode; use the serve/funnel features instead.
