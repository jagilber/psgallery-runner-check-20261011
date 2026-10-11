# Hosted PowerShell Gallery Check

Temporary, synthetic public test fixture for comparing a pinned Az installation on standard GitHub-hosted macOS Intel and Linux x64 runners. Manual dispatch only; no self-hosted runner, Azure login, secrets, customer code or customer data.

The matrix runs PowerShellGet and PSResourceGet on each OS with verified PowerShell 7.6.6 release downloads and Az 16.4.0. Every job records the actual image/runtime/package-manager versions, UTC boundaries, installation duration and result. A failed test remains a failed test. Result artifacts expire after two days.

Standard hosted runner labels do not select geographic region. This tests GitHub-managed placement, not a region-matched environment. Actual image versions may change between runs and are recorded rather than inferred from labels.

Job runtime is capped at 75 minutes; two jobs may run concurrently. Download timeout and byte limits, disabled core dumps and a per-file size ceiling limit local resource use. The isolated hosted VM supplies the hardware/storage ceiling and is discarded by GitHub. These are public lab test instructions, not a customer diagnostic collector or production procedure.
