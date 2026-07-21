# Task shortcuts. The toolchain itself is Vite+ (`vp`) — these recipes are
# thin veneers: process orchestration via mprocs, the repo gate via vp.
# Install once: `brew install just mprocs`.

# Run the demo app and the API side by side (mprocs.yaml).
run:
    mprocs

# Run every app plus the API (mprocs-all.yaml).
run-all:
    mprocs --config mprocs-all.yaml

# The repo gate: format/lint/typecheck, all unit tests, all builds.
check:
    vp run ready
