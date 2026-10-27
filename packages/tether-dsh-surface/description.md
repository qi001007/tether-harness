# tether-dsh-surface

DSH host companion which publishes the already-running native DSH web surface as a private, loopback-only descriptor for Tether. It also owns an authenticated `/tether-updates` RPC channel for updating the local DSH plugin from its bundled updater. It does not start another server or change model configuration.
